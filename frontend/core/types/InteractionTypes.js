/**
 * InteractionTypes.js — Phase 2c 데이터 구조 정의
 *
 * Wake(尾迹)·Collision·Performance 설정을 위한 타입과 팩토리 함수.
 *
 * ## 설계 원칙
 *
 * * `core/` 원칙 준수: **Cesium·Three.js import 절대 금지**
 * * 모든 좌표는 **Gerstner 로컬** (x=East, z=North, y=Up) 미터 단위
 * * GPU 전달용 flat 배열(`packWakeSources`) 포함
 *
 * ## WakeSource 좌표계
 *
 * ```
 *  Gerstner 로컬 ENU (TangentPlane 기준)
 *    x = East  (m)
 *    z = North (m)
 *    vx/vz = 속도 (m/s)
 * ```
 *
 * @module core/types/InteractionTypes
 */

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

/** GPU uniform 배열 최대 Wake 소스 수 */
export const MAX_WAKE_SOURCES = 16;

/** 노트 → m/s 변환 계수 */
export const KNOTS_TO_MS = 0.514_444;

// ─────────────────────────────────────────────────────────────────────────────
// WakeSource
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} WakeSource
 * @property {string}  id          — 고유 식별자 (FloatingEntity id 등)
 * @property {number}  x           — ENU East 위치 (m)
 * @property {number}  z           — ENU North 위치 (m)
 * @property {number}  vx          — 속도 East 성분 (m/s)
 * @property {number}  vz          — 속도 North 성분 (m/s)
 * @property {number}  strength    — 0~1 파도 세기
 * @property {number}  radiusM     — 기준 파도 반지름 (m)
 * @property {number}  ageSec      — 소스 생성 후 경과 시간 (s)
 * @property {boolean} active      — false면 스킵
 */

/**
 * WakeSource 객체를 기본값과 함께 생성합니다.
 *
 * @param {string} id
 * @param {number} x        ENU East 위치 (m)
 * @param {number} z        ENU North 위치 (m)
 * @param {number} vx       속도 East 성분 (m/s)
 * @param {number} vz       속도 North 성분 (m/s)
 * @param {{
 *   strength?: number,
 *   radiusM?:  number,
 * }} [options]
 * @returns {WakeSource}
 */
export function createWakeSource(id, x, z, vx, vz, options = {}) {
  return {
    id,
    x,    z,
    vx,   vz,
    strength: options.strength ?? 0.4,
    radiusM:  options.radiusM  ?? 25,
    ageSec:   0,
    active:   true,
  };
}

/**
 * WakeSource 배열을 GPU 전달용 flat Float32Array 로 패킹합니다.
 *
 * GPU 레이아웃 (per source, stride 8 floats):
 *   [x, z, vx, vz, strength, radiusM, ageSec, _pad]
 *
 * @param {WakeSource[]} sources
 * @param {number} [maxCount=MAX_WAKE_SOURCES]
 * @returns {{ data: Float32Array, count: number }}
 */
export function packWakeSources(sources, maxCount = MAX_WAKE_SOURCES) {
  const STRIDE  = 8;
  const active  = sources.filter(s => s.active).slice(0, maxCount);
  const data    = new Float32Array(maxCount * STRIDE);

  for (let i = 0; i < active.length; i++) {
    const s   = active[i];
    const off = i * STRIDE;
    data[off + 0] = s.x;
    data[off + 1] = s.z;
    data[off + 2] = s.vx;
    data[off + 3] = s.vz;
    data[off + 4] = s.strength;
    data[off + 5] = s.radiusM;
    data[off + 6] = s.ageSec;
    data[off + 7] = 0; // padding
  }

  return { data, count: active.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// CollisionBody
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} CollisionBody
 * @property {string} id
 * @property {number} lon              — WGS84 경도 (도)
 * @property {number} lat              — WGS84 위도 (도)
 * @property {number} hullHalfWidthM   — 선체 반폭 (m)
 * @property {number} hullDraftM       — 홀수선 깊이 (m) — 수면 아래
 * @property {number} massKg           — 질량 (kg, 부력 계산용)
 */

/**
 * @param {string} id
 * @param {number} lon
 * @param {number} lat
 * @param {{
 *   hullHalfWidthM?: number,
 *   hullDraftM?:     number,
 *   massKg?:         number,
 * }} [options]
 * @returns {CollisionBody}
 */
export function createCollisionBody(id, lon, lat, options = {}) {
  return {
    id,
    lon, lat,
    hullHalfWidthM: options.hullHalfWidthM ?? 5,
    hullDraftM:     options.hullDraftM     ?? 2,
    massKg:         options.massKg         ?? 10_000,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 설정 로더
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `interaction.json` 데이터를 파싱해 정규화된 설정 객체를 반환합니다.
 *
 * @param {object} data  JSON.parse(interaction.json)
 * @returns {{
 *   wake:        { maxSources:number, defaultStrength:number, defaultRadiusM:number, decayTimeSec:number, minSpeedKnots:number },
 *   collision:   { buoyancyIterations:number, submergeThresholdM:number, dragCoefficient:number },
 *   performance: { heightFieldCacheTileSizeM:number, heightFieldCacheRefreshHz:number, maxEntitiesPerFrame:number },
 * }}
 */
export function loadInteractionConfig(data) {
  const w = data.wake        ?? {};
  const c = data.collision   ?? {};
  const p = data.performance ?? {};

  return {
    wake: {
      maxSources:      w.maxSources      ?? MAX_WAKE_SOURCES,
      defaultStrength: w.defaultStrength ?? 0.4,
      defaultRadiusM:  w.defaultRadiusM  ?? 25,
      decayTimeSec:    w.decayTimeSec    ?? 8,
      minSpeedKnots:   w.minSpeedKnots   ?? 1.0,
    },
    collision: {
      buoyancyIterations: c.buoyancyIterations  ?? 3,
      submergeThresholdM: c.submergeThresholdM  ?? 0.2,
      dragCoefficient:    c.dragCoefficient     ?? 0.05,
    },
    performance: {
      heightFieldCacheTileSizeM: p.heightFieldCacheTileSizeM ?? 64,
      heightFieldCacheRefreshHz: p.heightFieldCacheRefreshHz ?? 10,
      maxEntitiesPerFrame:       p.maxEntitiesPerFrame       ?? 32,
    },
  };
}
