/**
 * CoastScene.js — 해안 지형·차수벽·건물·바깥 배경 렌더링 (Three.js)
 *
 * 계산 격자(CoastTerrain)와 같은 좌표를 쓴다: x = 앞바다→육지, z = 해안선 방향, y = 높이.
 * 땅은 침수되었던 곳을 진흙색으로 남긴다 (거품 텍스처 b 채널 = 최대 침수 깊이).
 *
 * @module adapters/three/tsunami/CoastScene
 */
import * as THREE from 'three';
import { CELL, COAST_LAYOUT, shoreOffset, groundHeight } from '../../../core/math/CoastTerrain.js';
import { SHORE_OFFSET_GLSL } from '../../../core/shaders/tsunamiSwe.js';
import { FRAG_OUT, NOISE_GLSL, SKY_GLSL, FOG_GLSL, OUTPUT_GLSL } from './glslUtil.js';

/* ───────────────────────── 지형 ───────────────────────── */

const TERRAIN_VERT = /* glsl */ `
out vec3 vWorld;
out vec3 vNormalW;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const TERRAIN_FRAG = /* glsl */ `
precision highp float;
${FRAG_OUT}
precision highp sampler2D;
in vec3 vWorld;
in vec3 vNormalW;
uniform sampler2D uTerrain;
uniform sampler2D uState;
uniform sampler2D uFoam;
uniform ivec2 uSize;
uniform float uDx;
uniform float uFar;      // 1 = 계산 영역 밖 배경 (텍스처 대신 식으로 종류 결정)
${NOISE_GLSL}
${SKY_GLSL}
${FOG_GLSL}
${SHORE_OFFSET_GLSL}

float dashes(float z, float len){ return step(fract(z / len), 0.5); }

void main(){
  ivec2 c = clamp(ivec2(floor(vWorld.xz / uDx)), ivec2(0), uSize - 1);
  vec4 t = texelFetch(uTerrain, c, 0);
  int type = int(t.b + 0.5);
  float xp = vWorld.x - shoreOffset(vWorld.z);
  // 해안 띠(해변~보도)는 셀 대신 해안선 식으로 정해 경계를 매끈하게
  if (uFar > 0.5 || type != 7 && type != 8 && type != 6) {
    if (xp < ${(COAST_LAYOUT.shoreline - 30).toFixed(1)}) type = 0;
    else if (xp < ${COAST_LAYOUT.wallStart.toFixed(1)}) type = 1;
    else if (xp < ${COAST_LAYOUT.promenadeEnd.toFixed(1)}) type = 3;
    else if (xp < ${COAST_LAYOUT.roadEnd.toFixed(1)}) type = 4;
    else if (xp < ${COAST_LAYOUT.sidewalkEnd.toFixed(1)}) type = 5;
    else type = 6;
  }
  float n = fbm(vWorld.xz * 0.35);
  float n2 = vnoise(vWorld.xz * 3.1);
  vec3 col;
  if (type == 0) {                       // 해저
    col = mix(vec3(0.42, 0.38, 0.28), vec3(0.55, 0.50, 0.38), n);
    col *= mix(1.0, 0.35, smoothstep(0.0, -22.0, vWorld.y));
  } else if (type == 1) {                // 모래사장
    col = mix(vec3(0.70, 0.60, 0.42), vec3(0.80, 0.71, 0.52), n * 0.7 + n2 * 0.3);
    col *= mix(0.62, 1.0, smoothstep(0.0, 1.2, vWorld.y));   // 물가 젖은 모래
  } else if (type == 3) {                // 산책로 타일
    vec2 g = fract(vWorld.xz / 1.5);
    float line = step(0.94, max(g.x, g.y));
    col = mix(vec3(0.60, 0.55, 0.48), vec3(0.45, 0.42, 0.38), line) * (0.92 + 0.1 * n2);
  } else if (type == 4) {                // 해안도로
    col = vec3(0.075, 0.075, 0.08) * (0.85 + 0.3 * n2);
    float lx = xp - ${COAST_LAYOUT.promenadeEnd.toFixed(1)};
    float w = ${(COAST_LAYOUT.roadEnd - COAST_LAYOUT.promenadeEnd).toFixed(1)};
    float m = 0.0;
    m += step(abs(lx - 0.5), 0.15) + step(abs(lx - (w - 0.5)), 0.15);            // 가장자리
    m += (step(abs(lx - w * 0.25), 0.12) + step(abs(lx - w * 0.75), 0.12)) * dashes(vWorld.z, 9.0);
    col = mix(col, vec3(0.75), clamp(m, 0.0, 1.0));
    float yl = step(abs(lx - w * 0.5 + 0.25), 0.1) + step(abs(lx - w * 0.5 - 0.25), 0.1); // 중앙선
    col = mix(col, vec3(0.75, 0.55, 0.08), clamp(yl, 0.0, 1.0));
  } else if (type == 5) {                // 보도
    vec2 g = fract(vWorld.xz / 0.9);
    col = mix(vec3(0.50, 0.48, 0.46), vec3(0.40), step(0.93, max(g.x, g.y)));
  } else if (type == 8) {                // 도시 골목
    col = vec3(0.09, 0.09, 0.095) * (0.85 + 0.3 * n2);
  } else if (type == 6) {                // 광장·녹지
    float grass = smoothstep(0.45, 0.6, fbm(vWorld.xz * 0.05));
    col = mix(vec3(0.42, 0.41, 0.38), vec3(0.15, 0.24, 0.09), grass) * (0.9 + 0.2 * n2);
  } else {
    col = vec3(0.35);
  }

  // 침수 흔적 (진흙) + 지금 젖어 있는 곳
  vec2 uv = (vec2(c) + 0.5) / vec2(uSize);
  float maxD = texture(uFoam, uv).b;
  float hNow = texelFetch(uState, c, 0).r;
  if (uFar < 0.5 && vWorld.y > 0.4) {
    float mud = smoothstep(0.02, 0.6, maxD);
    if (type == 1) col *= mix(1.0, 0.62, mud);                 // 모래는 젖은 색만
    else col = mix(col, col * vec3(0.55, 0.47, 0.36) + vec3(0.05, 0.035, 0.02), mud * 0.85);
    col *= mix(1.0, 0.6, smoothstep(0.0, 0.05, hNow));
  }

  vec3 N = normalize(vNormalW);
  float diff = max(dot(N, uSunDir), 0.0);
  vec3 light = vec3(1.0, 0.96, 0.9) * diff * 1.15 + skyColor(N) * 0.55;
  vec3 outc = applyFog(col * light, vWorld);
  gl_FragColor = vec4(outc, 1.0);
  ${OUTPUT_GLSL}
}
`;

/* ───────────────────────── 건물 ───────────────────────── */

const BUILDING_VERT = /* glsl */ `
in float aHue;
out vec3 vWorld;
out vec3 vNormalW;
out vec3 vLocal;
out vec3 vScale;
out float vHue;
void main(){
  mat4 im = instanceMatrix;
  vScale = vec3(length(im[0].xyz), length(im[1].xyz), length(im[2].xyz));
  vec4 w = modelMatrix * im * vec4(position, 1.0);
  vWorld = w.xyz;
  vLocal = position;
  vNormalW = normalize(mat3(modelMatrix) * mat3(im) * normal / vScale);
  vHue = aHue;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const BUILDING_FRAG = /* glsl */ `
precision highp float;
${FRAG_OUT}
in vec3 vWorld;
in vec3 vNormalW;
in vec3 vLocal;
in vec3 vScale;
in float vHue;
uniform float uFlood;      // 0..1 진흙 물때 표시 여부
${NOISE_GLSL}
${SKY_GLSL}
${FOG_GLSL}
void main(){
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  // 외벽 팔레트: 흰색 · 베이지 · 회색 · 유리 타워
  vec3 wallCol = vHue < 0.35 ? vec3(0.78, 0.77, 0.74)
               : vHue < 0.6  ? vec3(0.70, 0.63, 0.52)
               : vHue < 0.8  ? vec3(0.52, 0.53, 0.55)
               : vec3(0.30, 0.38, 0.45);
  bool glassTower = vHue >= 0.8;
  vec3 col;
  float glassAmt = 0.0;
  if (abs(N.y) > 0.5) {
    col = vec3(0.32, 0.32, 0.33) * (0.9 + 0.15 * vnoise(vWorld.xz * 0.5));
    vec2 e = abs(vLocal.xz) ;          // 지붕 가장자리 난간
    if (max(e.x * vScale.x - (vScale.x * 0.5 - 0.6), e.y * vScale.z - (vScale.z * 0.5 - 0.6)) > 0.0) col = wallCol * 0.9;
  } else {
    float horiz = abs(N.x) > 0.5 ? vWorld.z : vWorld.x;
    float floorH = 3.3;
    float yRel = (vLocal.y) * vScale.y;
    vec2 cell = vec2(horiz / 3.2, yRel / floorH);
    vec2 f = fract(cell);
    float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.22, f.y) * step(f.y, 0.86);
    if (glassTower) win = step(0.04, f.x) * step(0.08, f.y);
    if (yRel < 4.5) win *= 0.0;          // 1층 로비 벽
    float lit = step(0.83, hash12(floor(cell) + vHue * 91.0));
    vec3 glass = vec3(0.05, 0.08, 0.11) + vec3(0.9, 0.7, 0.4) * lit * 0.12;
    col = mix(wallCol, glass, win);
    glassAmt = win;
    if (yRel < 4.5) col *= 0.75;
  }
  float diff = max(dot(N, uSunDir), 0.0);
  vec3 light = vec3(1.0, 0.96, 0.9) * diff * 1.1 + skyColor(N) * 0.6;
  vec3 c = col * light;
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  c = mix(c, skyColor(R), glassAmt * (0.25 + 0.6 * fres));
  // 바닥 근처 그늘 (가짜 AO)
  float yRel = vLocal.y * vScale.y;
  c *= mix(0.55, 1.0, smoothstep(0.0, 6.0, yRel));
  gl_FragColor = vec4(applyFog(c, vWorld), 1.0);
  ${OUTPUT_GLSL}
}
`;

/* ───────────────────────── 차수벽 ───────────────────────── */

const WALL_VERT = /* glsl */ `
uniform float uWallH;
uniform float uWallBase;
out vec3 vWorld;
out vec3 vNormalW;
out vec3 vLocal;
out vec3 vScale;
out float vHue;
void main(){
  vec3 p = vec3(position.x, uWallBase + position.y * uWallH, position.z);
  vWorld = p;
  vNormalW = normal;
  vLocal = vec3(0.0, position.y, 0.0);
  vScale = vec3(1.0, uWallH, 1.0);
  vHue = 0.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const WALL_FRAG = /* glsl */ `
precision highp float;
${FRAG_OUT}
in vec3 vWorld;
in vec3 vNormalW;
in vec3 vLocal;
in vec3 vScale;
in float vHue;
${NOISE_GLSL}
${SKY_GLSL}
${FOG_GLSL}
void main(){
  vec3 N = normalize(vNormalW);
  float yRel = vLocal.y * vScale.y;
  vec3 col = vec3(0.60, 0.59, 0.55) * (0.85 + 0.25 * fbm(vWorld.xz * 0.8 + vWorld.y * 0.5));
  float seam = step(0.96, fract(vWorld.z / 6.0)) + step(0.97, fract(yRel / 1.5));
  col *= 1.0 - 0.25 * clamp(seam, 0.0, 1.0);
  if (N.y > 0.5) col = vec3(0.72, 0.71, 0.67);
  col *= mix(0.7, 1.0, smoothstep(0.0, 1.5, yRel));   // 물때
  float diff = max(dot(N, uSunDir), 0.0);
  vec3 c = col * (vec3(1.0, 0.96, 0.9) * diff * 1.1 + skyColor(N) * 0.55);
  gl_FragColor = vec4(applyFog(c, vWorld), 1.0);
  ${OUTPUT_GLSL}
}
`;

export class CoastScene {
  /**
   * @param {ReturnType<import('../../../core/math/CoastTerrain.js').buildCoastTerrain>} terrain
   * @param {import('./SweSolverGPU.js').SweSolverGPU} solver
   * @param {object} shared  공용 uniform (uSunDir, uFogColor, uFogDensity)
   */
  constructor(terrain, solver, shared) {
    this.terrain = terrain;
    this.solver = solver;
    this.shared = shared;
    this.group = new THREE.Group();

    this._buildTerrain();
    this._buildBuildings();
    this._buildWall();
    this._buildFarLand();
  }

  _mat(vert, frag, extra = {}) {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { ...this.shared, ...extra },
    });
  }

  _buildTerrain() {
    const { nx, ny, dx, b, ground, type } = this.terrain;
    const pos = new Float32Array(nx * ny * 3);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const t = type[k];
        const y = t === CELL.BUILDING || t === CELL.WALL ? ground[k] : b[k];
        pos[k * 3] = (i + 0.5) * dx;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = (j + 0.5) * dx;
      }
    }
    const geo = gridGeometry(nx, ny, pos);
    geo.computeVertexNormals();
    this.terrainMat = this._mat(TERRAIN_VERT, TERRAIN_FRAG, {
      uTerrain: { value: this.solver.terrainTex },
      uState: { value: null },
      uFoam: { value: null },
      uSize: { value: [nx, ny] },
      uDx: { value: dx },
      uFar: { value: 0 },
    });
    this.terrainMesh = new THREE.Mesh(geo, this.terrainMat);
    this.terrainMesh.frustumCulled = false;
    this.group.add(this.terrainMesh);
  }

  _buildBuildings() {
    const list = this.terrain.buildings;
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const hue = new Float32Array(list.length);
    const mat = this._mat(BUILDING_VERT, BUILDING_FRAG, { uFlood: { value: 1 } });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    list.forEach((bd, idx) => {
      m.makeScale(bd.x1 - bd.x0, bd.h, bd.z1 - bd.z0);
      m.setPosition((bd.x0 + bd.x1) / 2, bd.ground, (bd.z0 + bd.z1) / 2);
      mesh.setMatrixAt(idx, m);
      hue[idx] = bd.hue;
    });
    geo.setAttribute('aHue', new THREE.InstancedBufferAttribute(hue, 1));
    mesh.frustumCulled = false;
    this.buildingMesh = mesh;
    this.group.add(mesh);
  }

  /** 차수벽: 해안선을 따라 매끈한 띠 (계산은 셀 단위지만 화면은 곡선) */
  _buildWall() {
    const L = COAST_LAYOUT;
    const { gaps } = this.terrain;
    const pos = [], nrm = [], idx = [];
    const quad = (a, b, c, d, n) => {
      const base = pos.length / 3;
      for (const v of [a, b, c, d]) { pos.push(...v); nrm.push(...n); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const step = 1.0;
    const inGap = (z) => gaps.some((g) => Math.abs(z - g) < 8);
    let runStart = null;
    const runs = [];
    for (let z = 0; z <= L.lengthZ + 1e-6; z += step) {
      const gap = inGap(z);
      if (!gap && runStart === null) runStart = z;
      if ((gap || z + step > L.lengthZ) && runStart !== null) { runs.push([runStart, gap ? z - step : z]); runStart = null; }
    }
    for (const [z0, z1] of runs) {
      for (let z = z0; z < z1 - 1e-6; z += step) {
        const za = z, zb = Math.min(z1, z + step);
        const oa = shoreOffset(za), ob = shoreOffset(zb);
        const fa = L.wallStart + oa, fb = L.wallStart + ob;   // 바다 쪽 면
        const ba = L.wallEnd + oa, bb = L.wallEnd + ob;       // 육지 쪽 면
        const t = new THREE.Vector3(fb - fa, 0, zb - za).normalize();
        const nSea = [-t.z, 0, t.x].map((v) => -v);          // 바다(-x) 쪽
        const nSea2 = nSea[0] > 0 ? nSea.map((v) => -v) : nSea;
        quad([fa, 0, za], [fb, 0, zb], [fb, 1, zb], [fa, 1, za], nSea2);
        quad([bb, 0, zb], [ba, 0, za], [ba, 1, za], [bb, 1, zb], nSea2.map((v) => -v));
        quad([fa, 1, za], [fb, 1, zb], [bb, 1, zb], [ba, 1, za], [0, 1, 0]);
      }
      for (const [z, sgn] of [[z0, -1], [z1, 1]]) {           // 끊긴 곳 마구리
        const o = shoreOffset(z);
        quad([L.wallStart + o, 0, z], [L.wallEnd + o, 0, z], [L.wallEnd + o, 1, z], [L.wallStart + o, 1, z], [0, 0, sgn]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    this.wallMat = this._mat(WALL_VERT, WALL_FRAG, {
      uWallH: { value: 1 }, uWallBase: { value: L.groundAtWall },
    });
    this.wallMat.side = THREE.DoubleSide;
    this.wallMesh = new THREE.Mesh(geo, this.wallMat);
    this.wallMesh.frustumCulled = false;
    this.group.add(this.wallMesh);
    this.setWallHeight(this.terrain.wallHeight);
  }

  setWallHeight(h) {
    this.wallMat.uniforms.uWallH.value = Math.max(0.001, h);
    this.wallMesh.visible = h > 0.05;
  }

  /** 계산 영역 밖 배경: 같은 해안 지형 식으로 만든 땅 + 멀리 보이는 건물 */
  _buildFarLand() {
    const L = COAST_LAYOUT;
    const mat = this._mat(TERRAIN_VERT, TERRAIN_FRAG, {
      uTerrain: { value: this.solver.terrainTex },
      uState: { value: null },
      uFoam: { value: null },
      uSize: { value: [this.terrain.nx, this.terrain.ny] },
      uDx: { value: this.terrain.dx },
      uFar: { value: 1 },
    });
    this.farMat = mat;
    const strips = [
      [0, -3200, 3400, 0, 5, 20],
      [0, L.lengthZ, 3400, L.lengthZ + 3200, 5, 20],
      [L.lengthX, 0, 3400, L.lengthZ, 10, 10],
    ];
    for (const [x0, z0, x1, z1, sx, sz] of strips) {
      const cx = Math.round((x1 - x0) / sx) + 1, cz = Math.round((z1 - z0) / sz) + 1;
      const pos = new Float32Array(cx * cz * 3);
      for (let j = 0; j < cz; j++) {
        const z = z0 + (j / (cz - 1)) * (z1 - z0);
        const off = shoreOffset(z);
        for (let i = 0; i < cx; i++) {
          const x = x0 + (i / (cx - 1)) * (x1 - x0);
          const k = (j * cx + i) * 3;
          pos[k] = x; pos[k + 1] = groundHeight(x - off); pos[k + 2] = z;
        }
      }
      const g = gridGeometry(cx, cz, pos);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    const y = L.groundAtWall;
    // 배경 건물
    const rand = mulberry(99);
    const items = [];
    for (let k = 0; k < 1100; k++) {
      const side = rand();
      let x, z;
      if (side < 0.4) { x = 880 + rand() * 2400; z = -3000 + rand() * 2980; }
      else if (side < 0.8) { x = 880 + rand() * 2400; z = L.lengthZ + 20 + rand() * 2980; }
      else { x = L.lengthX + 20 + rand() * 2000; z = rand() * L.lengthZ; }
      if (x - shoreOffset(z) < L.cityStart + 34) continue;
      const near = x - shoreOffset(z) < L.cityStart + 140;
      items.push({ x, z, w: 16 + rand() * 30, d: 16 + rand() * 30, h: (near ? 40 : 12) + rand() * (near ? 90 : 45), hue: rand() });
    }
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const hue = new Float32Array(items.length);
    const bm = new THREE.InstancedMesh(geo, this.buildingMesh.material, items.length);
    const m = new THREE.Matrix4();
    items.forEach((it, idx) => {
      m.makeScale(it.w, it.h, it.d);
      m.setPosition(it.x, y + 3 * Math.min(1, Math.max(0, (it.x - shoreOffset(it.z) - 815) / 465)) - 0.5, it.z);
      bm.setMatrixAt(idx, m);
      hue[idx] = it.hue;
    });
    geo.setAttribute('aHue', new THREE.InstancedBufferAttribute(hue, 1));
    bm.frustumCulled = false;
    this.group.add(bm);
  }

  /** 매 프레임: 계산 결과 텍스처 연결 */
  update() {
    this.terrainMat.uniforms.uState.value = this.solver.stateTexture;
    this.terrainMat.uniforms.uFoam.value = this.solver.foamTexture;
    this.farMat.uniforms.uState.value = this.solver.stateTexture;
    this.farMat.uniforms.uFoam.value = this.solver.foamTexture;
  }
}

/** nx × ny 정점 격자 (인덱스 포함) */
export function gridGeometry(nx, ny, positions) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let p = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
