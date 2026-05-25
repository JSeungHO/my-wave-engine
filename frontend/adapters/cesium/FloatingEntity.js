/**
 * Cesium FloatingEntity — Gerstner 수면 위 부유 Entity  (Task 2c-2 업데이트)
 *
 * `GerstnerWave.getWaterHeight()` 를 Cesium Entity 위치·자세에 연결합니다.
 * Three.js `FloatingObject.js` 와 동일한 CPU 솔버 패턴을 Cesium 좌표계로 구현합니다.
 *
 * ## Phase 2c-2 추가 — 속도 추적 + WakeRegistry 연동
 *
 * `options.wakeRegistry` 를 제공하면 매 프레임 ENU 위치·속도를
 * `WakeRegistry.register()` 에 전달합니다.
 *
 * ```
 * entity.position CallbackProperty (매 프레임)
 *     │  ① ENU 로컬 위치 계산 (TangentPlane.cartographicToLocal)
 *     │  ② 이전 프레임 대비 속도 계산 (m/s)
 *     │  ③ WakeRegistry.register(id, x, z, vx, vz)
 *     ▼
 * WakeField (WakeSource[] 갱신)
 *     ▼ (Phase 2c-3)
 * GerstnerWaterPrimitiveGPU — GPU Wake uniform
 * ```
 *
 * ## 동작 원리
 *
 * ```
 * viewer.clock (JulianDate)
 *     │  secondsDifference
 *     ▼
 * elapsed (seconds)
 *     │
 *     ▼  TangentPlane.getWaterAltitude(lon, lat, solver, t)
 * WGS84 고도 (m)   ←── GerstnerWave.getWaterHeight(localX, localZ, t)
 *     │
 *     ▼  Cesium.CallbackProperty
 * entity.position  (매 프레임 업데이트)
 *
 * TangentPlane.getWaveNormalEnu(lon, lat, solver, t)
 *     │
 *     ▼  ENU normal → ECEF quaternion
 * entity.orientation  (파도에 따른 기울기)
 * ```
 *
 * ## 사용 예 (Phase 2c-2)
 *
 * ```js
 * import { GerstnerWaterPrimitiveGPU } from './GerstnerWaterPrimitiveGPU.js';
 * import { FloatingEntity }            from './FloatingEntity.js';
 * import { WakeRegistry }              from './WakeRegistry.js';
 * import { loadWavesConfig, loadInteractionConfig } from '../../core/index.js';
 * import wavesJson from '../../configs/waves.json';
 * import interactionJson from '../../configs/interaction.json';
 *
 * const config  = loadWavesConfig(wavesJson);
 * const iCfg    = loadInteractionConfig(interactionJson);
 * const ocean   = new GerstnerWaterPrimitiveGPU(viewer, config.waves, { lon0: 126.5, lat0: 37.5 });
 * const registry = new WakeRegistry(viewer, iCfg);
 * registry.connectOcean(ocean);
 *
 * const ship = new FloatingEntity(viewer, shipEntity, ocean.plane, ocean.gerstnerSolver, {
 *   lon: 126.501, lat: 37.501, offsetAlt: 2.5, tiltStrength: 0.15,
 *   wakeRegistry: registry,   // ← Phase 2c-2: Wake 연동
 * });
 *
 * ship.moveTo(126.502, 37.502);  // 이동 시 자동 Wake 등록
 * ship.destroy();                // entity는 유지, WakeSource 비활성화
 * ```
 *
 * @see demo/FloatingObject.js — Three.js 동일 패턴
 * @see adapters/cesium/TangentPlane.js — ENU 좌표 변환
 * @see adapters/cesium/WakeRegistry.js — Wake 소스 관리 (Phase 2c-2)
 */

import * as Cesium from 'cesium';

// ── 스크래치 객체 (GC 최소화) ───────────────────────────────────────────────
const _scratchCartesian = new Cesium.Cartesian3();
const _scratchMatrix3   = new Cesium.Matrix3();
const _scratchQuatA     = new Cesium.Quaternion();
const _scratchQuatB     = new Cesium.Quaternion();

export class FloatingEntity {
  /**
   * @param {Cesium.Viewer} viewer
   * @param {Cesium.Entity} entity           부력을 적용할 Cesium Entity
   * @param {import('./TangentPlane.js').TangentPlane} tangentPlane
   * @param {import('../../core/math/GerstnerWave.js').GerstnerWave} solver
   * @param {{
   *   lon?:          number,   초기 경도 (도, 기본값 = 탄젠트 평면 중심)
   *   lat?:          number,   초기 위도 (도)
   *   offsetAlt?:    number,   수면 위 추가 높이 (m, 선박 흘수선 등)
   *   tiltStrength?: number,   파도 기울기 반응 강도 0~1 (기본값 0.12)
   * }} [options]
   */
  /**
   * @param {Cesium.Viewer} viewer
   * @param {Cesium.Entity} entity           부력을 적용할 Cesium Entity
   * @param {import('./TangentPlane.js').TangentPlane} tangentPlane
   * @param {import('../../core/math/GerstnerWave.js').GerstnerWave} solver
   * @param {{
   *   lon?:           number,   초기 경도 (도, 기본값 = 탄젠트 평면 중심)
   *   lat?:           number,   초기 위도 (도)
   *   offsetAlt?:     number,   수면 위 추가 높이 (m, 선박 흘수선 등)
   *   tiltStrength?:  number,   파도 기울기 반응 강도 0~1 (기본값 0.12)
   *   wakeRegistry?:  import('./WakeRegistry.js').WakeRegistry | null,  Phase 2c-2
   *   wakeStrength?:  number,   이 Entity 의 Wake 세기 오버라이드 (기본값: WakeRegistry 기본값)
   *   wakeRadiusM?:   number,   이 Entity 의 Wake 반지름 오버라이드 (m)
   * }} [options]
   */
  constructor(viewer, entity, tangentPlane, solver, options = {}) {
    this.viewer       = viewer;
    this.entity       = entity;
    this.plane        = tangentPlane;
    this.solver       = solver;

    this.offsetAlt    = options.offsetAlt    ?? 0.5;
    this.tiltStrength = options.tiltStrength ?? 0.12;

    this._lon = options.lon ?? tangentPlane.lon0Deg;
    this._lat = options.lat ?? tangentPlane.lat0Deg;

    /** 시작 JulianDate — GerstnerWaterPrimitive 와 동기화 */
    this._startJD = viewer.clock.currentTime.clone();

    /** 현재 Orientation 쿼터니언 (ECEF 공간) — slerp 보간용 */
    this._currentQuat = Cesium.Quaternion.IDENTITY.clone();

    // ── Phase 2c-2: Wake 추적 ────────────────────────────────────────────
    /** @type {import('./WakeRegistry.js').WakeRegistry | null} */
    this._wakeRegistry  = options.wakeRegistry ?? null;
    this._wakeStrength  = options.wakeStrength  ?? undefined;
    this._wakeRadiusM   = options.wakeRadiusM   ?? undefined;

    /** 속도 계산용 이전 프레임 상태 */
    this._prevEnu = null;  // { x, z }  ENU 로컬 (m)
    this._prevT   = null;  // 이전 시뮬레이션 시간 (초)

    // ── Position: CallbackProperty (매 프레임 수면 고도 갱신) ──────────────
    entity.position = new Cesium.CallbackProperty((julianDate, result) => {
      const t = Cesium.JulianDate.secondsDifference(julianDate, this._startJD);
      const alt = this.plane.getWaterAltitude(this._lon, this._lat, this.solver, t) + this.offsetAlt;

      // ── Wake 속도 추적 ─────────────────────────────────────────────────
      if (this._wakeRegistry) {
        // ENU 로컬 위치 (x=East, z=North)
        const enu = this.plane.cartographicToLocal(this._lon, this._lat, 0);
        let vx = 0, vz = 0;
        if (this._prevEnu !== null && this._prevT !== null) {
          const dt = t - this._prevT;
          if (dt > 1e-4) {
            vx = (enu.x - this._prevEnu.x) / dt;
            vz = (enu.z - this._prevEnu.z) / dt;
          }
        }
        this._prevEnu = { x: enu.x, z: enu.z };
        this._prevT   = t;

        this._wakeRegistry.register(
          this.entity.id,
          enu.x, enu.z, vx, vz,
          { strength: this._wakeStrength, radiusM: this._wakeRadiusM },
        );
      }

      return Cesium.Cartesian3.fromDegrees(this._lon, this._lat, alt, Cesium.Ellipsoid.WGS84, result);
    }, /* isConstant */ false);

    // ── Orientation: CallbackProperty (파도 법선 기반 기울기) ───────────────
    entity.orientation = new Cesium.CallbackProperty((julianDate, result) => {
      const t = Cesium.JulianDate.secondsDifference(julianDate, this._startJD);
      return this._computeOrientation(t, result);
    }, false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 내부 메서드
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 파도 법선을 기반으로 ECEF 쿼터니언 Orientation을 계산합니다.
   *
   * 1. ENU 법선 벡터 (x=East, y=North, z=Up) 가져오기
   * 2. ENU→ECEF 회전 적용
   * 3. 기울기 보간 (slerp, tiltStrength)
   *
   * @param {number} t 경과 시간 (초)
   * @param {Cesium.Quaternion} [result]
   * @returns {Cesium.Quaternion} ECEF 공간 Orientation
   */
  _computeOrientation(t, result = new Cesium.Quaternion()) {
    // ENU 공간 파도 법선 (Cesium ENU: x=East, y=North, z=Up)
    const nEnu = this.plane.getWaveNormalEnu(this._lon, this._lat, this.solver, t);

    // ENU Up 방향 (0, 0, 1) → 파도 법선 방향으로 회전하는 쿼터니언
    const enuNormal  = new Cesium.Cartesian3(nEnu.x, nEnu.y, nEnu.z);
    const enuUp      = Cesium.Cartesian3.UNIT_Z;   // ENU Up = (0, 0, 1)

    // 두 벡터 사이의 회전 쿼터니언
    const tiltQuat = Cesium.Quaternion.fromAxisAngle(
      Cesium.Cartesian3.cross(enuUp, enuNormal, _scratchCartesian),
      Math.acos(
        Math.max(-1, Math.min(1,
          Cesium.Cartesian3.dot(enuUp, Cesium.Cartesian3.normalize(enuNormal, _scratchCartesian))
        ))
      ),
      _scratchQuatA,
    );

    // ENU→ECEF 회전만 추출 (Matrix4 → Matrix3 → Quaternion)
    const rot3  = Cesium.Matrix4.getMatrix3(this.plane.enuToEcef, _scratchMatrix3);
    const ecefOrientQuat = Cesium.Quaternion.fromRotationMatrix(rot3, _scratchQuatB);

    // ECEF 쿼터니언 = ecefOrient * tilt
    const targetQuat = Cesium.Quaternion.multiply(ecefOrientQuat, tiltQuat, new Cesium.Quaternion());

    // slerp 보간 (부드러운 기울기 전환)
    Cesium.Quaternion.slerp(this._currentQuat, targetQuat, this.tiltStrength, this._currentQuat);
    return Cesium.Quaternion.clone(this._currentQuat, result);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 공개 API
  // ─────────────────────────────────────────────────────────────────────────

  /** 현재 Entity 경도 (도) */
  get lon() { return this._lon; }

  /** 현재 Entity 위도 (도) */
  get lat() { return this._lat; }

  /**
   * Entity를 새 위경도로 이동합니다.
   * 위치 CallbackProperty가 다음 프레임에 즉시 반영됩니다.
   *
   * @param {number} lonDeg 새 경도 (도)
   * @param {number} latDeg 새 위도 (도)
   */
  moveTo(lonDeg, latDeg) {
    this._lon = lonDeg;
    this._lat = latDeg;
  }

  /**
   * 현재 위치의 수면 고도를 직접 조회합니다 (UI 표시 등에 활용).
   *
   * @param {number} [time] 시간 (생략 시 viewer.clock 기준)
   * @returns {number} WGS84 수면 고도 (m)
   */
  getWaterAltitude(time) {
    const t = time ?? Cesium.JulianDate.secondsDifference(
      this.viewer.clock.currentTime,
      this._startJD,
    );
    return this.plane.getWaterAltitude(this._lon, this._lat, this.solver, t);
  }

  /**
   * CallbackProperty 를 고정 값으로 되돌리고 이벤트를 정리합니다.
   * Entity 자체는 제거하지 않습니다 — 필요 시 `viewer.entities.remove(entity)` 별도 호출.
   *
   * Phase 2c-2: WakeRegistry 에서 이 Entity 를 비활성화합니다.
   * 기존 Wake 링은 자연 감쇠합니다.
   */
  destroy() {
    // Phase 2c-2: Wake 소스 비활성화 (링은 decayTimeSec 후 자동 소멸)
    if (this._wakeRegistry) {
      this._wakeRegistry.deactivate(this.entity.id);
      this._wakeRegistry = null;
    }

    // Cesium 의 CallbackProperty 는 dispose 메서드가 없으므로
    // 마지막으로 계산된 위치를 고정값으로 교체합니다.
    try {
      const t = Cesium.JulianDate.secondsDifference(
        this.viewer.clock.currentTime,
        this._startJD,
      );
      const alt = this.plane.getWaterAltitude(this._lon, this._lat, this.solver, t) + this.offsetAlt;
      this.entity.position    = Cesium.Cartesian3.fromDegrees(this._lon, this._lat, alt);
      this.entity.orientation = undefined;
    } catch (_) {
      // Entity 가 이미 제거된 경우 무시
    }
  }
}
