/**
 * WaterSurface.js — 계산된 수면 + 바깥 바다 렌더링
 *
 * * 정점 = 계산 셀 중심. 높이 = 바닥 + 수심 (마른 셀은 땅 밑으로 내려 물가가 자연스럽게 잘림)
 * * 법선 = 수면 높이 기울기 + 작은 잔물결(사인파 5개) + 노이즈 상세 법선
 * * 색: 깊이 흡수(청록→짙은 남색), 육지·빠른 물살은 흙탕물, 하늘 반사(프레넬), 햇빛 반짝임,
 *   얇은 파도 마루의 투과광, 거품(이류된 거품 필드 + 노이즈로 쪼갬)
 * * 바깥 바다: 계산 영역 밖 링. 앞바다 곡선 η_in(t - x/c) 를 그대로 전파시켜 경계가 이어지게 함
 *
 * @module adapters/three/tsunami/WaterSurface
 */
import * as THREE from 'three';
import { ETA_IN_GLSL, SHORE_OFFSET_GLSL } from '../../../core/shaders/tsunamiSwe.js';
import { COAST_LAYOUT } from '../../../core/math/CoastTerrain.js';
import { FRAG_OUT, NOISE_GLSL, SKY_GLSL, FOG_GLSL, OUTPUT_GLSL } from './glslUtil.js';
import { gridGeometry } from './CoastScene.js';

const CHOP_GLSL = /* glsl */ `
uniform float uChop;
uniform float uTime;
/* 작은 바람 물결 5개 (높이, d/dx, d/dz) */
vec3 chop(vec2 p){
  vec3 r = vec3(0.0);
  vec2 dirs[5] = vec2[5](vec2(-0.95, 0.31), vec2(-0.62, -0.78), vec2(-0.99, 0.12), vec2(-0.45, 0.89), vec2(-0.83, -0.55));
  float lens[5] = float[5](31.0, 17.0, 9.5, 12.5, 6.1);
  float amps[5] = float[5](0.32, 0.2, 0.09, 0.11, 0.05);
  for (int i = 0; i < 5; i++) {
    float k = 6.2831853 / lens[i];
    float w = sqrt(9.81 * k);
    float ph = k * dot(dirs[i], p) - w * uTime + float(i) * 1.7;
    r.x += amps[i] * sin(ph);
    r.yz += amps[i] * k * cos(ph) * dirs[i];
  }
  return r * uChop;
}
`;

const WATER_VERT = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uState;
uniform sampler2D uTerrain;
uniform sampler2D uFoam;
uniform ivec2 uSize;
uniform float uDx;
uniform float uFar;        // 0 = 계산 격자, 1 = 바깥 바다
uniform float uSimTime;
${ETA_IN_GLSL}
${SHORE_OFFSET_GLSL}
${CHOP_GLSL}
out vec3 vWorld;
out vec3 vN;
out float vH;
out float vFoam;
out float vLand;
out float vWet;
out float vSpeed;

float etaCell(ivec2 c, float fallback){
  c = clamp(c, ivec2(0), uSize - 1);
  vec4 s = texelFetch(uState, c, 0);
  return s.x > 0.02 ? s.x + texelFetch(uTerrain, c, 0).r : fallback;
}
/* 바깥 바다: 앞바다 곡선이 속도 C0 로 +x 방향 진행. 해안 가까이에서 서서히 0 으로 */
const float C0 = 15.34;            // sqrt(9.81 * 24)
float farEta(float x){
  float fade = 1.0 - smoothstep(560.0, ${(COAST_LAYOUT.shoreline - 10).toFixed(1)}, x);
  return etaInAt(uSimTime - x / C0) * fade;
}

void main(){
  vec3 p = position;
  vec3 n = vec3(0.0, 1.0, 0.0);
  float h, land = 0.0, wet = 1.0, speed = 0.0, foam = 0.0;
  if (uFar > 0.5) {
    float xp = p.x - shoreOffset(p.z);
    float e  = farEta(p.x);
    float e1 = farEta(p.x + 2.0);
    p.y = e;
    n = normalize(vec3(-(e1 - e) / 2.0, 1.0, 0.0));
    h = p.x < 0.0 ? 30.0 : max(0.0, e - groundHeightXp(xp));
    wet = h > 0.02 ? 1.0 : 0.0;
  } else {
    ivec2 c = ivec2(floor(p.xz / uDx));
    vec4 s = texelFetch(uState, c, 0);
    vec4 t = texelFetch(uTerrain, c, 0);
    h = s.x;
    wet = h > 0.02 ? 1.0 : 0.0;
    float eta = wet > 0.5 ? h + t.r : t.g - 0.35;
    p.y = eta;
    float eE = etaCell(c + ivec2(1, 0), eta), eW = etaCell(c - ivec2(1, 0), eta);
    float eN = etaCell(c + ivec2(0, 1), eta), eS = etaCell(c - ivec2(0, 1), eta);
    n = normalize(vec3(-(eE - eW) / (2.0 * uDx), 1.0, -(eN - eS) / (2.0 * uDx)));
    land = smoothstep(0.3, 1.5, t.g);
    speed = h > 0.05 ? length(s.yz) / h : 0.0;
    foam = texture(uFoam, (vec2(c) + 0.5) / vec2(uSize)).r;
  }
  // 잔물결은 깊은 곳에서만
  float chopAmt = smoothstep(1.5, 8.0, h) * (1.0 - land);
  vec3 ch = chop(p.xz) * chopAmt;
  p.y += ch.x;
  n = normalize(n + vec3(-ch.y, 0.0, -ch.z));

  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vN = n;
  vH = h;
  vFoam = foam;
  vLand = land;
  vWet = wet;
  vSpeed = speed;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const WATER_FRAG = /* glsl */ `
precision highp float;
${FRAG_OUT}
in vec3 vWorld;
in vec3 vN;
in float vH;
in float vFoam;
in float vLand;
in float vWet;
in float vSpeed;
uniform float uTime;
${NOISE_GLSL}
${SKY_GLSL}
${FOG_GLSL}
void main(){
  if (vWet < 0.5) discard;
  vec2 p = vWorld.xz;
  vec3 V = normalize(cameraPosition - vWorld);

  // 상세 법선: 두 겹 노이즈가 서로 다른 방향으로 흐름
  vec2 g1 = fbmGrad(p * 0.11 + vec2(uTime * 0.05, uTime * 0.02));
  vec2 g2 = fbmGrad(p * 0.37 - vec2(uTime * 0.09, -uTime * 0.04));
  float rough = 0.10 + 0.35 * clamp(vSpeed / 8.0, 0.0, 1.0);
  vec3 N = normalize(vN + vec3(g1.x + 0.5 * g2.x, 0.0, g1.y + 0.5 * g2.y) * rough);

  float NdV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = skyColor(R);

  float depthF = 1.0 - exp(-vH / 5.0);
  vec3 shallow = vec3(0.035, 0.26, 0.25);
  vec3 deep = vec3(0.004, 0.035, 0.06);
  vec3 water = mix(shallow, deep, depthF);
  float mud = clamp(vLand * 0.9 + smoothstep(4.0, 9.0, vSpeed) * 0.45, 0.0, 1.0);
  water = mix(water, vec3(0.13, 0.095, 0.055), mud);

  // 파도 마루 투과광 (해를 등진 얇은 물)
  float back = pow(clamp(dot(-V, uSunDir) * 0.5 + 0.5, 0.0, 1.0), 2.0);
  float face = smoothstep(0.05, 0.5, 1.0 - N.y);
  water += vec3(0.02, 0.16, 0.13) * face * (0.4 + back) * (1.0 - mud);

  float diff = max(dot(N, uSunDir), 0.0);
  vec3 col = mix(water * (0.55 + 0.6 * diff), sky, fres);

  // 거품: 거품 양 = 덮이는 비율. 줄무늬·덩어리 노이즈로 쪼개 항상 틈이 보이게
  float n1 = fbm(p * 0.06 + vec2(uTime * 0.04, uTime * 0.015));
  float n2 = fbm(p * 0.22 - vec2(uTime * 0.17, -uTime * 0.06));
  float ridge = 1.0 - abs(n2 * 2.0 - 1.0);                 // 줄무늬
  float n3 = vnoise(p * 1.4 + uTime * 0.5);
  float pattern = clamp(n1 * 0.5 + ridge * 0.38 + n3 * 0.12, 0.0, 1.0);
  float cover = 0.88 * smoothstep(0.05, 1.6, vFoam);
  float fm = smoothstep(1.0 - cover, 1.0 - cover + 0.12, pattern);
  float spec = pow(max(dot(R, uSunDir), 0.0), 700.0) * 7.0 + pow(max(dot(R, uSunDir), 0.0), 70.0) * 0.25;
  col += vec3(1.0, 0.95, 0.85) * spec * (1.0 - fm);
  // 거품 가장자리: 기포 섞인 밝은 물
  float aer = smoothstep(1.0 - cover - 0.25, 1.0 - cover, pattern) * (1.0 - fm);
  col = mix(col, mix(vec3(0.22, 0.36, 0.36), vec3(0.36, 0.30, 0.22), mud), aer * 0.55);
  // 거품 자체에 울퉁불퉁한 음영
  vec2 fg = fbmGrad(p * 0.9 + uTime * 0.3);
  vec3 Nf = normalize(vN + vec3(fg.x, 0.0, fg.y) * 0.9);
  float fl = 0.42 + 0.7 * max(dot(Nf, uSunDir), 0.0);
  vec3 foamCol = mix(vec3(0.92, 0.95, 0.95), vec3(0.72, 0.65, 0.54), mud * 0.7);
  col = mix(col, foamCol * fl + sky * 0.08, fm);

  float alpha = mix(0.55, 0.97, smoothstep(0.0, 2.5, vH));
  alpha = max(alpha, fm);
  alpha = mix(alpha, 1.0, mud * 0.8);
  alpha *= smoothstep(0.0, 0.08, vH);

  gl_FragColor = vec4(applyFog(col, vWorld), alpha);
  ${OUTPUT_GLSL}
}
`;

export class WaterSurface {
  constructor(terrain, solver, shared) {
    this.solver = solver;
    this.group = new THREE.Group();
    const { nx, ny, dx } = terrain;

    const pos = new Float32Array(nx * ny * 3);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = (j * nx + i) * 3;
        pos[k] = (i + 0.5) * dx; pos[k + 1] = 0; pos[k + 2] = (j + 0.5) * dx;
      }
    }
    const geo = gridGeometry(nx, ny, pos);

    this.uniforms = {
      ...shared,
      uState: { value: null },
      uTerrain: { value: solver.terrainTex },
      uFoam: { value: null },
      uSize: { value: [nx, ny] },
      uDx: { value: dx },
      uFar: { value: 0 },
      uSimTime: { value: 0 },
      uTime: { value: 0 },
      uChop: { value: 1 },
      uTsu: { value: new THREE.Vector4() },
      uTsuDelay: { value: 1e9 },
    };
    const mk = (far) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: { ...this.uniforms, uFar: { value: far } },
      transparent: true,
      depthWrite: true,
    });
    this.mat = mk(0);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);

    // 바깥 바다 링 (계산 영역 밖)
    const L = COAST_LAYOUT;
    const farMat = mk(1);
    const sea = L.shoreline + 40;
    const rings = [
      [-8000, -8000, 0, 8000 + L.lengthZ],
      [0, -8000, sea, 0],
      [0, L.lengthZ, sea, 8000 + L.lengthZ],
    ];
    for (const [x0, z0, x1, z1] of rings) {
      // x 방향으로 촘촘한 격자 (파도가 x 로 진행)
      const segX = Math.max(8, Math.round((x1 - x0) / (x0 < 0 ? 40 : 8)));
      const segZ = Math.max(4, Math.round((z1 - z0) / (x0 < 0 ? 400 : 16)));
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, segX, segZ).rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
      const m = new THREE.Mesh(g, farMat);
      m.frustumCulled = false;
      m.renderOrder = 1;
      this.group.add(m);
    }
  }

  update(realTime) {
    const s = this.solver;
    const u = this.uniforms;
    u.uState.value = s.stateTexture;
    u.uFoam.value = s.foamTexture;
    u.uSimTime.value = s.time;
    u.uTime.value = realTime;
    const t = s.tsunami;
    u.uTsu.value.set(t.amplitude, t.period, t.drawdown, t.secondWave);
    u.uTsuDelay.value = t.startDelay;
  }
}
