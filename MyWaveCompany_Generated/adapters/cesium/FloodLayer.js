/**
 * FloodLayer.js — Phase 5 Cesium GPU 홍수 레이어 (GLSL bake 방식)
 *
 * CPU ShallowWater 시뮬레이션 결과를 **GLSL 리터럴**로 GPU 에 전달합니다.
 *
 * ## Phase 5 v2 — texture/uniform 방식 폐기, GLSL bake 방식 채택
 *
 * ### 이전 방식 (texture/uniform, BROKEN)
 * ```
 * FloodLayer → Cesium.Texture → u_floodTex uniform → VS 선언
 * ↳ connectFlood() 호출 시 VS 재빌드 → DrawCommand 재생성 →
 *   새 DrawCommand 에 u_floodTex 없음 → uniformMap['u_floodTex']() → undefined() →
 *   TypeError → renderError → ?material=1 redirect
 * ```
 *
 * ### 현재 방식 (GLSL bake, WORKING)
 * ```
 * preRender (매 프레임)
 *   → ShallowWater.step(dt × speedFactor)
 *   → 60 프레임마다: sw.getFloodFront() → ocean.updateFloodFront(frontN, maxH×blend)
 *       → buildVertexShader(..., frontN, maxH) → smoothstep 리터럴 bake → VS 재빌드
 *       → 새 DrawCommand: uniform 선언 없음 → crash 없음
 * ```
 *
 * GLSL 홍수 표현:
 * ```glsl
 * float _fH = _maxH * (1.0 - smoothstep(_frontN, _frontN + 200.0, xN));
 * dispU += max(0.0, _fH);
 * ```
 *
 * @module adapters/cesium/FloodLayer
 * @see core/math/ShallowWater.js                  시뮬레이션 엔진
 * @see adapters/cesium/GerstnerWaterPrimitiveGPU.js  connectFlood(), updateFloodFront()
 * @see docs/FLOOD.md §2
 */

import { ShallowWater } from '../../core/math/ShallowWater.js';

const TAG = '[FloodLayer]';

/** VS 재빌드 주기 (프레임 수) — 약 1 s @60 fps */
const GPU_UPDATE_INTERVAL = 60;

// ─────────────────────────────────────────────────────────────────────────────
// FloodLayer
// ─────────────────────────────────────────────────────────────────────────────

export class FloodLayer {
  /**
   * @param {import('cesium').Viewer} viewer  (현재 미사용; 향후 확장 예약)
   * @param {import('../../core/types/FloodTypes.js').FloodConfig} floodCfg
   * @param {import('../../core/math/ObstacleField.js').ObstacleField|null} obstacleField
   */
  constructor(viewer, floodCfg, obstacleField = null) {
    this._viewer      = viewer;       // 향후 확장용
    this._floodCfg    = floodCfg;
    this._active      = false;
    this._speedFactor = floodCfg.speedFactor ?? 6.0;
    this._maxH        = floodCfg.maxHeightM  ?? 3.5;
    this._blend       = 1.0;   // 0–1, UI 로 제어

    // ── CPU 시뮬레이션 ────────────────────────────────────────────────────
    this._sw = new ShallowWater(
      floodCfg.grid,
      floodCfg.inflow,
      obstacleField,
    );

    // ── GPU 업데이트 상태 ──────────────────────────────────────────────────
    /** @type {import('./GerstnerWaterPrimitiveGPU.js').GerstnerWaterPrimitiveGPU|null} */
    this._ocean      = null;
    this._frameCount = 0;

    const g = floodCfg.grid;
    console.log(`${TAG} created grid=${this._sw.nx}×${this._sw.ny} cs=${g.cellSizeM}m (GLSL-bake mode)`);
  }

  // ── 공개 API ──────────────────────────────────────────────────────────────

  /** @returns {boolean} */
  get active() { return this._active; }

  /** @returns {number} */
  get speedFactor() { return this._speedFactor; }

  /** @param {number} v */
  set speedFactor(v) { this._speedFactor = Math.max(0.5, v); }

  /** @returns {number} */
  get inflowHeight() { return this._sw.inflowH; }

  /**
   * 유입 수위 변경 (UI 슬라이더 연동)
   * @param {number} h  m (0.1 ~ maxHeightM)
   */
  setInflowHeight(h) {
    this._sw.setInflowHeight(h);
  }

  /**
   * Gerstner 혼합 비율 설정.
   * 다음 tick GPU 업데이트 시 VS 재빌드에 반영됩니다.
   * @param {number} blend  0 (Gerstner only) ~ 1 (flood full)
   */
  setBlend(blend) {
    this._blend = Math.max(0, Math.min(1, blend));
    // 즉시 GPU 갱신 — 다음 tick 에서 반드시 업데이트
    this._frameCount = GPU_UPDATE_INTERVAL - 1;
  }

  /** 시뮬레이션 시작 */
  start() {
    this._active = true;
    console.log(`${TAG} started`);
  }

  /** 시뮬레이션 일시 정지 */
  pause() {
    this._active = false;
  }

  /**
   * 시뮬레이션 초기화 후 정지.
   * GPU 홍수 표시도 즉시 제거합니다.
   */
  reset() {
    this._sw.reset();
    this._active = false;
    // GPU 즉시 제거 (다음 tick 을 기다리지 않음)
    this._ocean?.updateFloodFront(null, 0);
    this._frameCount = 0;
    console.log(`${TAG} reset`);
  }

  /**
   * GerstnerWaterPrimitiveGPU 와 연결합니다.
   * `GerstnerWaterPrimitiveGPU.connectFlood()` 가 내부에서 호출합니다.
   *
   * @param {import('./GerstnerWaterPrimitiveGPU.js').GerstnerWaterPrimitiveGPU} ocean
   */
  attachOcean(ocean) {
    this._ocean = ocean;
    console.log(`${TAG} ocean attached`);
  }

  /**
   * 매 프레임 preRender 에서 호출합니다.
   *
   * @param {number} dtReal  실제 경과 시간 (초, typ. 1/60)
   */
  tick(dtReal) {
    if (this._active) {
      const dtSim = dtReal * this._speedFactor;
      this._sw.step(dtSim);
    }

    // ── GPU 업데이트 (60 프레임마다) ────────────────────────────────────────
    this._frameCount++;
    if (this._frameCount >= GPU_UPDATE_INTERVAL && this._ocean) {
      this._frameCount = 0;
      const frontN        = this._sw.getFloodFront();
      const effectiveMaxH = this._maxH * this._blend;
      this._ocean.updateFloodFront(frontN, effectiveMaxH);
    }
  }

  /**
   * 리소스 해제
   */
  destroy() {
    // GPU 홍수 제거
    this._ocean?.updateFloodFront(null, 0);
    this._ocean  = null;
    this._active = false;
    console.log(`${TAG} destroyed`);
  }
}
