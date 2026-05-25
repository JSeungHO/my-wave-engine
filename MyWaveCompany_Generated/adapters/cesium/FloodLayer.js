/**
 * FloodLayer.js — Phase 5 Cesium GPU 홍수 레이어 (2D height field)
 *
 * CPU ShallowWater 시뮬레이션 결과를 정점 속성 `a_floodH` 로 GPU 에 전달합니다.
 *
 * @module adapters/cesium/FloodLayer
 * @see core/math/ShallowWater.js
 * @see adapters/cesium/GerstnerWaterPrimitiveGPU.js
 */

import { ShallowWater } from '../../core/math/ShallowWater.js';

const TAG = '[FloodLayer]';

/** GPU 갱신 주기 (프레임) — 약 1 s @60 fps */
const GPU_UPDATE_INTERVAL = 60;

export class FloodLayer {
  /**
   * @param {import('cesium').Viewer} viewer
   * @param {import('../../core/types/FloodTypes.js').FloodConfig} floodCfg
   * @param {import('../../core/math/ObstacleField.js').ObstacleField|null} obstacleField
   */
  constructor(viewer, floodCfg, obstacleField = null) {
    this._viewer      = viewer;
    this._floodCfg    = floodCfg;
    this._active      = false;
    this._speedFactor = floodCfg.speedFactor ?? 6.0;
    this._maxH        = floodCfg.maxHeightM  ?? 3.5;
    this._blend       = 1.0;

    this._sw = new ShallowWater(
      floodCfg.grid,
      floodCfg.inflow,
      obstacleField,
    );

    /** @type {import('./GerstnerWaterPrimitiveGPU.js').GerstnerWaterPrimitiveGPU|null} */
    this._ocean      = null;
    this._frameCount = 0;

    const g = floodCfg.grid;
    console.log(`${TAG} created grid=${this._sw.nx}×${this._sw.ny} cs=${g.cellSizeM}m (2D field mode)`);
  }

  get active() { return this._active; }

  get blend() { return this._blend; }

  get speedFactor() { return this._speedFactor; }

  /** @param {number} v */
  set speedFactor(v) { this._speedFactor = Math.max(0.5, v); }

  get inflowHeight() { return this._sw.inflowH; }

  /** @param {number} h */
  setInflowHeight(h) {
    this._sw.setInflowHeight(h);
  }

  /** @param {number} blend 0~1 */
  setBlend(blend) {
    this._blend = Math.max(0, Math.min(1, blend));
    this._frameCount = GPU_UPDATE_INTERVAL - 1;
  }

  start() {
    this._active = true;
    console.log(`${TAG} started`);
  }

  pause() {
    this._active = false;
  }

  reset() {
    this._sw.reset();
    this._active = false;
    this._ocean?.clearFloodHeightField();
    this._frameCount = 0;
    console.log(`${TAG} reset`);
  }

  /** @param {import('./GerstnerWaterPrimitiveGPU.js').GerstnerWaterPrimitiveGPU} ocean */
  attachOcean(ocean) {
    this._ocean = ocean;
    console.log(`${TAG} ocean attached`);
  }

  /**
   * 차수벽·건물 변경 시 CPU 격자 벽 마스크 재생성
   * @param {import('../../core/math/ObstacleField.js').ObstacleField} obstacleField
   */
  rebuildObstacles(obstacleField) {
    this._sw.rebuildWallMask(obstacleField);
    this._frameCount = GPU_UPDATE_INTERVAL - 1;
  }

  /**
   * ENU 지점 홍수 수위 (정수위 제외)
   * @param {number} e
   * @param {number} n
   * @returns {number}
   */
  sampleHeightAt(e, n) {
    if (!this._active || this._blend <= 0) return 0;
    return this._sw.getHeightAt(e, n) * this._blend;
  }

  /** @returns {number} 격자 최대 홍수 수위 (m) */
  getMaxSimHeight() {
    return this._sw.getMaxHeight();
  }

  /**
   * @param {number} dtReal
   */
  tick(dtReal) {
    if (this._active) {
      this._sw.step(dtReal * this._speedFactor);
    }

    this._frameCount++;
    if (this._frameCount < GPU_UPDATE_INTERVAL || !this._ocean) return;
    this._frameCount = 0;

    if (this._active && this._blend > 0) {
      const blend = this._blend;
      this._ocean.updateFloodHeightField((e, n) => this._sw.getHeightAt(e, n) * blend);
    } else {
      this._ocean.clearFloodHeightField();
    }
  }

  destroy() {
    this._ocean?.clearFloodHeightField();
    this._ocean  = null;
    this._active = false;
    console.log(`${TAG} destroyed`);
  }
}
