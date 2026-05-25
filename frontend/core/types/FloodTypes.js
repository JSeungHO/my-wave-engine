/**
 * FloodTypes.js — Phase 5 홍수 시뮬레이션 설정 타입
 *
 * `Configs/flood.json` 파싱 및 타입 정의.
 *
 * ## 설계 원칙
 * * `core/` 원칙 준수 — Cesium·Three.js import 절대 금지
 *
 * @module core/types/FloodTypes
 * @see Configs/flood.json   실제 설정값
 * @see docs/FLOOD.md §2     스펙 문서
 */

// ─────────────────────────────────────────────────────────────────────────────
// JSDoc 타입
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   cellSizeM: number,
 *   widthM:    number,
 *   depthM:    number,
 *   originE:   number,
 *   originN:   number,
 * }} FloodGridConfig
 *
 * @typedef {{
 *   bearingDeg:   number,
 *   rateM3PerSec: number,
 *   baseHeightM:  number,
 * }} FloodInflowConfig
 *
 * @typedef {{
 *   grid:          FloodGridConfig,
 *   inflow:        FloodInflowConfig,
 *   gerstnerBlend: number,
 *   speedFactor:   number,
 *   maxHeightM:    number,
 * }} FloodConfig
 */

// ─────────────────────────────────────────────────────────────────────────────
// 로더
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `flood.json` JSON 오브젝트를 검증하고 정규화된 `FloodConfig` 를 반환합니다.
 *
 * @param {object} json  flood.json 파싱 결과
 * @returns {FloodConfig}
 */
export function loadFloodConfig(json) {
  const g = json?.grid   ?? {};
  const i = json?.inflow ?? {};

  return {
    grid: {
      cellSizeM: g.cellSizeM ?? 8,
      widthM:    g.widthM    ?? 1400,
      depthM:    g.depthM    ?? 680,
      originE:   g.originE   ?? -700,
      originN:   g.originN   ?? -600,
    },
    inflow: {
      bearingDeg:   i.bearingDeg   ?? 180,
      rateM3PerSec: i.rateM3PerSec ?? 120,
      baseHeightM:  i.baseHeightM  ?? 1.5,
    },
    gerstnerBlend: json?.gerstnerBlend ?? 0.35,
    speedFactor:   json?.speedFactor   ?? 6.0,
    maxHeightM:    json?.maxHeightM    ?? 3.5,
  };
}
