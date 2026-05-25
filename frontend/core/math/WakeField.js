/**
 * WakeField.js — CPU 선박 尾迹(Wake) 변위 솔버  (Phase 2c-1)
 *
 * ## 역할
 *
 * 이동 중인 물체(선박·부표)가 만드는 국소 파도 disturbance(Wake)를
 * CPU 에서 계산합니다. Gerstner 파도에 **가산**되어 최종 수면 높이를 구성합니다.
 *
 * ```
 * totalHeight(x, z, t) = GerstnerWave.getWaterHeight(x, z, t)
 *                       + WakeField.computeWakeDisplacement(x, z, t)
 * ```
 *
 * ## 물리 모델
 *
 * 각 WakeSource는 **확장하는 링 파도**를 방출합니다:
 *
 * 1. **링 반지름**: `r_ring = speed × ageSec`  (소스 속도로 바깥쪽 확장)
 * 2. **진폭 엔벨로프**: Gaussian   `exp(-0.5 * ((r - r_ring) / σ)²)`
 * 3. **진동**: `cos(k × (r - r_ring))`  —  k = 2π / (radiusM × 0.6)
 * 4. **방향성**: 진행 방향 뒤쪽에 V자형 집중
 *    `wakeDir = max(0, -dot(pos-src, vel_normalized))²`
 * 5. **시간 감쇠**: `exp(-ageSec / decayTimeSec)`
 *
 * ## 좌표계
 *
 * 모든 좌표는 **Gerstner 로컬** (x=East, z=North, y=Up) 미터 단위.
 * 이 클래스는 **Cesium·Three.js import 없음** — core/ 원칙 준수.
 *
 * ## 단위 테스트 (완료 기준 — Task 2c-1)
 *
 * ```js
 * import { GerstnerWave } from './GerstnerWave.js';
 * import { WakeField }    from './WakeField.js';
 * import { createWakeSource } from '../types/InteractionTypes.js';
 *
 * const gerstner = new GerstnerWave(waves, { buoyancyIterations: 3 });
 * const wake     = new WakeField({ decayTimeSec: 8 });
 *
 * wake.register(createWakeSource('ship1', 0, 0, 5, 0, { strength: 0.4, radiusM: 25 }));
 * wake.tick(2.0);  // 2초 경과
 *
 * const t = 10;
 * const h = gerstner.getWaterHeight(15, 0, t) + wake.computeWakeDisplacement(15, 0, t);
 * console.assert(typeof h === 'number', 'height is a number');
 * // 선박 바로 뒤 15m 지점에서 wake 기여 > 0
 * console.assert(wake.computeWakeDisplacement(15, 0, t) > 0, 'wake behind ship is positive');
 * ```
 *
 * @see core/types/InteractionTypes.js  WakeSource 타입 정의
 * @see core/math/GerstnerWave.js       기본 파도 솔버
 * @see adapters/cesium/WakeRegistry.js (Task 2c-2) FloatingEntity → WakeSource 연결
 * @see core/shaders/wake.glsl          (Task 2c-3) GPU 동등 구현
 *
 * @module core/math/WakeField
 */

import { MAX_WAKE_SOURCES, KNOTS_TO_MS } from '../types/InteractionTypes.js';

const TWO_PI = 2 * Math.PI;

// ─────────────────────────────────────────────────────────────────────────────
// WakeField
// ─────────────────────────────────────────────────────────────────────────────

export class WakeField {
  /**
   * @param {{
   *   maxSources?:   number,   최대 동시 소스 수 (기본값 MAX_WAKE_SOURCES=16)
   *   decayTimeSec?: number,   진폭 지수 감쇠 시간 상수 (초, 기본값 8)
   *   minSpeedKnots?: number,  이 속도 미만 소스는 wake 생성 안 함 (기본값 1.0 knot)
   * }} [config]
   */
  constructor(config = {}) {
    this.maxSources   = config.maxSources   ?? MAX_WAKE_SOURCES;
    this.decayTimeSec = config.decayTimeSec ?? 8;
    this.minSpeedMs   = (config.minSpeedKnots ?? 1.0) * KNOTS_TO_MS;

    /** @type {import('../types/InteractionTypes.js').WakeSource[]} */
    this._sources = [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 소스 관리
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * WakeSource 를 등록하거나 기존 id 소스를 갱신합니다.
   *
   * **ageSec 는 `tick()` 이 관리합니다.** 기존 소스를 갱신할 때는
   * 위치·속도·활성 상태만 업데이트하고 ageSec 는 건드리지 않습니다.
   * (매 프레임 register() 를 호출해도 age 가 리셋되지 않음)
   *
   * @param {import('../types/InteractionTypes.js').WakeSource} source
   */
  register(source) {
    const idx = this._sources.findIndex(s => s.id === source.id);
    if (idx >= 0) {
      // ageSec 는 tick() 이 관리 → 위치·속도·세기만 갱신
      const e       = this._sources[idx];
      e.x           = source.x;
      e.z           = source.z;
      e.vx          = source.vx;
      e.vz          = source.vz;
      e.strength    = source.strength ?? e.strength;
      e.radiusM     = source.radiusM  ?? e.radiusM;
      if (source.active !== undefined) e.active = source.active;
    } else if (this._sources.length < this.maxSources) {
      this._sources.push({ ...source, ageSec: 0 });
    }
    // maxSources 초과 시 가장 오래된 소스 교체 (새 source로 ageSec 리셋)
    else {
      let oldestIdx = 0;
      for (let i = 1; i < this._sources.length; i++) {
        if (this._sources[i].ageSec > this._sources[oldestIdx].ageSec) oldestIdx = i;
      }
      this._sources[oldestIdx] = { ...source };
    }
  }

  /**
   * id 로 소스를 비활성화합니다. (즉시 제거하지 않고 decay 가 완료될 때 정리)
   * @param {string} id
   */
  deactivate(id) {
    const src = this._sources.find(s => s.id === id);
    if (src) src.active = false;
  }

  /**
   * id 로 소스를 즉시 제거합니다.
   * @param {string} id
   */
  remove(id) {
    this._sources = this._sources.filter(s => s.id !== id);
  }

  /**
   * 모든 소스의 ageSec 를 dt 만큼 진행합니다.
   * 완전히 감쇠한 소스 (`ageSec > decayTimeSec × 3`) 는 자동 제거합니다.
   *
   * @param {number} dt  프레임 delta time (초)
   */
  tick(dt) {
    const cutoff = this.decayTimeSec * 3;
    for (const s of this._sources) s.ageSec += dt;
    this._sources = this._sources.filter(s => s.ageSec < cutoff);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 변위 계산
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 모든 활성 WakeSource 에 의한 수직 변위 합을 반환합니다.
   *
   * **GerstnerWave.getWaterHeight() 에 더해** 최종 수면 높이를 구합니다:
   * ```js
   * const h = gerstner.getWaterHeight(x, z, t) + wakeField.computeWakeDisplacement(x, z, t);
   * ```
   *
   * @param {number} x     East 로컬 위치 (m)
   * @param {number} z     North 로컬 위치 (m)
   * @param {number} _time 외부 시간 (초) — 현재 미사용 (ageSec 기반 계산)
   * @returns {number}  수직 변위 (m)
   */
  computeWakeDisplacement(x, z, _time = 0) {
    let total = 0;

    for (const src of this._sources) {
      if (!src.active) continue;

      // ── 속도 크기 ────────────────────────────────────────────────────────
      const speedSq = src.vx * src.vx + src.vz * src.vz;
      const speed   = Math.sqrt(speedSq);
      if (speed < this.minSpeedMs) continue;

      // ── 소스까지 상대 벡터 ───────────────────────────────────────────────
      const dx = x - src.x;
      const dz = z - src.z;
      const r  = Math.sqrt(dx * dx + dz * dz);
      if (r < 1e-4) continue; // 소스 위치와 동일점 → 스킵

      // ── 방향성 가중치 (선박 뒤쪽에 V자형 집중) ──────────────────────────
      // 속도 단위벡터와 (pos - src) 의 내적 → 음수면 뒤쪽
      const invSpeed = 1 / speed;
      const dirDot   = (dx * src.vx + dz * src.vz) * invSpeed / r;
      // 뒤쪽 (dirDot < 0) 만 wake 발생, 제곱으로 V자 첨두 강조
      const wakeDir  = Math.max(0, -dirDot);
      const dirW     = wakeDir * wakeDir;      // 0 ~ 1
      if (dirW < 1e-4) continue;              // 앞쪽은 완전 무시

      // ── 확장하는 링 파도 ─────────────────────────────────────────────────
      // 링은 속도로 바깥쪽 확장: ringR = speed × age
      const ringR  = speed * src.ageSec;
      const dr     = r - ringR;

      // Gaussian 진폭 엔벨로프 (링 위치 ±σ)
      const sigma  = src.radiusM * 0.55;
      const env    = Math.exp(-0.5 * (dr / sigma) * (dr / sigma));

      // 진동 (링 중심 기준 위상)
      const k      = TWO_PI / (src.radiusM * 0.6);
      const osc    = Math.cos(k * dr);

      // 시간 감쇠 (지수)
      const decay  = Math.exp(-src.ageSec / this.decayTimeSec);

      total += src.strength * env * osc * dirW * decay;
    }

    return total;
  }

  /**
   * Gerstner CPU 솔버와 합산한 총 수면 높이를 반환합니다.
   *
   * @param {number} x
   * @param {number} z
   * @param {number} time
   * @param {import('./GerstnerWave.js').GerstnerWave} gerstnerSolver
   * @returns {number}
   */
  totalWaterHeight(x, z, time, gerstnerSolver) {
    return gerstnerSolver.getWaterHeight(x, z, time)
         + this.computeWakeDisplacement(x, z, time);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 유틸리티
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 활성 소스 목록을 반환합니다. (WakeRegistry → GPU uniform 패킹에 사용)
   * @returns {import('../types/InteractionTypes.js').WakeSource[]}
   */
  getActiveSources() {
    return this._sources.filter(s => s.active);
  }

  /** 활성 소스 수 */
  get sourceCount() {
    return this._sources.filter(s => s.active).length;
  }

  /** 모든 소스를 제거합니다. */
  clear() {
    this._sources = [];
  }
}
