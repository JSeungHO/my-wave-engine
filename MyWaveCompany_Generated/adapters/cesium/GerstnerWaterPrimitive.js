/**
 * Cesium.js Gerstner Water Primitive  (Task 2-2)
 *
 * Cesium Viewer 위에 Gerstner 파도 수면을 렌더링합니다.
 * core/ 의 GLSL 수식을 Cesium Material fabric 으로 연결하고,
 * preRender 이벤트에서 u_time 을 갱신해 파도를 애니메이션합니다.
 *
 * ## 구현 단계
 *
 * | 단계    | 상태       | 내용 |
 * |---------|------------|------|
 * | Phase 2a | ✅ 완료   | Cesium Material + uTime 애니메이션 (프래그먼트 Gerstner 색상) |
 * | Phase 2b | 🔜 예정   | GPU 버텍스 변위 (ENU 커스텀 Geometry + u_enuToWorld uniform) |
 *
 * ## Phase 2b 업그레이드 경로
 *
 * 1. ENU 로컬 float 좌표로 tessellate된 `Cesium.Geometry` 생성
 * 2. `Cesium.Appearance` vertexShaderSource 에 gerstner.glsl 인라인 삽입
 * 3. `uniform mat4 u_enuToWorld` → `TangentPlane.getEcefTransformF32()` 바인딩
 * 4. VS에서 `gerstnerDisplacement(xz, u_time, ...)` 적용 후
 *    `gl_Position = czm_projection * czm_view * (u_enuToWorld * vec4(displaced, 1.0))`
 *
 * @see adapters/cesium/TangentPlane.js  — ENU 좌표 변환
 * @see adapters/cesium/INTEGRATION.md  — 전체 로드맵 및 uniform 매핑
 * @see core/shaders/gerstner.glsl      — 재사용 GLSL 함수
 */

import * as Cesium from 'cesium';
import { GerstnerWave } from '../../core/math/GerstnerWave.js';
import { MAX_WAVES }    from '../../core/index.js';
import { TangentPlane } from './TangentPlane.js';

// ─────────────────────────────────────────────────────────────────────────────
// Cesium Material GLSL (fabric source)
//
// INTEGRATION.md uniform 매핑 (Three.js → Cesium):
//   uTime           → u_time
//   uWaveCount      → u_waveCount
//   uWaveDirection  → u_waveDir[8]
//   uWaveAmplitude  → u_waveAmp[8]
//   uWaveWavelength → u_waveLen[8]
//   uWaveSpeed      → u_waveSpeed[8]
//   uWaveSteepness  → u_waveSteep[8]
//   uDeepColor      → u_deepColor
//   uShallowColor   → u_shallowColor
//
// Phase 2a: 정확한 Gerstner 변위를 fragment 에서 UV 기반으로 근사.
// Phase 2b: vertex shader 에서 실제 변위 적용 예정.
// ─────────────────────────────────────────────────────────────────────────────
const WATER_MATERIAL_GLSL = /* glsl */`
  // ── Uniforms ──────────────────────────────────────────────────────────────
  uniform float u_time;
  uniform vec3  u_deepColor;
  uniform vec3  u_shallowColor;
  uniform int   u_waveCount;
  uniform vec2  u_waveDir[8];
  uniform float u_waveAmp[8];
  uniform float u_waveLen[8];
  uniform float u_waveSpeed[8];
  uniform float u_waveSteep[8];

  // ── Gerstner height — UV 기반 근사 (Phase 2b 에서 GPU vertex로 이전) ──────
  // uv 는 [0,1]² → xz 로컬 좌표로 스케일링 (uvScale = 실제 수면 크기 m)
  float gerstnerHeightFrag(vec2 uv, float uvScaleX, float uvScaleZ) {
    float h  = 0.0;
    vec2  xz = vec2((uv.x - 0.5) * uvScaleX, (uv.y - 0.5) * uvScaleZ);

    for (int i = 0; i < 8; i++) {
      if (i >= u_waveCount) break;
      float k     = 6.28318530718 / max(u_waveLen[i], 0.001);
      float omega = u_waveSpeed[i] * k;
      float phi   = k * dot(u_waveDir[i], xz) + omega * u_time;
      h += u_waveAmp[i] * sin(phi);
    }
    return h;
  }

  // ── Fresnel (Schlick 근사) ────────────────────────────────────────────────
  float fresnelSchlick(float cosTheta) {
    const float F0 = 0.04;
    return F0 + (1.0 - F0) * pow(1.0 - max(cosTheta, 0.0), 5.0);
  }

  // ── Cesium Material 진입점 ────────────────────────────────────────────────
  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material mat = czm_getDefaultMaterial(materialInput);

    vec2  uv      = materialInput.st;
    float h       = gerstnerHeightFrag(uv, 10000.0, 10000.0);
    float crest   = smoothstep(-0.5, 1.0, h);

    // eye-space 법선의 z 성분으로 Fresnel 계산
    vec3  N       = normalize(materialInput.normalEC);
    float fresnel = fresnelSchlick(abs(N.z));

    // 심해↔천해 색상 혼합
    vec3 color = mix(
      u_deepColor, u_shallowColor,
      clamp(fresnel * 0.55 + crest * 0.25, 0.0, 1.0)
    );

    // 잔물결 하이라이트
    float ripple = sin(uv.x * 80.0 + u_time * 2.1)
                 * sin(uv.y * 60.0 - u_time * 1.7) * 0.07;
    color += vec3(ripple * 0.5, ripple * 0.75, ripple);

    mat.diffuse   = color;
    mat.specular  = 0.75;
    mat.shininess = 90.0;
    mat.alpha     = 0.90;
    return mat;
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// GerstnerWaterPrimitive
// ─────────────────────────────────────────────────────────────────────────────

export class GerstnerWaterPrimitive {
  /**
   * @param {Cesium.Viewer} viewer
   * @param {import('../../core/types/WaveTypes.js').GerstnerWaveParams[]} waves
   * @param {{
   *   lon0?:        number,  수면 중심 경도 (도, 기본값 0)
   *   lat0?:        number,  수면 중심 위도 (도, 기본값 0)
   *   alt0?:        number,  수면 기준 고도 (m, 기본값 0 = 해수면)
   *   widthDeg?:    number,  수면 가로 크기 (도, 기본값 0.09 ≈ 10 km)
   *   heightDeg?:   number,  수면 세로 크기 (도)
   *   deepColor?:   Cesium.Color,
   *   shallowColor?: Cesium.Color,
   *   buoyancyIterations?: number
   * }} [options]
   */
  constructor(viewer, waves, options = {}) {
    const {
      lon0          = 0,
      lat0          = 0,
      alt0          = 0,
      widthDeg      = 0.09,   // ~10 km
      heightDeg     = 0.09,
      deepColor     = new Cesium.Color(0.00, 0.12, 0.28, 0.90),
      shallowColor  = new Cesium.Color(0.05, 0.48, 0.68, 0.90),
      buoyancyIterations = 3,
    } = options;

    this.viewer = viewer;

    /** CPU 솔버 — FloatingEntity 공유 가능 */
    this.solver = new GerstnerWave(waves, { buoyancyIterations, baseY: alt0 });

    /** ENU 좌표 변환 — Phase 2b vertex shader 에서도 재사용 */
    this.tangentPlane = new TangentPlane(lon0, lat0, alt0);

    this._startJD     = viewer.clock.currentTime.clone();
    this._currentTime = 0;

    // ── 파도 파라미터 패킹 ──────────────────────────────────────────────────
    const waveCount = Math.min(waves.length, MAX_WAVES);
    const dirs  = [];
    const amps  = new Array(MAX_WAVES).fill(0.0);
    const lens  = new Array(MAX_WAVES).fill(1.0);
    const spds  = new Array(MAX_WAVES).fill(0.0);
    const stps  = new Array(MAX_WAVES).fill(0.0);

    for (let i = 0; i < MAX_WAVES; i++) {
      const w = waves[i];
      dirs.push(w
        ? new Cesium.Cartesian2(w.direction[0], w.direction[1])
        : new Cesium.Cartesian2(0, 0));
      if (w) {
        amps[i] = w.amplitude;
        lens[i] = w.wavelength;
        spds[i] = w.speed;
        stps[i] = w.steepness;
      }
    }

    // ── Cesium Material (fabric) ─────────────────────────────────────────────
    this._material = new Cesium.Material({
      fabric: {
        type: 'GerstnerWater',
        uniforms: {
          u_time:        0.0,
          u_deepColor:   deepColor,
          u_shallowColor: shallowColor,
          u_waveCount:   waveCount,
          u_waveDir:     dirs,
          u_waveAmp:     amps,
          u_waveLen:     lens,
          u_waveSpeed:   spds,
          u_waveSteep:   stps,
        },
        source: WATER_MATERIAL_GLSL,
      },
      translucent: true,
    });

    // ── Rectangle 평면 지오메트리 (Phase 2a — 정적 Geometry) ─────────────────
    // Phase 2b 에서 ENU 로컬 tessellated custom Geometry 로 교체하여 GPU 변위 추가
    const rect = Cesium.Rectangle.fromDegrees(
      lon0 - widthDeg  / 2,
      lat0 - heightDeg / 2,
      lon0 + widthDeg  / 2,
      lat0 + heightDeg / 2,
    );

    this._primitive = viewer.scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.RectangleGeometry({
            rectangle:    rect,
            height:       alt0,
            vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
          }),
        }),
        appearance: new Cesium.MaterialAppearance({
          material:        this._material,
          translucent:     true,
          closed:          false,
          MaterialSupport: Cesium.MaterialAppearance.MaterialSupport.TEXTURED,
        }),
        asynchronous: false,
      }),
    );

    // ── preRender: u_time 매 프레임 갱신 ────────────────────────────────────
    this._preRenderHandler = viewer.scene.preRender.addEventListener(
      (scene, julianDate) => {
        this._currentTime = Cesium.JulianDate.secondsDifference(
          julianDate, this._startJD,
        );
        this._material.uniforms.u_time = this._currentTime;
      },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 공개 API
  // ─────────────────────────────────────────────────────────────────────────

  /** 현재 시뮬레이션 시간 (초) */
  get currentTime() { return this._currentTime; }

  /** GerstnerWave CPU 솔버 (FloatingEntity 와 공유) */
  get gerstnerSolver() { return this.solver; }

  /** TangentPlane (ENU ↔ WGS84 변환) */
  get plane() { return this.tangentPlane; }

  /**
   * WGS84 위경도 지점의 수면 고도를 반환합니다.
   * @param {number} lonDeg  경도 (도)
   * @param {number} latDeg  위도 (도)
   * @returns {number} WGS84 고도 (m)
   */
  getWaterAltitude(lonDeg, latDeg) {
    return this.tangentPlane.getWaterAltitude(
      lonDeg, latDeg, this.solver, this._currentTime,
    );
  }

  /** @param {boolean} visible */
  setVisible(visible) {
    if (this._primitive) this._primitive.show = visible;
  }

  /** 리소스 해제 */
  destroy() {
    if (this._preRenderHandler) {
      this._preRenderHandler();
      this._preRenderHandler = null;
    }
    if (this._primitive && !this._primitive.isDestroyed()) {
      this.viewer.scene.primitives.remove(this._primitive);
      this._primitive = null;
    }
    this._material = null;
  }
}
