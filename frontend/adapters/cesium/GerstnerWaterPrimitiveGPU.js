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

import { GerstnerWave }  from '../../core/math/GerstnerWave.js';
import { ObstacleField } from '../../core/math/ObstacleField.js';
import { seawardFloodHeight } from '../../core/math/barrierSurge.js';
import { bearingToEnu }  from '../../core/types/SceneTypes.js';
import { TangentPlane }  from './TangentPlane.js';

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

/** 위도 1도 ≈ 111 320 m  (위도 방향 스케일) */
const DEG2M_LAT = 111_320;

/** 지원 최대 파도 수 */
const MAX_WAVES = 8;

/** GPU fragment 에서 지원하는 최대 장애물 수 (ObstacleField.MAX_OBSTACLES 와 동일) */
const MAX_OBSTACLES = 8;

/** GPU Wake 소스 최대 슬롯 수 (GLSL 배열 크기 == InteractionTypes.MAX_WAKE_SOURCES) */
const MAX_WAKE_SOURCES = 16;

// ─────────────────────────────────────────────────────────────────────────────
// Fragment Shader (공통 — 파도 파라미터 독립)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fragment shader 를 생성합니다.
 *
 * ## Phase 4 추가 기능
 * * AABB 장애물 내부 → `discard` (dry zone, 벽·건물 footprint 만)
 * * **Barrier shield** — surge/파고 < 벽높이 일 때 landward 수면 서서히 약화 (일자 clip X)
 * * **Side overflow** — 벽 양끝 밖 미보호 구간 넘침 foam
 * * **Edge foam 강화** — 25 m 폭, 밝은 흰색 스플래시
 * * **Debug 모드** (`?debugObstacles=1`) — red=장애물내부, orange=landward, yellow=edge, blue=물
 *
 * @param {Cesium.Color} deep
 * @param {Cesium.Color} shallow
 * @param {import('../../core/math/ObstacleField.js').ObstacleField|null} obstacleField
 * @param {boolean} [debugObstacles=false]  URL ?debugObstacles=1 → 색상 오버레이
 * @returns {string}
 */
function buildFragmentShader(deep, shallow, obstacleField = null, debugObstacles = false) {
  const dr = deep.red.toFixed(4);
  const dg = deep.green.toFixed(4);
  const db = deep.blue.toFixed(4);
  const sr = shallow.red.toFixed(4);
  const sg = shallow.green.toFixed(4);
  const sb = shallow.blue.toFixed(4);
  const baseAlpha = ((deep.alpha + shallow.alpha) * 0.5).toFixed(4);

  // Phase 4: 장애물 AABB + landward(벽 E범위 내) + 양끝 넘침
  const obstacleGlsl = obstacleField && obstacleField.count > 0
    ? obstacleField.buildGlsl()
    : `
    float obstMinDist = 1.0e6;
    bool  isDry       = false;
`;
  const landwardGlsl = obstacleField && obstacleField.count > 0
    ? obstacleField.buildGlslBarrierShield()
    : `
    float barrierShield  = 0.0;
    float barrierOvertop = 0.0;
    float barrierSplash  = 0.0;
`;
  const sideOverflowGlsl = obstacleField && obstacleField.count > 0
    ? obstacleField.buildGlslSideOverflow()
    : 'float sideOverflow = 0.0;';

  // Debug 모드 리터럴
  const debugBool = debugObstacles ? 'true' : 'false';

  return /* glsl */`
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float hash31(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  in vec3  v_normalWC;
  in vec3  v_positionWC;
  in float v_waveHeight;
  in vec2  v_st;
  in vec2  v_enuPos;
  in float v_floodH;

  void main() {
    /* ─── Phase 4 상수 (빌드 타임 bake) ─────────────────────────────────── */
    const bool  u_debug          = ${debugBool};

    /* ─── Phase 4-A: AABB 장애물 dry zone ───────────────────────────────── */
    ${obstacleGlsl}

    /* ─── Phase 4-B: 차수벽 높이 기반 shield (일자 clip 없음) ───────────── */
    ${landwardGlsl}

    /* ─── Phase 4-D: 양끝 미보호 구간 넘침 ─────────────────────────────── */
    ${sideOverflowGlsl}

    /* ─── Debug 모드 (색상 오버레이) ─────────────────────────────────────── */
    if (u_debug) {
      if (isDry) {
        out_FragColor = vec4(1.0, 0.10, 0.10, 0.85);   /* red   = 장애물 내부 */
        return;
      }
      if (barrierShield > 0.35) {
        out_FragColor = vec4(1.0, 0.55, 0.05, 0.55 + barrierShield * 0.25);   /* orange = 보호(약화) */
        return;
      }
      if (barrierOvertop > 0.08) {
        out_FragColor = vec4(0.95, 0.35, 0.95, 0.85);   /* magenta = 넘침 */
        return;
      }
      if (sideOverflow > 0.08) {
        out_FragColor = vec4(1.0, 0.25, 0.15, 0.88);   /* red-orange = 양끝 넘침 */
        return;
      }
      float _dbgEdge = clamp(1.0 - obstMinDist / 25.0, 0.0, 1.0);
      if (_dbgEdge > 0.05) {
        out_FragColor = vec4(1.0, 1.0, 0.10, 0.9);     /* yellow = edge foam 범위 */
        return;
      }
      out_FragColor = vec4(0.08, 0.28, 1.0, 0.70);     /* blue   = 정상 수면 */
      return;
    }

    /* ─── 일반 모드: 건물·벽 footprint 내부만 제거 ─────────────────────── */
    if (isDry) discard;

    /* ─── 물 색상 계산 ──────────────────────────────────────────────────── */
    vec3 u_deepColor    = vec3(${dr}, ${dg}, ${db});
    vec3 u_shallowColor = vec3(${sr}, ${sg}, ${sb});

    vec3 N = normalize(v_normalWC);
    vec3 V = normalize(czm_viewerPositionWC - v_positionWC);

    float n1 = hash21(v_positionWC.xz * 0.11 + v_st * 22.0);
    float n2 = hash21(v_positionWC.xz * 0.17 + 3.7);
    float n3 = hash31(vec3(v_positionWC.xz * 0.06, float(czm_frameNumber) * 0.002));
    N.x += (n1 - 0.5) * 0.18;
    N.z += (n2 - 0.5) * 0.18;
    N = normalize(N);

    float cosTheta  = max(dot(N, V), 0.0);
    float fresnel   = 0.04 + 0.96 * pow(1.0 - cosTheta, 5.0);

    float irregular  = 0.62 + 0.38 * (n1 * 0.45 + n2 * 0.35 + n3 * 0.20);
    float shoreProx  = 1.0 - v_st.x;

    float crest     = smoothstep(0.02, 1.35, v_waveHeight * irregular + 0.06);
    float foam      = smoothstep(0.50, 1.75, v_waveHeight * irregular + 0.12);
    float shoreFoam = smoothstep(0.30, 0.88, shoreProx) * (0.35 + crest * 0.45);
    foam = max(foam, shoreFoam);

    float depthTint = clamp(-v_waveHeight * 0.12 + 0.45, 0.0, 1.0);
    vec3  skyReflect = mix(u_deepColor, u_shallowColor, 0.42);

    vec3 color = mix(
      u_deepColor,
      u_shallowColor,
      clamp(fresnel * 0.38 + crest * 0.22 + shoreProx * 0.14 + depthTint * 0.12, 0.0, 1.0)
    );
    color = mix(color, u_shallowColor, shoreProx * 0.10);
    color = mix(color, skyReflect, fresnel * 0.08);
    color = mix(color, vec3(0.82, 0.90, 0.88), foam * 0.22 * irregular);

    vec3  sunDir = normalize(vec3(0.30, 0.80, 0.50));
    vec3  H      = normalize(V + sunDir);
    float spec   = pow(max(dot(N, H), 0.0), 22.0) * irregular;
    color += mix(u_shallowColor, vec3(0.65, 0.78, 0.72), 0.5) * (spec * 0.07);

    float alpha = clamp(${baseAlpha} + fresnel * 0.04 + crest * 0.10, 0.0, 0.82);

    /* 격자 가장자리 — 위성 지도와 부드럽게 블렌드 */
    float meshEdge = smoothstep(0.0, 0.07, v_st.x) * smoothstep(0.0, 0.07, 1.0 - v_st.x)
                   * smoothstep(0.0, 0.05, v_st.y) * smoothstep(0.0, 0.05, 1.0 - v_st.y);
    alpha *= meshEdge;
    color = mix(color, u_deepColor, (1.0 - meshEdge) * 0.35);

    /* ─── Phase 4-C: 장애물 가장자리 foam/splash (강화 25 m) ────────────── */
    float edgeW    = 25.0;
    float edgeRaw  = clamp(1.0 - obstMinDist / edgeW, 0.0, 1.0);
    float edgeFoam = edgeRaw * edgeRaw;
    color = mix(color, vec3(0.97, 1.00, 1.00), edgeFoam * 0.92);
    alpha = min(1.0, alpha + edgeFoam * 0.50);

    /* ─── Phase 4-B2: 벽 뒤 보호(수위↓) · 넘침 · 충돌 splash ───────────── */
    color = mix(color, u_deepColor, barrierShield * 0.55);
    alpha *= (1.0 - barrierShield * 0.72);
    color = mix(color, vec3(0.98, 0.88, 1.0), barrierOvertop * 0.45);
    alpha = min(1.0, alpha + barrierOvertop * 0.25);
    color = mix(color, vec3(1.0, 0.98, 0.95), barrierSplash * 0.85);
    alpha = min(1.0, alpha + barrierSplash * 0.40);

    /* ─── Phase 4-E: 차수벽 양끝 밖 넘침 (주황·거품) ───────────────────── */
    color = mix(color, vec3(1.0, 0.42, 0.22), sideOverflow * 0.72);
    alpha = min(1.0, alpha + sideOverflow * 0.35);

    out_FragColor = vec4(color, alpha);
  }
`;
}

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
  const batchIds  = new Float32Array(vertCount);

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

  const boundingSphere = new Cesium.BoundingSphere(Cesium.Cartesian3.ZERO, bsRadius);
  const boundingSphereCV = Cesium.BoundingSphere.clone(boundingSphere);

  return new Cesium.Geometry({
    attributes: {
      // Cesium PrimitivePipeline 이 position.values 를 필수로 참조
      position: new Cesium.GeometryAttribute({
        componentDatatype:      Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: positions,
      }),
      a_enuPos: new Cesium.GeometryAttribute({
        componentDatatype:      Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: positions,
      }),
      a_st: new Cesium.GeometryAttribute({
        componentDatatype:      Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 2,
        values: uvs,
      }),
      batchId: new Cesium.GeometryAttribute({
        componentDatatype:      Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 1,
        values: batchIds,
      }),
      a_floodH: new Cesium.GeometryAttribute({
        componentDatatype:      Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 1,
        values: new Float32Array(vertCount),
      }),
    },
    indices,
    indexDatatype: indexDT,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere,
    boundingSphereCV,
  });
}

/**
 * 해안선에 맞춘 ENU 격자 — anchor 가 해안 중심, st.x=0 육지 / st.x=1 바다
 *
 * @param {import('../../core/types/SceneTypes.js').CoastAlignment} coast
 * @param {number} maxAmpM
 * @param {Float32Array|null} [floodHValues=null]  Phase 5: 정점별 홍수 수위 (m)
 * @returns {Cesium.Geometry}
 */
function buildCoastalEnuGeometry(coast, maxAmpM, floodHValues = null) {
  const along = bearingToEnu(coast.alongCoastBearingDeg);
  const sea   = bearingToEnu(coast.offshoreBearingDeg);
  const seaSpan   = coast.offshoreM + coast.landwardM;
  const alongSpan = coast.alongCoastM;
  const baseRes   = coast.resolution ?? 128;

  let resSea;
  let resAlong;
  if (seaSpan >= alongSpan) {
    resSea   = baseRes;
    resAlong = Math.max(12, Math.round(baseRes * alongSpan / seaSpan));
  } else {
    resAlong = baseRes;
    resSea   = Math.max(12, Math.round(baseRes * seaSpan / alongSpan));
  }

  const cols = resSea + 1;
  const rows = resAlong + 1;
  const vertCount = cols * rows;

  const positions = new Float32Array(vertCount * 3);
  const uvs       = new Float32Array(vertCount * 2);
  const batchIds  = new Float32Array(vertCount);
  const floodH    = (floodHValues && floodHValues.length === vertCount)
    ? floodHValues
    : new Float32Array(vertCount);

  let minE = Infinity;
  let maxE = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const vi = r * cols + c;
      const seaM   = -coast.landwardM + (c / resSea) * seaSpan;
      const alongM = -alongSpan * 0.5 + (r / resAlong) * alongSpan;
      const eastM  = seaM * sea.e + alongM * along.e;
      const northM = seaM * sea.n + alongM * along.n;

      positions[vi * 3 + 0] = eastM;
      positions[vi * 3 + 1] = northM;
      positions[vi * 3 + 2] = 0.0;
      uvs[vi * 2 + 0] = c / resSea;
      uvs[vi * 2 + 1] = r / resAlong;

      minE = Math.min(minE, eastM);
      maxE = Math.max(maxE, eastM);
      minN = Math.min(minN, northM);
      maxN = Math.max(maxN, northM);
    }
  }

  const triCount   = resSea * resAlong * 2;
  const useUint32  = vertCount > 65_535;
  const IndexArray = useUint32 ? Uint32Array : Uint16Array;
  const indexDT    = useUint32
    ? Cesium.IndexDatatype.UNSIGNED_INT
    : Cesium.IndexDatatype.UNSIGNED_SHORT;

  const indices = new IndexArray(triCount * 3);
  let   ii      = 0;

  for (let r = 0; r < resAlong; r++) {
    for (let c = 0; c < resSea; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      indices[ii++] = a; indices[ii++] = d; indices[ii++] = b;
      indices[ii++] = b; indices[ii++] = d; indices[ii++] = e;
    }
  }

  const centerE = (minE + maxE) * 0.5;
  const centerN = (minN + maxN) * 0.5;
  const halfDiag = Math.sqrt((maxE - minE) ** 2 + (maxN - minN) ** 2) * 0.5;
  const bsRadius = halfDiag + Math.abs(maxAmpM) * 2.0 + 10.0;
  const bsCenter = new Cesium.Cartesian3(centerE, centerN, 0.0);

  const boundingSphere = new Cesium.BoundingSphere(bsCenter, bsRadius);
  const boundingSphereCV = Cesium.BoundingSphere.clone(boundingSphere);

  return new Cesium.Geometry({
    attributes: {
      position: new Cesium.GeometryAttribute({
        componentDatatype:      Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: positions,
      }),
      a_enuPos: new Cesium.GeometryAttribute({
        componentDatatype:      Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: positions,
      }),
      a_st: new Cesium.GeometryAttribute({
        componentDatatype:      Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 2,
        values: uvs,
      }),
      batchId: new Cesium.GeometryAttribute({
        componentDatatype:      Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 1,
        values: batchIds,
      }),
      a_floodH: new Cesium.GeometryAttribute({
        componentDatatype:      Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 1,
        values: floodH,
      }),
    },
    indices,
    indexDatatype: indexDT,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere,
    boundingSphereCV,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Vertex Shader 빌더 — GLSL ES 1.00, 파도 파라미터 인라인
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {import('../../core/types/SceneTypes.js').CoastAlignment} coast
 * @param {number} fallbackRes
 */
function computeCoastGridRes(coast, fallbackRes) {
  const seaSpan   = coast.offshoreM + coast.landwardM;
  const alongSpan = coast.alongCoastM;
  const baseRes   = coast.resolution ?? fallbackRes;
  if (seaSpan >= alongSpan) {
    return {
      resSea:   baseRes,
      resAlong: Math.max(12, Math.round(baseRes * alongSpan / seaSpan)),
    };
  }
  return {
    resAlong: baseRes,
    resSea:   Math.max(12, Math.round(baseRes * seaSpan / alongSpan)),
  };
}

/**
 * Gerstner 파도 파라미터를 GLSL 리터럴로 하드코딩한 버텍스 셰이더를 생성합니다.
 *
 * GLSL ES 1.00 호환 (Cesium WebGL 1 기본):
 *   - 배열 생성자 불가 → float[N](...) 미사용
 *   - 파라미터를 per-wave 코드 블록에 리터럴로 삽입
 *
 * ## Phase 5 flood
 *   `a_floodH` 속성 — CPU ShallowWater 격자 샘플 (2D). uniform/1D 전선 bake 사용 안 함.
 *
 * @param {import('../../core/types/WaveTypes.js').GerstnerWaveParams[]} waves
 * @param {number} [ampScale=1]
 * @param {number} [baseWaterM=0]
 * @returns {string}
 */
function buildVertexShader(waves, ampScale = 1, baseWaterM = 0) {
  const count = Math.min(waves.length, MAX_WAVES);
  const scale = Math.max(ampScale, 0.05);
  const baseW = Math.max(0, baseWaterM).toFixed(8);

  // ── per-wave GLSL 블록 생성 ───────────────────────────────────────────────
  let waveBlocks = '';
  for (let i = 0; i < count; i++) {
    const w    = waves[i];
    const dx   = Number(w.direction[0]).toFixed(8);
    const dz   = Number(w.direction[1]).toFixed(8);
    const amp  = Number(w.amplitude * scale).toFixed(8);
    const wlen = Number(Math.max(w.wavelength ?? 1.0, 0.001)).toFixed(8);
    const spd  = Number(w.speed).toFixed(8);
    const phase  = Number(w.phase ?? 0).toFixed(8);
    const q    = Number(w.steepness).toFixed(8);

    waveBlocks += `
    /* ── Wave ${i} ──────────────────────── */
    {
      float k${i}    = 6.28318530718 / ${wlen};
      float phi${i}  = k${i} * (${dx} * xE + ${dz} * xN) + ${spd} * k${i} * (float(czm_frameNumber) * 0.016) + ${phase};
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

  // ── Phase 5: 2D 홍수 + 정수위 (파고 ripple 과 분리) ───────────────────────
  const floodBaked = /* glsl */`
    float _surgeH = ${baseW} + max(0.0, a_floodH);
    dispU += _surgeH;
`;

  return /* glsl */`
  in vec3 a_enuPos;
  in vec2 a_st;
  in float batchId;
  in float a_floodH;

  out vec3  v_normalWC;
  out vec3  v_positionWC;
  out float v_waveHeight;
  out vec2  v_st;
  out vec2  v_enuPos;
  out float v_floodH;   /* Phase 4: 미변위 ENU (East, North) m — 장애물 마스크용 */

  void main() {
    float xE = a_enuPos.x;
    float xN = a_enuPos.y;

    float dispE = 0.0;
    float dispN = 0.0;
    float dispU = 0.0;
    float accNx = 0.0;
    float accNy = 0.0;
    float accNz = 0.0;

    ${waveBlocks}

    ${floodBaked}

    float tChop = float(czm_frameNumber) * 0.016;
    float chop1 = 0.22 * sin(xE * 0.127853 + xN * 0.091237 + tChop * 1.83);
    float chop2 = 0.15 * sin(xE * 0.237641 - xN * 0.173529 + tChop * 2.41);
    float chop3 = 0.11 * sin(xE * 0.319271 + xN * 0.271829 - tChop * 1.17);
    float chop4 = 0.08 * sin(xE * 0.441029 - xN * 0.382117 + tChop * 3.07);
    vec2  nGrd  = vec2(xE * 0.0317 + tChop * 0.09, xN * 0.0273 + tChop * 0.13);
    float chopN = (fract(sin(dot(floor(nGrd), vec2(127.1, 311.7))) * 43758.5453) - 0.5) * 0.45;
    float chopH = chop1 + chop2 + chop3 + chop4 + chopN;
    dispU += chopH * ${scale.toFixed(8)};

    vec3 dispENU = vec3(xE + dispE, xN + dispN, a_enuPos.z + dispU);
    vec3 normENU = normalize(vec3(accNx, accNz, 1.0 - accNy));

    float nPx = fract(sin(dot(vec2(xE * 0.041, xN * 0.038), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    float nPy = fract(sin(dot(vec2(xE * 0.052, xN * 0.033), vec2(39.3468, 11.1355))) * 43758.5453) - 0.5;
    normENU.xz += vec2(nPx, nPy) * 0.12;
    normENU = normalize(normENU);

    vec4 worldPos   = czm_model * vec4(dispENU, 1.0);
    v_positionWC    = worldPos.xyz;
    v_normalWC      = normalize(mat3(czm_model) * normENU);
    v_waveHeight    = dispU;
    v_floodH        = _surgeH;
    v_st            = a_st;
    v_enuPos        = vec2(xE, xN);   /* Phase 4: 미변위 ENU 위치 → fragment 로 전달 */

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
   *   coastAlignment?:    import('../../core/types/SceneTypes.js').CoastAlignment
   *   deepColor?:         Cesium.Color,
   *   shallowColor?:      Cesium.Color,
   *   buoyancyIterations?: number
   *   obstacleBoxes?:     import('../../core/types/ObstacleTypes.js').ObstacleBox[]
   *     Phase 4: ENU AABB 장애물 배열 — GPU fragment dry masking
   *   debugObstacles?:    boolean
   *     Phase 4: true → ?debugObstacles=1 URL 파라미터 — 색상 오버레이 렌더
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
      coastAlignment     = null,
      deepColor          = new Cesium.Color(0.05, 0.13, 0.16, 0.58),
      shallowColor       = new Cesium.Color(0.10, 0.28, 0.30, 0.52),
      buoyancyIterations = 3,
      obstacleBoxes      = [],
      debugObstacles     = false,
    } = options;

    this.viewer = viewer;
    this._baseWaves = waves;

    /* CPU 솔버 — FloatingEntity 와 공유 */
    this.solver = new GerstnerWave(waves, { buoyancyIterations, baseY: alt0 });

    /* ENU 좌표 변환 */
    this.tangentPlane = new TangentPlane(lon0, lat0, alt0);

    this._startMs         = performance.now();
    this._currentTime     = 0;
    this._amplitudeScale  = 1.0;
    this._baseWaterLevelM = 0;
    this._modelScratch    = new Cesium.Matrix4();
    this._scaleScratch    = new Cesium.Matrix4();
    this._commandsIntercepted = false;
    this._coastAlignment  = coastAlignment;
    this._debugObstacles  = debugObstacles;
    this._deepColor       = deepColor;
    this._shallowColor    = shallowColor;
    this._alt0            = alt0;
    this._waves           = waves;

    /* vec3 색상 — uniformMap 에서 Cartesian3 로 반환 */
    this._deepColorV3    = new Cesium.Cartesian3(deepColor.red,    deepColor.green,    deepColor.blue);
    this._shallowColorV3 = new Cesium.Cartesian3(shallowColor.red, shallowColor.green, shallowColor.blue);

    /* ── Phase 2c-3: Wake uniform 상태 ──────────────────────────────────────
     * Cesium vec4[] uniform 은 Cartesian4[] 배열 필요
     */
    this._wakeCount    = 0;
    this._wakeDataVec4 = Array.from(
      { length: MAX_WAKE_SOURCES },
      () => new Cesium.Cartesian4(),
    );
    this._wakeParVec4  = Array.from(
      { length: MAX_WAKE_SOURCES },
      () => new Cesium.Cartesian4(),
    );
    this._wakeDecayT   = 8.0;    // 기본값 (interaction.json 연동 시 변경)
    this._wakeMinSpd   = 0.514;  // 기본값 1 knot = 0.514 m/s

    // ── Phase 4: ObstacleField (CPU + GPU 셰이더 공유) ──────────────────────
    /** @type {ObstacleField} */
    this._obstacleField = new ObstacleField(obstacleBoxes ?? []);

    // ── Phase 5: FloodLayer (연결 전까지 null) ───────────────────────────
    /** @type {import('./FloodLayer.js').FloodLayer|null} */
    this._floodLayer  = null;
    /** @type {Float32Array|null} Phase 5: 정점별 홍수 수위 (m) */
    this._floodH       = null;
    /** @type {number} */
    this._vertCount    = 0;

    // ── 지오메트리 크기 계산 ─────────────────────────────────────────────────
    // 위도 방향: DEG2M_LAT, 경도 방향: cos(lat) 보정
    const cosLat  = Math.cos(Cesium.Math.toRadians(lat0));
    const widthM  = widthDeg  * DEG2M_LAT * cosLat;
    const heightM = heightDeg * DEG2M_LAT;
    const meshRes = coastAlignment?.resolution ?? resolution;

    // 최대 파고 (BoundingSphere 여유)
    const maxAmp = waves.reduce((s, w) => s + (w.amplitude ?? 0), 0);
    this._meshRes = meshRes;
    this._maxAmp  = maxAmp;
    this._widthM  = widthM;
    this._heightM = heightM;

    // ── Primitive (bounding volume 함수는 add 전에 설정) ─────────────────────
    let geometry;
    if (coastAlignment) {
      const { resSea, resAlong } = computeCoastGridRes(coastAlignment, meshRes);
      this._vertCount = (resSea + 1) * (resAlong + 1);
      this._floodH    = new Float32Array(this._vertCount);
      geometry        = buildCoastalEnuGeometry(coastAlignment, maxAmp, this._floodH);
      this._storeEnuPositions(geometry);
    } else {
      geometry        = buildEnuGeometry(widthM, heightM, meshRes, maxAmp);
      this._vertCount = geometry.attributes.position.values.length / 3;
      this._floodH    = new Float32Array(this._vertCount);
      this._storeEnuPositions(geometry);
    }

    const vs = buildVertexShader(waves, this._amplitudeScale, this._baseWaterLevelM);
    const fs = buildFragmentShader(deepColor, shallowColor, this._obstacleField, debugObstacles);

    const halfDiag = coastAlignment
      ? Math.sqrt(
          (coastAlignment.offshoreM + coastAlignment.landwardM) ** 2 +
          coastAlignment.alongCoastM ** 2,
        ) * 0.5
      : Math.sqrt(widthM * widthM + heightM * heightM) * 0.5;
    const bsRadius = halfDiag + Math.abs(maxAmp) * 2.0 + 10.0;

    const prim = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance: new Cesium.Appearance({
        translucent:          true,
        closed:               false,
        vertexShaderSource:   vs,
        fragmentShaderSource: fs,
        renderState: Cesium.RenderState.fromCache({
          depthTest: { enabled: true },
          depthMask: false,
          blending:  Cesium.BlendingState.ALPHA_BLEND,
          cull:      { enabled: false },
        }),
      }),
      modelMatrix:      this.tangentPlane.enuToEcef,
      compressVertices: false,
      asynchronous:     false,
      allowPicking:     false,
    });
    this._appearance = prim.appearance;
    this._updateModelMatrix();

    prim._createBoundingVolumeFunction = (_frameState, geom) => {
      const fallback = new Cesium.BoundingSphere(Cesium.Cartesian3.ZERO, bsRadius);
      const bs = Cesium.BoundingSphere.clone(geom?.boundingSphere ?? fallback);
      const cv = Cesium.BoundingSphere.clone(geom?.boundingSphereCV ?? geom?.boundingSphere ?? fallback);
      prim._boundingSpheres.push(bs);
      prim._boundingSphereWC.push(new Cesium.BoundingSphere());
      prim._boundingSphereCV.push(cv);
      prim._boundingSphere2D.push(new Cesium.BoundingSphere());
      prim._boundingSphereMorph.push(new Cesium.BoundingSphere());
    };

    this._primitive = viewer.scene.primitives.add(prim);

    // ── preRender: u_time 갱신 ───────────────────────────────────────────────
    this._preRenderHandler = viewer.scene.preRender.addEventListener(() => {
      this._currentTime = (performance.now() - this._startMs) / 1000;
    });
  }

  /**
   * ENU 수직(Up) 파고 배율 — modelMatrix 로 GPU 변위 크기 조절
   * @private
   */
  _updateModelMatrix() {
    // Z 스케일 1.0 — 파고는 VS ampScale, 홍수는 a_floodH (m) 로 분리
    Cesium.Matrix4.clone(this.tangentPlane.enuToEcef, this._modelScratch);
    if (this._primitive) {
      this._primitive.modelMatrix = this._modelScratch;
    }
  }

  /**
   * @deprecated uniform 인터셉트 미사용
   * @private
   */
  _tryInterceptCommands() {
    if (this._commandsIntercepted) return;
    if (!this._primitive || !this._primitive.ready) return;
    const cmds = this._primitive._commands;
    if (!cmds || cmds.length === 0) return;
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

  /** Phase 4: ObstacleField (CPU dry test + GPU buildGlsl) */
  get obstacleField() { return this._obstacleField; }

  /** @returns {number} */
  get amplitudeScale() { return this._amplitudeScale; }

  /** @returns {number} */
  get baseWaterLevelM() { return this._baseWaterLevelM; }

  /**
   * 정수위(홍수 기준면) 오프셋 — overflow 판정·부력에 사용
   * @param {number} levelM
   */
  setBaseWaterLevel(levelM) {
    this._baseWaterLevelM = Math.max(0, levelM);
    this.solver.baseY = this._alt0 + this._baseWaterLevelM;
    this._rebuildVertexShader();
  }

  /**
   * Phase 4: 장애물 AABB 갱신 → fragment shader 재빌드
   * @param {import('../../core/types/ObstacleTypes.js').ObstacleBox[]} boxes
   */
  updateObstacleBoxes(boxes) {
    this._obstacleField = new ObstacleField(boxes ?? []);
    this._rebuildFragmentShader();
  }

  /**
   * 해안 정렬 수면 범위 갱신 → geometry 재생성
   * @param {import('../../core/types/SceneTypes.js').CoastAlignment} coast
   */
  updateCoastAlignment(coast) {
    this._coastAlignment = { ...coast };
    this._meshRes = coast.resolution ?? this._meshRes;
    if (!this._coastAlignment) return;

    const { resSea, resAlong } = computeCoastGridRes(this._coastAlignment, this._meshRes);
    this._vertCount = (resSea + 1) * (resAlong + 1);
    this._floodH    = new Float32Array(this._vertCount);
    const geometry  = buildCoastalEnuGeometry(this._coastAlignment, this._maxAmp, this._floodH);
    this._storeEnuPositions(geometry);
    this._replaceGeometry(geometry);
  }

  /**
   * @private
   * @param {Cesium.Geometry} geometry
   */
  _storeEnuPositions(geometry) {
    const pos = geometry.attributes.position.values;
    this._enuPositions = pos instanceof Float32Array ? pos.slice() : new Float32Array(pos);
  }

  /** @private */
  _rebuildFragmentShader() {
    const fs = buildFragmentShader(
      this._deepColor,
      this._shallowColor,
      this._obstacleField,
      this._debugObstacles,
    );
    const newAppearance = new Cesium.Appearance({
      translucent:          true,
      closed:               false,
      vertexShaderSource:   this._appearance.vertexShaderSource,
      fragmentShaderSource: fs,
      renderState:          this._appearance.renderState,
    });
    this._appearance = newAppearance;
    if (this._primitive) {
      this._primitive.appearance = newAppearance;
    }
    this.viewer.scene.requestRender();
  }

  /**
   * Phase 5: flood 전선을 GLSL 리터럴로 bake 한 버텍스 셰이더 재빌드.
   *
   * `this._floodFrontN` / `this._floodMaxH` 를 읽어 재빌드합니다.
   * uniform 선언 없음 → DrawCommand 재생성 후 crash 없음.
   * @private
   */
  _rebuildVertexShader() {
    const vs = buildVertexShader(
      this._waves,
      this._amplitudeScale,
      this._baseWaterLevelM,
    );
    const newAppearance = new Cesium.Appearance({
      translucent:          true,
      closed:               false,
      vertexShaderSource:   vs,
      fragmentShaderSource: this._appearance.fragmentShaderSource,
      renderState:          this._appearance.renderState,
    });
    this._appearance = newAppearance;
    if (this._primitive) {
      this._primitive.appearance = newAppearance;
    }
    this.viewer.scene.requestRender();
  }

  /**
   * Phase 5: FloodLayer 연결
   * @param {import('./FloodLayer.js').FloodLayer} floodLayer
   */
  connectFlood(floodLayer) {
    this._floodLayer = floodLayer;
    floodLayer.attachOcean(this);
    console.log('[GerstnerGPU] FloodLayer connected (2D height field mode)');
  }

  /**
   * Phase 5: CPU ShallowWater 격자 → 정점별 a_floodH 갱신
   * @param {(e: number, n: number) => number} sampleFn  ENU (m) → 홍수 수위 (m)
   */
  updateFloodHeightField(sampleFn) {
    if (!this._coastAlignment || !this._floodH || !this._enuPositions) return;

    for (let vi = 0; vi < this._vertCount; vi++) {
      const e = this._enuPositions[vi * 3 + 0];
      const n = this._enuPositions[vi * 3 + 1];
      this._floodH[vi] = Math.max(0, sampleFn(e, n));
    }

    const geometry = buildCoastalEnuGeometry(
      this._coastAlignment,
      this._maxAmp,
      this._floodH,
    );
    this._replaceGeometry(geometry);
  }

  /** 홍수 수위 필드 제거 (정수위만 VS 에 유지) */
  clearFloodHeightField() {
    if (!this._floodH || !this._coastAlignment) return;
    this._floodH.fill(0);
    const geometry = buildCoastalEnuGeometry(
      this._coastAlignment,
      this._maxAmp,
      this._floodH,
    );
    this._replaceGeometry(geometry);
  }

  /**
   * @deprecated FloodLayer → updateFloodHeightField 사용
   */
  updateFloodFront(_frontN, effectiveMaxH) {
    if (effectiveMaxH <= 0) {
      this.clearFloodHeightField();
    }
  }

  /**
   * 넘침·수위 판정 — 정수위 + 홍수 (파고 crest 제외)
   * @returns {number}
   */
  getSurgeLevelM() {
    let surge = this._baseWaterLevelM;
    if (this._floodLayer?.active) {
      surge += this._floodLayer.getMaxSimHeight() * (this._floodLayer.blend ?? 1);
    }
    return surge;
  }

  /**
   * ENU 지점 홍수+정수위 (넘침 판정)
   * @param {number} e
   * @param {number} n
   * @returns {number}
   */
  getSurgeAt(e, n) {
    let h = this._baseWaterLevelM;
    if (this._floodLayer) {
      h += this._floodLayer.sampleHeightAt(e, n);
    }
    return h;
  }

  /**
   * 차수벽 넘침 판정용 surge — 벽 seaward(유입측) 면에 실제로 작용하는 수위.
   * 벽 footprint 내부는 wall mask 로 h=0 (dry) 이므로 중심 샘플(getSurgeAt)은
   * 홍수를 못 봄. 벽 남쪽 면 바로 앞을 벽 길이 방향으로 훑어 최대치를 쓴다.
   * ponytail: 유입은 항상 ShallowWater 격자 j=0(남쪽) → seaward = -N 고정.
   *           북쪽 유입 시나리오가 생기면 방향 인자 추가.
   * @param {{centerE:number, centerN:number, halfE:number, halfN:number}} b
   * @returns {number}
   */
  getSurgeForBarrier(b) {
    const base = this._baseWaterLevelM;
    if (!this._floodLayer?.active) return base;
    return base + seawardFloodHeight(this._floodLayer, b);
  }

  /**
   * @deprecated getSurgeLevelM / getSurgeAt 사용 (파고와 분리)
   * @returns {number}
   */
  getEffectiveWaterHeightM() {
    return this.getSurgeLevelM();
  }

  /**
   * @private
   * @param {Cesium.Geometry} geometry
   */
  _replaceGeometry(geometry) {
    const halfDiag = this._coastAlignment
      ? Math.sqrt(
          (this._coastAlignment.offshoreM + this._coastAlignment.landwardM) ** 2 +
          this._coastAlignment.alongCoastM ** 2,
        ) * 0.5
      : Math.sqrt(this._widthM * this._widthM + this._heightM * this._heightM) * 0.5;
    const bsRadius = halfDiag + Math.abs(this._maxAmp) * 2.0 + 10.0;

    if (this._primitive && !this._primitive.isDestroyed()) {
      this.viewer.scene.primitives.remove(this._primitive);
    }

    const prim = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance:        this._appearance,
      modelMatrix:       this._modelScratch,
      compressVertices:  false,
      asynchronous:      false,
      allowPicking:      false,
    });

    prim._createBoundingVolumeFunction = (_frameState, geom) => {
      const fallback = new Cesium.BoundingSphere(Cesium.Cartesian3.ZERO, bsRadius);
      const bs = Cesium.BoundingSphere.clone(geom?.boundingSphere ?? fallback);
      const cv = Cesium.BoundingSphere.clone(geom?.boundingSphereCV ?? geom?.boundingSphere ?? fallback);
      prim._boundingSpheres.push(bs);
      prim._boundingSphereWC.push(new Cesium.BoundingSphere());
      prim._boundingSphereCV.push(cv);
      prim._boundingSphere2D.push(new Cesium.BoundingSphere());
      prim._boundingSphereMorph.push(new Cesium.BoundingSphere());
    };

    this._primitive = this.viewer.scene.primitives.add(prim);
    this._updateModelMatrix();
    this.viewer.scene.requestRender();
  }

  /**
   * 현재 파고 crest (시각·foam 전용, 넘침 판정 X)
   * @returns {number}
   */
  getWaveCrestM() {
    const crest = this._baseWaves.reduce((s, w) => s + (w.amplitude ?? 0), 0) * this._amplitudeScale;
    return crest;
  }

  /**
   * 실시간 파고 배율 (waves.json 기준)
   * @param {number} scale  0.2 ~ 2.5 권장
   */
  setAmplitudeScale(scale) {
    this._amplitudeScale = Math.max(0.05, scale);
    this.solver.amplitudeScale = this._amplitudeScale;
    this._rebuildVertexShader();
  }

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
      const s = sources[i];
      Cesium.Cartesian4.fromElements(s.x, s.z, s.vx, s.vz, this._wakeDataVec4[i]);
      Cesium.Cartesian4.fromElements(s.strength, s.radiusM, s.ageSec, 0, this._wakeParVec4[i]);
    }
    for (let i = count; i < MAX_WAKE_SOURCES; i++) {
      Cesium.Cartesian4.fromElements(0, 0, 0, 0, this._wakeDataVec4[i]);
      Cesium.Cartesian4.fromElements(0, 0, 0, 0, this._wakeParVec4[i]);
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
