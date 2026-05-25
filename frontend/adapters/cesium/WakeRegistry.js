/**
 * WakeRegistry.js — FloatingEntity 속도 추적 → WakeField 소스 관리  (Task 2c-2)
 *
 * ## 역할
 *
 * 씬 내 모든 부유 Entity 의 이동 정보를 수집해 `WakeField` 에 전달합니다.
 * `GerstnerWaterPrimitiveGPU` 와 연결되어 (Task 2c-3) GPU Wake uniform 도 갱신합니다.
 *
 * ## 데이터 흐름
 *
 * ```
 * FloatingEntity (position CallbackProperty)
 *     ↓ register(id, enuX, enuZ, vx, vz)
 * WakeRegistry
 *     ↓ tick(dt)  (preRender 이벤트)
 * WakeField  (WakeSource[] 관리)
 *     ↓ computeWakeDisplacement(x, z, t)  ← FloatingEntity 위치 보정 (Phase 2c-2 이후)
 *     ↓ getActiveSources()                ← GPU uniform 패킹 (Phase 2c-3)
 * GerstnerWaterPrimitiveGPU.updateWakeSources()
 * ```
 *
 * ## 사용 예
 *
 * ```js
 * import { WakeRegistry }           from './WakeRegistry.js';
 * import { GerstnerWaterPrimitiveGPU } from './GerstnerWaterPrimitiveGPU.js';
 * import { FloatingEntity }         from './FloatingEntity.js';
 * import interactionJson            from '../../configs/interaction.json';
 * import { loadInteractionConfig }  from '../../core/index.js';
 *
 * const iCfg    = loadInteractionConfig(interactionJson);
 * const registry = new WakeRegistry(viewer, iCfg);
 *
 * const ocean  = new GerstnerWaterPrimitiveGPU(viewer, waves, options);
 * registry.connectOcean(ocean);   // Phase 2c-3: GPU uniform 자동 갱신
 *
 * const ship = new FloatingEntity(viewer, shipEntity, ocean.plane, ocean.gerstnerSolver, {
 *   lon: 129.04, lat: 35.10, offsetAlt: 5,
 *   wakeRegistry: registry,   // ← 속도 자동 등록
 * });
 *
 * // 정리
 * ship.destroy();
 * registry.destroy();
 * ```
 *
 * @see core/math/WakeField.js           WakeSource 물리 모델
 * @see core/types/InteractionTypes.js   WakeSource 타입 정의
 * @see adapters/cesium/FloatingEntity.js (Task 2c-2 수정)
 * @see adapters/cesium/GerstnerWaterPrimitiveGPU.js (Task 2c-3 연동)
 *
 * @module adapters/cesium/WakeRegistry
 */

import * as Cesium from 'cesium';

import { WakeField, createWakeSource } from '../../core/index.js';

export class WakeRegistry {
  /**
   * @param {Cesium.Viewer} viewer
   * @param {{
   *   wake: {
   *     maxSources:      number,
   *     defaultStrength: number,
   *     defaultRadiusM:  number,
   *     decayTimeSec:    number,
   *     minSpeedKnots:   number,
   *   }
   * }} interactionConfig  loadInteractionConfig(interaction.json) 반환값
   */
  constructor(viewer, interactionConfig) {
    this.viewer = viewer;

    const w = interactionConfig.wake;

    /** CPU Wake 솔버 */
    this.field = new WakeField({
      maxSources:    w.maxSources,
      decayTimeSec:  w.decayTimeSec,
      minSpeedKnots: w.minSpeedKnots,
    });

    this._defaultStrength = w.defaultStrength;
    this._defaultRadiusM  = w.defaultRadiusM;

    /** @type {import('./GerstnerWaterPrimitiveGPU.js').GerstnerWaterPrimitiveGPU | null} */
    this._ocean = null;

    /** 마지막 tick JulianDate — 첫 프레임 판별용 */
    this._lastJD = null;

    // ── preRender: tick + GPU 갱신 ─────────────────────────────────────────
    this._preRenderHandler = viewer.scene.preRender.addEventListener(
      (scene, julianDate) => {
        if (this._lastJD === null) {
          this._lastJD = julianDate.clone();
          return;
        }
        const dt = Cesium.JulianDate.secondsDifference(julianDate, this._lastJD);
        this._lastJD = julianDate.clone();

        if (dt > 0 && dt < 2.0) {   // 탭 비활성화 등 비정상 dt 무시
          this.field.tick(dt);
          this._syncGpuUniforms();
        }
      },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FloatingEntity → WakeField 연결
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 부유 Entity 의 ENU 위치·속도를 등록합니다.
   * FloatingEntity 의 position CallbackProperty 에서 매 프레임 호출됩니다.
   *
   * @param {string} id    Entity 고유 ID (Cesium Entity.id 등)
   * @param {number} enuX  East 로컬 위치 (m, Gerstner 로컬)
   * @param {number} enuZ  North 로컬 위치 (m)
   * @param {number} vx    East 속도 (m/s)
   * @param {number} vz    North 속도 (m/s)
   * @param {{strength?:number, radiusM?:number}} [opts]  소스별 세기 오버라이드
   */
  register(id, enuX, enuZ, vx, vz, opts = {}) {
    this.field.register(
      createWakeSource(id, enuX, enuZ, vx, vz, {
        strength: opts.strength ?? this._defaultStrength,
        radiusM:  opts.radiusM  ?? this._defaultRadiusM,
      }),
    );
  }

  /**
   * Entity 를 비활성화합니다 (파괴·씬 제거 시).
   * 기존 Wake 링은 자연 감쇠합니다.
   * @param {string} id
   */
  deactivate(id) {
    this.field.deactivate(id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GPU 연결 (Phase 2c-3)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * `GerstnerWaterPrimitiveGPU` 를 연결합니다.
   * 연결 후 매 tick 마다 GPU Wake uniform 이 자동으로 갱신됩니다.
   *
   * @param {import('./GerstnerWaterPrimitiveGPU.js').GerstnerWaterPrimitiveGPU} ocean
   */
  connectOcean(ocean) {
    this._ocean = ocean;
  }

  /** GPU uniform 갱신 (preRender 에서 호출) */
  _syncGpuUniforms() {
    if (!this._ocean) return;
    // Task 2c-3 에서 GerstnerWaterPrimitiveGPU.updateWakeSources() 구현 후 연결
    if (typeof this._ocean.updateWakeSources === 'function') {
      this._ocean.updateWakeSources(this.field.getActiveSources());
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 공개 API
  // ─────────────────────────────────────────────────────────────────────────

  /** 내부 WakeField (CPU 합산 계산·디버그용) */
  get wakeField() { return this.field; }

  /** 활성 WakeSource 수 */
  get sourceCount() { return this.field.sourceCount; }

  /**
   * (x, z) 위치의 Wake 수직 변위를 반환합니다. (CPU Entity 보정에 활용)
   * @param {number} x  East 로컬 (m)
   * @param {number} z  North 로컬 (m)
   * @param {number} time  시뮬레이션 시간 (초) — WakeField는 ageSec 기반이므로 미사용
   * @returns {number}
   */
  computeWakeDisplacement(x, z, time = 0) {
    return this.field.computeWakeDisplacement(x, z, time);
  }

  /** WakeField + GerstnerWave 합산 높이 */
  totalWaterHeight(x, z, time, gerstnerSolver) {
    return this.field.totalWaterHeight(x, z, time, gerstnerSolver);
  }

  /** 이벤트 리스너 해제 */
  destroy() {
    if (this._preRenderHandler) {
      this._preRenderHandler();
      this._preRenderHandler = null;
    }
    this._ocean = null;
    this.field.clear();
  }
}
