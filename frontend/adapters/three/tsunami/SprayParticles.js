/**
 * SprayParticles.js — 벽·건물 충돌과 파도 앞면에서 튀는 물보라 (CPU 탄도 계산 + Points 렌더)
 *
 * 생성 위치·세기는 GPU 축소 텍스처(r = 물보라 세기, a = 수위)에서 받는다.
 * 큰 물덩어리(spray)와 넓게 퍼지는 물안개(mist) 두 종류.
 *
 * @module adapters/three/tsunami/SprayParticles
 */
import * as THREE from 'three';
import { FRAG_OUT, FOG_GLSL, SKY_GLSL, OUTPUT_GLSL } from './glslUtil.js';

const VERT = /* glsl */ `
in float aAge;
in float aSize;
in float aKind;
out float vAge;
out float vKind;
out vec3 vWorld;
uniform float uScale;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vec4 mv = viewMatrix * w;
  vAge = aAge;
  vKind = aKind;
  float grow = aKind > 0.5 ? (0.6 + 1.6 * aAge) : (0.8 + 0.6 * aAge);
  gl_PointSize = clamp(aSize * grow * uScale / max(-mv.z, 1.0), 1.0, 256.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
${FRAG_OUT}
in float vAge;
in float vKind;
in vec3 vWorld;
${SKY_GLSL}
${FOG_GLSL}
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float soft = exp(-r2 * 3.2) * (1.0 - r2);
  float life = vKind > 0.5 ? (1.0 - vAge) * smoothstep(0.0, 0.2, vAge) * 0.28
                           : (1.0 - vAge * vAge) * 0.75;
  vec3 n = normalize(vec3(q.x, sqrt(max(0.0, 1.0 - r2)), -q.y));
  float lit = 0.65 + 0.45 * max(dot(n, uSunDir), 0.0);
  vec3 col = vec3(0.93, 0.95, 0.96) * lit;
  gl_FragColor = vec4(applyFog(col, vWorld), soft * life);
  ${OUTPUT_GLSL}
}
`;

export class SprayParticles {
  constructor(shared, max = 40000) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);      // 0..1
    this.life = new Float32Array(max);     // s
    this.size = new Float32Array(max);
    this.kind = new Float32Array(max);     // 0 spray, 1 mist

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aAge = new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aKind = new THREE.BufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aAge', this.aAge);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aKind', this.aKind);
    geo.setDrawRange(0, 0);

    this.uniforms = { ...shared, uScale: { value: 600 } };
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  setViewport(heightPx, fovDeg) {
    this.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  spawn(x, y, z, vx, vy, vz, size, life, kind) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.kind[i] = kind;
  }

  /**
   * 축소 텍스처 한 장으로 물보라 생성
   * @param {Float32Array} buf  RGBA (r 물보라, a 수위)
   * @param {number} rw @param {number} rh @param {number} cellSize 블록 크기 (m)
   * @param {number} dtSim 지난 생성 이후 시뮬레이션 시간 (s)
   */
  emitFromField(buf, rw, rh, cellSize, dtSim) {
    if (dtSim <= 0) return;
    for (let bj = 0; bj < rh; bj++) {
      for (let bi = 0; bi < rw; bi++) {
        const k = (bj * rw + bi) * 4;
        const sp = buf[k];
        const eta = buf[k + 3];
        if (sp < 6 || eta < -50) continue;
        const rate = Math.min(160, sp * 0.6);       // 개/초
        let n = rate * dtSim;
        const whole = Math.floor(n);
        n = whole + (Math.random() < n - whole ? 1 : 0);
        const vMax = Math.min(24, 2.5 + 1.25 * Math.sqrt(sp));
        for (let s = 0; s < n; s++) {
          const x = (bi + Math.random()) * cellSize;
          const z = (bj + Math.random()) * cellSize;
          const vy = vMax * (0.35 + 0.65 * Math.random());
          const mist = Math.random() < 0.28;
          this.spawn(
            x, eta + Math.random() * 1.5, z,
            (Math.random() - 0.3) * 5 + 2.5, vy * (mist ? 0.6 : 1), (Math.random() - 0.5) * 5,
            mist ? 10 + Math.random() * 12 : 1.0 + Math.random() * 2.4,
            mist ? 3.5 + Math.random() * 3 : 1.4 + Math.random() * 1.8,
            mist ? 1 : 0,
          );
        }
      }
    }
  }

  update(dt) {
    if (dt <= 0 && this.count === 0) return;
    const g = -9.81;
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt / this.life[i];
      if (this.age[i] >= 1) {
        const last = --this.count;
        if (i !== last) {
          this.pos[i * 3] = this.pos[last * 3]; this.pos[i * 3 + 1] = this.pos[last * 3 + 1]; this.pos[i * 3 + 2] = this.pos[last * 3 + 2];
          this.vel[i * 3] = this.vel[last * 3]; this.vel[i * 3 + 1] = this.vel[last * 3 + 1]; this.vel[i * 3 + 2] = this.vel[last * 3 + 2];
          this.age[i] = this.age[last]; this.life[i] = this.life[last]; this.size[i] = this.size[last]; this.kind[i] = this.kind[last];
        }
        continue;
      }
      const drag = this.kind[i] > 0.5 ? 1.6 : 0.35;
      const f = Math.exp(-drag * dt);
      this.vel[i * 3] *= f;
      this.vel[i * 3 + 2] *= f;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * f + g * dt * (this.kind[i] > 0.5 ? 0.25 : 1);
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      i++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.count);
    this.aPos.needsUpdate = this.aAge.needsUpdate = this.aSize.needsUpdate = this.aKind.needsUpdate = true;
  }

  clear() { this.count = 0; this.points.geometry.setDrawRange(0, 0); }
}
