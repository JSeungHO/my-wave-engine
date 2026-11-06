/**
 * SweSolverGPU.js — Three.js 렌더 타깃으로 쓰나미 얕은 물 방정식을 GPU에서 돌림
 *
 * * 상태 핑퐁 (RGBA32F, Nearest) + 거품 핑퐁 (RGBA16F, Linear) + 읽기용 축소 타깃 (RGBA32F)
 * * 고정 시간 간격 dt (CFL 0.3, 최대 파속 기준). 프레임마다 필요한 만큼 반복
 * * 시간은 실제 초 단위 — FPS 와 무관
 *
 * @module adapters/three/tsunami/SweSolverGPU
 */
import * as THREE from 'three';
import {
  FULLSCREEN_VERT, SWE_INIT_FRAG, SWE_STEP_FRAG, FOAM_FRAG, REDUCE_FRAG,
} from '../../../core/shaders/tsunamiSwe.js';
import { etaIn } from '../../../core/math/TsunamiInflow.js';

const G = 9.81;
const V_MAX = 20;

function makeRT(w, h, type, filter) {
  return new THREE.WebGLRenderTarget(w, h, {
    type, format: THREE.RGBAFormat,
    minFilter: filter, magFilter: filter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
}

export class SweSolverGPU {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {ReturnType<import('../../../core/math/CoastTerrain.js').buildCoastTerrain>} terrain
   * @param {import('../../../core/math/TsunamiInflow.js').TsunamiParams} tsunami
   */
  constructor(renderer, terrain, tsunami) {
    this.renderer = renderer;
    this.terrain = terrain;
    this.tsunami = { ...tsunami };
    this.nx = terrain.nx;
    this.ny = terrain.ny;
    this.dx = terrain.dx;
    this.time = 0;
    this.block = 4;

    const { nx, ny } = this;
    this.terrainData = new Float32Array(nx * ny * 4);
    this.terrainTex = new THREE.DataTexture(this.terrainData, nx, ny, THREE.RGBAFormat, THREE.FloatType);
    this.terrainTex.magFilter = this.terrainTex.minFilter = THREE.NearestFilter;
    this.uploadTerrain();

    this.state = [makeRT(nx, ny, THREE.FloatType, THREE.NearestFilter), makeRT(nx, ny, THREE.FloatType, THREE.NearestFilter)];
    this.foam = [makeRT(nx, ny, THREE.HalfFloatType, THREE.LinearFilter), makeRT(nx, ny, THREE.HalfFloatType, THREE.LinearFilter)];
    this.rw = Math.ceil(nx / this.block);
    this.rh = Math.ceil(ny / this.block);
    this.reduceRT = makeRT(this.rw, this.rh, THREE.FloatType, THREE.NearestFilter);
    this.reduceBuf = new Float32Array(this.rw * this.rh * 4);
    this.cur = 0;
    this.foamCur = 0;

    const common = {
      uSize: { value: [nx, ny] }, // ivec2 → 배열로 넘겨야 uniform2iv 가 동작
      uVmax: { value: V_MAX },
    };
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: frag,
      uniforms: { ...common, ...uniforms },
      depthTest: false, depthWrite: false,
    });
    this.initMat = mk(SWE_INIT_FRAG, { uTerrain: { value: this.terrainTex } });
    this.stepMat = mk(SWE_STEP_FRAG, {
      uState: { value: null }, uTerrain: { value: this.terrainTex },
      uDt: { value: 0.01 }, uDx: { value: this.dx }, uEtaIn: { value: 0 },
    });
    this.foamMat = mk(FOAM_FRAG, {
      uState: { value: null }, uTerrain: { value: this.terrainTex }, uFoam: { value: null },
      uDtF: { value: 0 }, uDx: { value: this.dx }, uReset: { value: 1 },
    });
    this.reduceMat = mk(REDUCE_FRAG, {
      uState: { value: null }, uTerrain: { value: this.terrainTex }, uFoam: { value: null },
      uBlock: { value: this.block },
    });

    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.initMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.updateDt();
    this.reset();
  }

  /** 지형 배열 → GPU 텍스처 (차수벽 높이 바꿀 때도 호출) */
  uploadTerrain() {
    const { b, ground, type, n } = this.terrain;
    const d = this.terrainData;
    for (let k = 0; k < b.length; k++) {
      d[k * 4] = b[k];
      d[k * 4 + 1] = ground[k];
      d[k * 4 + 2] = type[k];
      d[k * 4 + 3] = n[k];
    }
    this.terrainTex.needsUpdate = true;
  }

  setTsunami(p) {
    Object.assign(this.tsunami, p);
    this.updateDt();
  }

  /** 최대 파속으로 안정한 dt 계산 (CFL 0.3) */
  updateDt() {
    const depth = 25 + 2.2 * this.tsunami.amplitude + 4;
    const cmax = Math.sqrt(G * depth) + V_MAX;
    this.dt = 0.3 * this.dx / cmax;
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  reset() {
    this.time = 0;
    this._pass(this.initMat, this.state[0]);
    this._pass(this.initMat, this.state[1]);
    this.cur = 0;
    this.foamMat.uniforms.uReset.value = 1;
    this.foamMat.uniforms.uState.value = this.state[0].texture;
    for (let i = 0; i < 2; i++) {
      this.foamMat.uniforms.uFoam.value = this.foam[1 - i].texture;
      this._pass(this.foamMat, this.foam[i]);
    }
    this.foamMat.uniforms.uReset.value = 0;
    this.foamCur = 0;
    this.renderer.setRenderTarget(null);
  }

  /**
   * 시뮬레이션을 simSeconds 만큼 진행 (반복 횟수 상한 maxSteps)
   * @returns {number} 실제로 진행한 시간 (s)
   */
  advance(simSeconds, maxSteps = 600) {
    const steps = Math.min(maxSteps, Math.max(0, Math.round(simSeconds / this.dt)));
    const u = this.stepMat.uniforms;
    u.uDt.value = this.dt;
    for (let s = 0; s < steps; s++) {
      u.uEtaIn.value = etaIn(this.time + 0.5 * this.dt, this.tsunami);
      u.uState.value = this.state[this.cur].texture;
      this._pass(this.stepMat, this.state[1 - this.cur]);
      this.cur = 1 - this.cur;
      this.time += this.dt;
    }
    const advanced = steps * this.dt;
    if (steps > 0) this.updateFoam(advanced);
    this.renderer.setRenderTarget(null);
    return advanced;
  }

  updateFoam(dtF) {
    const f = this.foamMat.uniforms;
    f.uDtF.value = dtF;
    f.uState.value = this.state[this.cur].texture;
    f.uFoam.value = this.foam[this.foamCur].texture;
    this._pass(this.foamMat, this.foam[1 - this.foamCur]);
    this.foamCur = 1 - this.foamCur;
  }

  /** 축소 텍스처를 CPU 로 읽음 → 통계·물보라 생성용 */
  readReduced() {
    const r = this.reduceMat.uniforms;
    r.uState.value = this.state[this.cur].texture;
    r.uFoam.value = this.foam[this.foamCur].texture;
    this._pass(this.reduceMat, this.reduceRT);
    this.renderer.readRenderTargetPixels(this.reduceRT, 0, 0, this.rw, this.rh, this.reduceBuf);
    this.renderer.setRenderTarget(null);
    return this.reduceBuf;
  }

  get stateTexture() { return this.state[this.cur].texture; }
  get foamTexture() { return this.foam[this.foamCur].texture; }
  get etaInNow() { return etaIn(this.time, this.tsunami); }

  dispose() {
    [...this.state, ...this.foam, this.reduceRT].forEach((rt) => rt.dispose());
    this.terrainTex.dispose();
  }
}
