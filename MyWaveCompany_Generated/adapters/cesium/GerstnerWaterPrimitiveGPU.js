/**
 * GerstnerWaterPrimitiveGPU.js — Phase 2b: GPU Vertex Displacement
 *
 * ENU 로컬 Tessellated Geometry + Custom Cesium.Appearance 로
 * Gerstner 파도를 GPU 버텍스 셰이더에서 실제 변위합니다.
 *
 * ## Phase 2a vs 2b 차이
 *
 * | 항목            | Phase 2a (GerstnerWaterPrimitive)   | Phase 2b (이 파일)                     |
 * |-----------------|-------------------------------------|----------------------------------------|
 * | 지오메트리      | RectangleGeometry (WGS84 직사각형)  | ENU 로컬 N×N 격자 (미터)              |
 * | 버텍스 변위     | 없음 (평면)                          | GPU: Gerstner 수식 인라인 GLSL        |
 * | 법선            | Cesium MaterialAppearance 기본       | GPU: 정확한 Gerstner 법선 → Fresnel   |
 * | 좌표계          | WGS84 RectangleGeometry              | ENU 로컬 → czm_model(=enuToEcef) 변환 |
 * | uniform 업데이트 | material.uniforms.u_time            | _commands 인터셉트 uniformMap          |
 *
 * ## 좌표계 매핑 (INTEGRATION.md §좌표계 변환)
 *
 *   a_enuPos: (x=East, y=North, z=Up=0)  ← ENU 로컬 미터
 *   dispENU : (x=East+ΔE, y=North+ΔN, z=ΔU)
 *   czm_model = enuToEcef  → worldPos = czm_model * dispENU
 *
 * ## 공개 API
 *
 *   GerstnerWaterPrimitiveGPU 는 GerstnerWaterPrimitive (Phase 2a) 와 동일한
 *   공개 인터페이스를 제공합니다. cesium-main.js 에서 교체해 사용할 수 있습니다.
 *
 * @see adapters/cesium/GerstnerWaterPrimitive.js  Phase 2a 구현
 * @see adapters/cesium/TangentPlane.js            ENU 좌표 변환
 * @see adapters/cesium/INTEGRATION.md             Phase 2b 로드맵
 * @see core/shaders/gerstner.glsl                 원본 GLSL 수식 참고
 *
 * @module adapters/cesium/GerstnerWaterPrimitiveGPU
 */

import * as Cesium from 'cesium';

import { GerstnerWave } from '../../core/math/GerstnerWave.js';
import { TangentPlane }  from './TangentPlane.js';

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

/** 위도 1도 ≈ 111 320 m  (위도 방향 스케일) */
const DEG2M_LAT = 111_320;

/** 지원 최대 파도 수 */
const MAX_WAVES = 8;

/** GPU Wake 소스 최대 슬롯 수 (GLSL 배열 크기 == InteractionTypes.MAX_WAKE_SOURCES) */
const MAX_WAKE_SOURCES = 16;

// ─────────────────────────────────────────────────────────────────────────────
// Fragment Shader (공통 — 파도 파라미터 독립)
// ─────────────────────────────────────────────────────────────────────────────

/** @type {string} */
const FRAGMENT_SHADER = /* glsl */`
  varying vec3  v_normalWC;
  varying vec3  v_positionWC;
  varying float v_waveHeight;
  varying vec2  v_st;

  uniform vec3 u_deepColor;
  uniform vec3 u_shallowColor;

  // ── 물 색상 계산 ────────────────────────────────────────────────────────
  void main() {
    vec3 N = normalize(v_normalWC);
    vec3 V = normalize(czm_viewerPositionWC - v_positionWC);

    // Fresnel (Schlick 근사)
    float cosTheta = max(dot(N, V), 0.0);
    float fresnel   = 0.04 + 0.96 * pow(1.0 - cosTheta, 5.0);

    // 파마루(crest) 밝기
    float crest = smoothstep(-0.5, 1.2, v_waveHeight);

    // 심해 ↔ 천해 색상 혼합
    vec3 color = mix(
      u_deepColor,
      u_shallowColor,
      clamp(fresnel * 0.60 + crest * 0.25, 0.0, 1.0)
    );

    // 태양 Specular (반사)
    vec3 sunDir = normalize(vec3(0.30, 0.80, 0.50));
    vec3 H      = normalize(V + sunDir);
    float spec  = pow(max(dot(N, H), 0.0), 80.0);
    color += vec3(spec * 0.55);

    float alpha = clamp(0.82 + fresnel * 0.12 + crest * 0.06, 0.0, 1.0);
    gl_FragColor = vec4(color, alpha);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Geometry 빌더 — ENU 로컬 N×N 격자
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ENU 로컬 좌표계 내 평탄한 격자 지오메트리를 생성합니다.
 *
 * 속성:
 *   a_enuPos (vec3) — (East m, North m, Up=0)
 *   a_st     (vec2) — UV [0, 1]²
 *
 * BoundingSphere 는 ENU 로컬 원점(= 탄젠트 평면 중심)을 기준으로 설정합니다.
 * primitive.modelMatrix = enuToEcef 이 ECEF 위치를 결정합니다.
 *
 * @param {number} widthM    동-서 너비 (m)
 * @param {number} heightM   남-북 깊이 (m)
 * @param {number} resolution 한 축당 타일 수 (vertCount = (res+1)²)
 * @param {number} maxAmpM   최대 파고 — BoundingSphere 여유 반지름 (m)
 * @returns {Cesium.Geometry}
 */
function buildEnuGeometry(widthM, heightM, resolution, maxAmpM) {
  const cols = resolution + 1;
  const rows = resolution + 1;
  const vertCount = cols * rows;

  const positions = new Float32Array(vertCount * 3);
  const uvs       = new Float32Array(vertCount * 2);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const vi = r * cols + c;
      const u  = c / resolution;
      const v  = r / resolution;
      positions[vi * 3 + 0] = (u - 0.5) * widthM;   // East
      positions[vi * 3 + 1] = (v - 0.5) * heightM;  // North
      positions[vi * 3 + 2] = 0.0;                   // Up = 0 (flat)
      uvs[vi * 2 + 0] = u;
      uvs[vi * 2 + 1] = v;
    }
  }

  // 인덱스 배열 — 버텍스 수에 따라 16/32-bit 선택
  const triCount   = resolution * resolution * 2;
  const useUint32  = vertCount > 65_535;
  const IndexArray = useUint32 ? Uint32Array : Uint16Array;
  const indexDT    = useUint32
    ? Cesium.IndexDatatype.UNSIGNED_INT
    : Cesium.IndexDatatype.UNSIGNED_SHORT;

  const indices = new IndexArray(triCount * 3);
  let   ii      = 0;

  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      // CCW winding
      indices[ii++] = a; indices[ii++] = d; indices[ii++] = b;
      indices[ii++] = b; indices[ii++] = d; indices[ii++] = e;
    }
  }

  // BoundingSphere — ENU 로컬 원점 중심, 격자 반대각선 + 파고 여유
  const halfDiag = Math.sqrt(widthM * widthM + heightM * heightM) * 0.5;
  const bsRadius = halfDiag + Math.abs(maxAmpM) * 2.0 + 10.0;

  return new Cesium.Geometry({
    attributes: {
      a_enuPos: new Cesium.GeometryAttribute({
        componentDatatype:     Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: positions,
      }),
      a_st: new Cesium.GeometryAttribute({
        componentDatatype:     Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 2,
        values: uvs,
      }),
    },
    indices,
    indexDatatype: indexDT,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: new Cesium.BoundingSphere(Cesium.Cartesian3.ZERO, bsRadius),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Vertex Shader 빌더 — GLSL ES 1.00, 파도 파라미터 인라인
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gerstner 파도 파라미터를 GLSL 리터럴로 하드코딩한 버텍스 셰이더를 생성합니다.
 *
 * GLSL ES 1.00 호환 (Cesium WebGL 1 기본):
 *   - 배열 생성자 불가 → float[N](...) 미사용
 *   - 파라미터를 per-wave 코드 블록에 리터럴로 삽입
 *
 * 좌표계:
 *   a_enuPos:  (East, North, Up=0)     ENU 로컬 m
 *   dispENU:   (East+ΔE, North+ΔN, ΔU) 변위 적용 ENU
 *   normENU:   Gerstner 법선 → ENU 변환 (x=East, y=North, z=Up)
 *   worldPos:  czm_model * dispENU     ECEF 월드 좌표 (czm_model = enuToEcef)
 *
 * @param {import('../../core/types/WaveTypes.js').GerstnerWaveParams[]} waves
 * @returns {string}  GLSL 버텍스 셰이더 소스
 */
function buildVertexShader(waves) {
  const count = Math.min(waves.length, MAX_WAVES);

  // ── per-wave GLSL 블록 생성 ───────────────────────────────────────────────
  let waveBlocks = '';
  for (let i = 0; i < count; i++) {
    const w    = waves[i];
    const dx   = Number(w.direction[0]).toFixed(8);
    const dz   = Number(w.direction[1]).toFixed(8);
    const amp  = Number(w.amplitude).toFixed(8);
    const wlen = Number(Math.max(w.wavelength ?? 1.0, 0.001)).toFixed(8);
    const spd  = Number(w.speed).toFixed(8);
    const q    = Number(w.steepness).toFixed(8);   // Q (steepness / flatness param)

    waveBlocks += `
    /* ── Wave ${i} ──────────────────────── */
    {
      float k${i}    = 6.28318530718 / ${wlen};
      float phi${i}  = k${i} * (${dx} * xE + ${dz} * xN) + ${spd} * k${i} * u_time;
      float cP${i}   = cos(phi${i});
      float sP${i}   = sin(phi${i});
      // Gerstner 수평 변위 (Trochoidal): ΔEast, ΔNorth
      dispE += ${q} * ${amp} * ${dx} * cP${i};
      dispN += ${q} * ${amp} * ${dz} * cP${i};
      // 수직 변위: ΔUp
      dispU += ${amp} * sP${i};
      // 법선 누산 (Gerstner: N = (-ΣDx·k·A·cos, 1-ΣQ·k·A·sin, -ΣDz·k·A·cos))
      accNx -= ${dx} * k${i} * ${amp} * cP${i};  // East normal contrib
      accNy += ${q}  * k${i} * ${amp} * sP${i};  // Up   normal deduction
      accNz -= ${dz} * k${i} * ${amp} * cP${i};  // North normal contrib
    }`;
  }

  return /* glsl */`
  /* ── Attributes ─────────────────────────────────────────────────────────── */
  attribute vec3 a_enuPos;   /* (East m, North m, Up=0) ENU 로컬 */
  attribute vec2 a_st;       /* UV [0,1]² */

  /* ── Gerstner Uniforms ───────────────────────────────────────────────────── */
  uniform float u_time;      /* 경과 시간 (초) */

  /* ── Wake Uniforms (Phase 2c-3) ──────────────────────────────────────────── */
  uniform int   u_wakeCount;                    /* 활성 소스 수 (0 ~ 16)         */
  uniform vec4  u_wakeData[${MAX_WAKE_SOURCES}];   /* (x, z, vx, vz) ENU m·m/s     */
  uniform vec4  u_wakeParams[${MAX_WAKE_SOURCES}]; /* (strength, radiusM, ageSec, _) */
  uniform float u_wakeDecayTimeSec;             /* 감쇠 시간 상수 (초)            */
  uniform float u_wakeMinSpeedMs;               /* 최소 유효 속도 (m/s)           */

  /* ── Varyings ────────────────────────────────────────────────────────────── */
  varying vec3  v_normalWC;    /* 월드 법선 (ECEF) */
  varying vec3  v_positionWC;  /* 월드 위치 (ECEF) */
  varying float v_waveHeight;  /* 파고 ΔUp (m) */
  varying vec2  v_st;          /* UV */

  /* ── Main ────────────────────────────────────────────────────────────────── */
  void main() {
    float xE = a_enuPos.x;  /* East (m) */
    float xN = a_enuPos.y;  /* North (m) */

    /* Gerstner 변위 누산 */
    float dispE = 0.0;   /* ΔEast */
    float dispN = 0.0;   /* ΔNorth */
    float dispU = 0.0;   /* ΔUp (Gerstner 파고) */

    /* Gerstner 법선 누산 (ENU 기준) */
    float accNx = 0.0;
    float accNy = 0.0;
    float accNz = 0.0;

    ${waveBlocks}

    /* ── Wake 변위 (Phase 2c-3) ─────────────────────────────────────────────
     * core/shaders/wake.glsl 과 동일한 CPU 물리 모델:
     *   - 확장 링 파도: ringR = speed × ageSec
     *   - Gaussian 엔벨로프 × 방향성(V자) × 지수 감쇠
     */
    float wakeU = 0.0;
    for (int wi = 0; wi < ${MAX_WAKE_SOURCES}; wi++) {
      if (wi >= u_wakeCount) break;
      vec2  wpos   = u_wakeData[wi].xy;         /* (x, z) ENU 로컬 m */
      vec2  wvel   = u_wakeData[wi].zw;         /* (vx, vz) m/s */
      float wstr   = u_wakeParams[wi].x;
      float wrad   = u_wakeParams[wi].y;
      float wage   = u_wakeParams[wi].z;

      float wspeed = length(wvel);
      if (wspeed < u_wakeMinSpeedMs) continue;

      vec2  d     = vec2(xE, xN) - wpos;
      float r     = length(d) + 0.0001;
      float dDot  = dot(d, wvel) / (r * wspeed); /* -1 ~ +1 */
      float dirW  = max(0.0, -dDot);
      dirW        = dirW * dirW;                  /* V자 첨두 */

      float ringR  = wspeed * wage;
      float dr     = r - ringR;
      float sigma  = wrad * 0.55;
      float env    = exp(-0.5 * (dr / sigma) * (dr / sigma));
      float k      = 6.28318530718 / (wrad * 0.6);
      float osc    = cos(k * dr);
      float decay  = exp(-wage / u_wakeDecayTimeSec);

      wakeU += wstr * env * osc * dirW * decay;
    }
    dispU += wakeU;

    /* ── ENU 변위 위치 (x=East, y=North, z=Up) */
    vec3 dispENU = vec3(xE + dispE, xN + dispN, a_enuPos.z + dispU);

    /* ── ENU 법선 (x=East, y=North, z=Up) — Wake 는 법선 미반영 (P0 단순화) */
    vec3 normENU = normalize(vec3(accNx, accNz, 1.0 - accNy));

    /* ── ECEF 월드 변환 (czm_model = primitive.modelMatrix = enuToEcef) */
    vec4 worldPos   = czm_model * vec4(dispENU, 1.0);
    v_positionWC    = worldPos.xyz;
    v_normalWC      = normalize(mat3(czm_model) * normENU);
    v_waveHeight    = dispU;
    v_st            = a_st;

    gl_Position = czm_projection * czm_view * worldPos;
  }
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// GerstnerWaterPrimitiveGPU
// ─────────────────────────────────────────────────────────────────────────────

export class GerstnerWaterPrimitiveGPU {
  /**
   * @param {Cesium.Viewer} viewer
   * @param {import('../../core/types/WaveTypes.js').GerstnerWaveParams[]} waves
   * @param {{
   *   lon0?:              number,  수면 중심 경도 (도)
   *   lat0?:              number,  수면 중심 위도 (도)
   *   alt0?:              number,  수면 기준 고도 (m, 기본값 0)
   *   widthDeg?:          number,  수면 가로 크기 (도, 기본값 0.09 ≈ 10 km)
   *   heightDeg?:         number,  수면 세로 크기 (도)
   *   resolution?:        number,  격자 해상도 (기본값 64, 최대 255 권장)
   *   deepColor?:         Cesium.Color,
   *   shallowColor?:      Cesium.Color,
   *   buoyancyIterations?: number
   * }} [options]
   */
  constructor(viewer, waves, options = {}) {
    const {
      lon0               = 0,
      lat0               = 0,
      alt0               = 0,
      widthDeg           = 0.09,
      heightDeg          = 0.09,
      resolution         = 64,
      deepColor          = new Cesium.Color(0.00, 0.12, 0.28, 0.90),
      shallowColor       = new Cesium.Color(0.05, 0.48, 0.68, 0.90),
      buoyancyIterations = 3,
    } = options;

    this.viewer = viewer;

    /* CPU 솔버 — FloatingEntity 와 공유 */
    this.solver = new GerstnerWave(waves, { buoyancyIterations, baseY: alt0 });

    /* ENU 좌표 변환 */
    this.tangentPlane = new TangentPlane(lon0, lat0, alt0);

    this._startJD             = viewer.clock.currentTime.clone();
    this._currentTime         = 0;
    this._commandsIntercepted = false;

    /* vec3 색상 — uniformMap 에서 Cartesian3 로 반환 */
    this._deepColorV3    = new Cesium.Cartesian3(deepColor.red,    deepColor.green,    deepColor.blue);
    this._shallowColorV3 = new Cesium.Cartesian3(shallowColor.red, shallowColor.green, shallowColor.blue);

    /* ── Phase 2c-3: Wake uniform 상태 ──────────────────────────────────────
     * Float32Array 는 한 번 할당 후 updateWakeSources() 에서 in-place 갱신.
     * uniformMap getter 는 항상 같은 배열 참조를 반환 → GC 없음.
     */
    this._wakeCount    = 0;
    this._wakeDataArr  = new Float32Array(MAX_WAKE_SOURCES * 4);  // vec4[16]: x,z,vx,vz
    this._wakeParArr   = new Float32Array(MAX_WAKE_SOURCES * 4);  // vec4[16]: str,rad,age,pad
    this._wakeDecayT   = 8.0;    // 기본값 (interaction.json 연동 시 변경)
    this._wakeMinSpd   = 0.514;  // 기본값 1 knot = 0.514 m/s

    // ── 지오메트리 크기 계산 ─────────────────────────────────────────────────
    // 위도 방향: DEG2M_LAT, 경도 방향: cos(lat) 보정
    const cosLat  = Math.cos(Cesium.Math.toRadians(lat0));
    const widthM  = widthDeg  * DEG2M_LAT * cosLat;
    const heightM = heightDeg * DEG2M_LAT;

    // 최대 파고 (BoundingSphere 여유)
    const maxAmp = waves.reduce((s, w) => s + (w.amplitude ?? 0), 0);

    // ── Geometry ─────────────────────────────────────────────────────────────
    const geometry = buildEnuGeometry(widthM, heightM, resolution, maxAmp);

    // ── Shaders ──────────────────────────────────────────────────────────────
    const vs = buildVertexShader(waves);
    const fs = FRAGMENT_SHADER;

    // ── Primitive ─────────────────────────────────────────────────────────────
    // modelMatrix = enuToEcef → czm_model 이 ENU→ECEF 변환을 담당
    this._primitive = viewer.scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({ geometry }),
        appearance: new Cesium.Appearance({
          translucent:          true,
          closed:               false,
          vertexShaderSource:   vs,
          fragmentShaderSource: fs,
        }),
        modelMatrix:  this.tangentPlane.enuToEcef,
        asynchronous: false,
      }),
    );

    // ── preRender: 시간 갱신 + 첫 프레임 _commands 인터셉트 ──────────────────
    this._preRenderHandler = viewer.scene.preRender.addEventListener(
      (scene, julianDate) => {
        this._currentTime = Cesium.JulianDate.secondsDifference(
          julianDate, this._startJD,
        );
        this._tryInterceptCommands();
      },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 내부 메서드
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Primitive._commands 의 uniformMap 에 u_time / 색상 uniform 을 주입합니다.
   *
   * Cesium.Primitive 는 첫 프레임 렌더링 시 _commands 를 생성합니다.
   * 이후에는 인터셉트가 필요 없습니다 (참조를 변경하지 않으므로).
   *
   * @private
   */
  _tryInterceptCommands() {
    if (this._commandsIntercepted) return;
    if (!this._primitive || !this._primitive.ready) return;

    const cmds = this._primitive._commands;
    if (!cmds || cmds.length === 0) return;

    for (const cmd of cmds) {
      const base = cmd.uniformMap ?? {};
      cmd.uniformMap = Object.assign({}, base, {
        // ── Phase 2b ─────────────────────────────────────────────────────
        /** @returns {number} */
        u_time:         () => this._currentTime,
        /** @returns {Cesium.Cartesian3} */
        u_deepColor:    () => this._deepColorV3,
        /** @returns {Cesium.Cartesian3} */
        u_shallowColor: () => this._shallowColorV3,

        // ── Phase 2c-3: Wake uniforms ────────────────────────────────────
        /** @returns {number} */
        u_wakeCount:        () => this._wakeCount,
        /** @returns {Float32Array}  vec4[MAX_WAKE_SOURCES]: (x,z,vx,vz) */
        u_wakeData:         () => this._wakeDataArr,
        /** @returns {Float32Array}  vec4[MAX_WAKE_SOURCES]: (str,rad,age,pad) */
        u_wakeParams:       () => this._wakeParArr,
        /** @returns {number} */
        u_wakeDecayTimeSec: () => this._wakeDecayT,
        /** @returns {number} */
        u_wakeMinSpeedMs:   () => this._wakeMinSpd,
      });
    }

    this._commandsIntercepted = true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 공개 API  (GerstnerWaterPrimitive Phase 2a 와 동일)
  // ─────────────────────────────────────────────────────────────────────────

  /** 현재 시뮬레이션 시간 (초) */
  get currentTime() { return this._currentTime; }

  /** GerstnerWave CPU 솔버 (FloatingEntity 와 공유) */
  get gerstnerSolver() { return this.solver; }

  /** TangentPlane (ENU ↔ WGS84 변환) */
  get plane() { return this.tangentPlane; }

  /**
   * WGS84 위경도 지점의 Gerstner 수면 고도를 반환합니다.
   * @param {number} lonDeg 경도 (도)
   * @param {number} latDeg 위도 (도)
   * @returns {number} WGS84 고도 (m)
   */
  getWaterAltitude(lonDeg, latDeg) {
    return this.tangentPlane.getWaterAltitude(
      lonDeg, latDeg, this.solver, this._currentTime,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2c-3: Wake uniform 갱신
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Wake 소스 배열로 GPU uniform 버퍼를 갱신합니다.
   * `WakeRegistry` 가 `preRender` 이벤트 이후 자동으로 호출합니다.
   *
   * @param {import('../../core/types/InteractionTypes.js').WakeSource[]} sources  활성 WakeSource 배열
   * @param {{ decayTimeSec?: number, minSpeedKnots?: number }} [config]  Wake 설정 오버라이드
   */
  updateWakeSources(sources, config = {}) {
    if (config.decayTimeSec !== undefined) this._wakeDecayT = config.decayTimeSec;
    if (config.minSpeedKnots !== undefined) this._wakeMinSpd = config.minSpeedKnots * 0.514_444;

    const count = Math.min(sources.length, MAX_WAKE_SOURCES);
    this._wakeCount = count;

    for (let i = 0; i < count; i++) {
      const s  = sources[i];
      const d4 = i * 4;
      // vec4: (x, z, vx, vz) — ENU 로컬 미터·m/s
      this._wakeDataArr[d4 + 0] = s.x;
      this._wakeDataArr[d4 + 1] = s.z;
      this._wakeDataArr[d4 + 2] = s.vx;
      this._wakeDataArr[d4 + 3] = s.vz;
      // vec4: (strength, radiusM, ageSec, pad)
      this._wakeParArr[d4 + 0]  = s.strength;
      this._wakeParArr[d4 + 1]  = s.radiusM;
      this._wakeParArr[d4 + 2]  = s.ageSec;
      this._wakeParArr[d4 + 3]  = 0;
    }
    // 남은 슬롯 클리어 (이전 프레임 잔재 방지)
    for (let i = count; i < MAX_WAKE_SOURCES; i++) {
      const d4 = i * 4;
      this._wakeDataArr[d4] = this._wakeDataArr[d4+1] = 0;
      this._wakeDataArr[d4+2] = this._wakeDataArr[d4+3] = 0;
      this._wakeParArr[d4] = this._wakeParArr[d4+1] = 0;
      this._wakeParArr[d4+2] = this._wakeParArr[d4+3] = 0;
    }
  }

  /**
   * @param {boolean} visible
   */
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
  }
}
