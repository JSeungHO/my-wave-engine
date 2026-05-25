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
import { coastalBoundsToDegrees } from '../../core/types/SceneTypes.js';
import { TangentPlane } from './TangentPlane.js';

// ─────────────────────────────────────────────────────────────────────────────
// Cesium Fabric 은 uniform 배열(vec2[8] 등) 미지원 — 개별 uniform 으로 패킹
// @see https://github.com/CesiumGS/cesium/wiki/Fabric
// ─────────────────────────────────────────────────────────────────────────────

/** @param {number} n @returns {string} */
function buildWaterMaterialGlsl(n) {
  const waveTerms = [];
  for (let i = 0; i < n; i++) {
    waveTerms.push(`    h += waveH(xz, u_w${i}, u_sp${i}, u_ph${i});`);
  }

  // Fabric 이 uniforms 객체로부터 uniform 선언을 자동 삽입 — source 에 선언 금지
  return /* glsl */`
  float waveNoise(vec2 xz) {
    float n1 = fract(sin(dot(xz * 0.07, vec2(12.9898, 78.233))) * 43758.5453);
    float n2 = fract(sin(dot(xz * 0.11 + 2.1, vec2(39.3468, 11.1355))) * 43758.5453);
    return (n1 + n2) * 0.5;
  }

  float waveH(vec2 xz, vec4 w, float spd, float ph) {
    float k     = 6.28318530718 / max(w.w, 0.001);
    float omega = spd * k;
    float phi   = k * dot(w.xy, xz) + omega * u_time + ph;
    return w.z * sin(phi);
  }

  float gerstnerHeightFrag(vec2 uv, float uvScaleX, float uvScaleZ) {
    float h  = 0.0;
    vec2  xz = vec2((uv.x - 0.5) * uvScaleX, (uv.y - 0.5) * uvScaleZ);

    if (u_waveCount <= 0.0) return h;
${waveTerms.join('\n')}
    return h * u_amplitudeScale;
  }

  float fresnelSchlick(float cosTheta) {
    const float F0 = 0.04;
    return F0 + (1.0 - F0) * pow(1.0 - max(cosTheta, 0.0), 5.0);
  }

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material mat = czm_getDefaultMaterial(materialInput);

    vec2  uv      = materialInput.st;
    float h       = gerstnerHeightFrag(uv, 10000.0, 10000.0);
    vec2  xzN     = vec2((uv.x - 0.5) * 10000.0, (uv.y - 0.5) * 10000.0);
    float irregular = 0.68 + 0.32 * waveNoise(xzN);
    h += (waveNoise(xzN * 1.7 + u_time * 0.4) - 0.5) * 0.35 * u_amplitudeScale;
    float crest   = smoothstep(-0.2, 1.9, h * irregular);
    float foamC   = smoothstep(0.7, 2.3, h * irregular);

    vec3  N       = normalize(materialInput.normalEC);
    float fresnel = fresnelSchlick(abs(N.z));

    vec3 color = mix(
      u_deepColor.rgb, u_shallowColor.rgb,
      clamp(fresnel * 0.52 + crest * 0.38, 0.0, 1.0)
    );
    color = mix(color, vec3(0.35, 0.65, 0.78), fresnel * 0.18);
    color = mix(color, vec3(0.90, 0.97, 1.0), foamC * 0.45);

    float ripple = sin(uv.x * 120.0 + u_time * 3.5)
                 * sin(uv.y * 90.0  - u_time * 2.8) * 0.06;
    float flow   = sin(dot(uv - 0.5, vec2(1.0, 0.4)) * 40.0 - u_time * 2.0) * 0.04;
    color += vec3(flow * 0.2, ripple * 0.15 + flow * 0.3, ripple * 0.2 + flow * 0.25);

    mat.diffuse   = color;
    mat.specular  = 0.45;
    mat.shininess = 48.0;
    mat.alpha     = 0.90;
    return mat;
  }
`;
}

/**
 * @param {import('../../core/types/WaveTypes.js').GerstnerWaveParams[]} waves
 * @param {Cesium.Color} deepColor
 * @param {Cesium.Color} shallowColor
 */
function packWaveUniforms(waves, deepColor, shallowColor) {
  const waveCount = Math.min(waves.length, MAX_WAVES);
  /** @type {Record<string, unknown>} */
  const uniforms = {
    u_time:        0.0,
    u_deepColor:   deepColor,
    u_shallowColor: shallowColor,
    u_waveCount:   waveCount,
    u_amplitudeScale: 1.0,
  };

  for (let i = 0; i < MAX_WAVES; i++) {
    const w = waves[i];
    uniforms[`u_w${i}`] = w
      ? new Cesium.Cartesian4(w.direction[0], w.direction[1], w.amplitude, w.wavelength)
      : new Cesium.Cartesian4(0, 0, 0, 1);
    uniforms[`u_sp${i}`] = w ? w.speed : 0.0;
    uniforms[`u_ph${i}`] = w ? (w.phase ?? 0) : 0.0;
  }

  return uniforms;
}

const WATER_MATERIAL_GLSL = buildWaterMaterialGlsl(MAX_WAVES);

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
   *   coastAlignment?: import('../../core/types/SceneTypes.js').CoastAlignment
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
      coastAlignment = null,
      deepColor     = new Cesium.Color(0.00, 0.12, 0.28, 0.90),
      shallowColor  = new Cesium.Color(0.05, 0.48, 0.68, 0.90),
      buoyancyIterations = 3,
    } = options;

    this.viewer = viewer;

    /** CPU 솔버 — FloatingEntity 공유 가능 */
    this.solver = new GerstnerWave(waves, { buoyancyIterations, baseY: alt0 });

    /** ENU 좌표 변환 — Phase 2b vertex shader 에서도 재사용 */
    this.tangentPlane = new TangentPlane(lon0, lat0, alt0);

    this._startMs     = performance.now();
    this._currentTime = 0;
    this._amplitudeScale = 1.0;

    // ── 파도 파라미터 패킹 (Fabric: 개별 uniform, 배열 불가) ─────────────────
    const waveUniforms = packWaveUniforms(waves, deepColor, shallowColor);

    // ── Cesium Material (fabric) ─────────────────────────────────────────────
    this._material = new Cesium.Material({
      fabric: {
        type: 'GerstnerWaterPackedV4',
        uniforms: waveUniforms,
        source: WATER_MATERIAL_GLSL,
      },
      translucent: true,
    });

    // ── Rectangle 평면 지오메트리 (Phase 2a — 정적 Geometry) ─────────────────
    // Phase 2b 에서 ENU 로컬 tessellated custom Geometry 로 교체하여 GPU 변위 추가
    const rect = coastAlignment
      ? (() => {
          const b = coastalBoundsToDegrees(
            { lon: lon0, lat: lat0, altM: alt0 },
            coastAlignment,
          );
          return Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north);
        })()
      : Cesium.Rectangle.fromDegrees(
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

    // ── preRender: u_time 매 프레임 갱신 (performance.now — clock 독립) ───────
    this._preRenderHandler = viewer.scene.preRender.addEventListener(() => {
      this._currentTime = (performance.now() - this._startMs) / 1000;
      this._material.uniforms.u_time = this._currentTime;
    });
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

  /** @returns {number} */
  get amplitudeScale() { return this._amplitudeScale; }

  /**
   * 실시간 파고 배율 (waves.json 기준)
   * @param {number} scale  0.2 ~ 2.5 권장
   */
  setAmplitudeScale(scale) {
    this._amplitudeScale = Math.max(0.05, scale);
    this.solver.amplitudeScale = this._amplitudeScale;
    if (this._material?.uniforms) {
      this._material.uniforms.u_amplitudeScale = this._amplitudeScale;
    }
  }

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
