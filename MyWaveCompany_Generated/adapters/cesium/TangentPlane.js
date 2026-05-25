/**
 * ENU (East-North-Up) 탄젠트 평면 유틸리티
 *
 * WGS84/ECEF ↔ 로컬 탄젠트 평면 변환.
 * GerstnerWave CPU 솔버가 사용하는 Y-up 로컬 좌표계와 Cesium의
 * WGS84 좌표계를 연결하는 브리지 역할을 합니다.
 *
 * ## 좌표 매핑
 *
 * | Cesium ENU | GerstnerWave 로컬 |
 * |------------|-------------------|
 * | East  (x)  | local x           |
 * | North (y)  | local z           |
 * | Up    (z)  | local y  (파고)   |
 *
 * ## 사용 예
 *
 * ```js
 * import { TangentPlane } from './TangentPlane.js';
 * import { GerstnerWave } from '../../core/math/GerstnerWave.js';
 *
 * const plane  = new TangentPlane(126.978, 37.566);   // 서울 기준점
 * const solver = new GerstnerWave(waves, { buoyancyIterations: 3 });
 *
 * // WGS84 위경도 → 수면 고도(m) 변환
 * const alt = plane.getWaterAltitude(126.978, 37.566, solver, elapsedSeconds);
 * ```
 *
 * @see adapters/cesium/INTEGRATION.md — 좌표계 섹션
 * @see https://cesium.com/learn/cesiumjs/ref-doc/Transforms.html
 */

import * as Cesium from 'cesium';

// 재사용 스크래치 객체 (GC 최소화)
const _scratchCart3 = new Cesium.Cartesian3();
const _scratchCarto = new Cesium.Cartographic();
const _scratchMat4  = new Cesium.Matrix4();

export class TangentPlane {
  /**
   * @param {number} lon0Deg  탄젠트 평면 중심 경도 (도 단위)
   * @param {number} lat0Deg  탄젠트 평면 중심 위도 (도 단위)
   * @param {number} [alt0=0] 탄젠트 평면 기준 고도 (미터, 기본값 = 해수면)
   */
  constructor(lon0Deg, lat0Deg, alt0 = 0) {
    /** 탄젠트 평면 중심 — ECEF Cartesian3 */
    this.center = Cesium.Cartesian3.fromDegrees(lon0Deg, lat0Deg, alt0);

    /** 중심점의 경위도 */
    this.lon0Deg = lon0Deg;
    this.lat0Deg = lat0Deg;
    this.alt0    = alt0;

    /**
     * ENU 로컬 → ECEF 변환 행렬 (4×4)
     * Column 0 = East, Column 1 = North, Column 2 = Up
     */
    this.enuToEcef = Cesium.Transforms.eastNorthUpToFixedFrame(
      this.center,
      Cesium.Ellipsoid.WGS84,
      new Cesium.Matrix4(),
    );

    /** ECEF → ENU 로컬 변환 행렬 (4×4) — enuToEcef의 역행렬 */
    this.ecefToEnu = Cesium.Matrix4.inverseTransformation(
      this.enuToEcef,
      new Cesium.Matrix4(),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 핵심 변환 메서드
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * ECEF Cartesian3 → GerstnerWave 로컬 좌표 (x=East, y=Up, z=North)
   *
   * @param {Cesium.Cartesian3} cartesian  ECEF 월드 좌표
   * @param {{ x: number, y: number, z: number }} [result]  재사용 출력 객체
   * @returns {{ x: number, y: number, z: number }}
   */
  cartesianToLocal(cartesian, result = {}) {
    const enu = Cesium.Matrix4.multiplyByPoint(
      this.ecefToEnu,
      cartesian,
      _scratchCart3,
    );
    // Cesium ENU: x=East, y=North, z=Up
    // GerstnerWave: x=East (수평), y=Up (파고), z=North (수평)
    result.x = enu.x;
    result.y = enu.z;  // Up → GerstnerWave Y
    result.z = enu.y;  // North → GerstnerWave Z
    return result;
  }

  /**
   * GerstnerWave 로컬 좌표 (x=East, y=Up, z=North) → ECEF Cartesian3
   *
   * @param {number} localX East 성분 (m)
   * @param {number} localY Up 성분 / 파고 (m)
   * @param {number} localZ North 성분 (m)
   * @param {Cesium.Cartesian3} [result]
   * @returns {Cesium.Cartesian3}
   */
  localToCartesian(localX, localY, localZ, result = new Cesium.Cartesian3()) {
    // GerstnerWave x=East, y=Up, z=North → Cesium ENU x=East, y=North, z=Up
    _scratchCart3.x = localX;
    _scratchCart3.y = localZ;  // GerstnerWave Z(North) → Cesium ENU Y
    _scratchCart3.z = localY;  // GerstnerWave Y(Up) → Cesium ENU Z
    return Cesium.Matrix4.multiplyByPoint(this.enuToEcef, _scratchCart3, result);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 지리 좌표 변환 편의 메서드
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * WGS84 지리 좌표 (lon, lat, alt) → GerstnerWave 로컬 좌표
   *
   * @param {number} lonDeg 경도 (도)
   * @param {number} latDeg 위도 (도)
   * @param {number} [alt=0] 고도 (m)
   * @returns {{ x: number, y: number, z: number }}
   */
  cartographicToLocal(lonDeg, latDeg, alt = 0) {
    const ecef = Cesium.Cartesian3.fromDegrees(lonDeg, latDeg, alt, Cesium.Ellipsoid.WGS84, _scratchCart3);
    return this.cartesianToLocal(ecef);
  }

  /**
   * GerstnerWave 로컬 좌표 → WGS84 지리 좌표
   *
   * @param {number} localX
   * @param {number} localY
   * @param {number} localZ
   * @returns {{ lonDeg: number, latDeg: number, alt: number }}
   */
  localToCartographic(localX, localY, localZ) {
    const ecef = this.localToCartesian(localX, localY, localZ, _scratchCart3);
    const carto = Cesium.Cartographic.fromCartesian(
      ecef,
      Cesium.Ellipsoid.WGS84,
      _scratchCarto,
    );
    return {
      lonDeg: Cesium.Math.toDegrees(carto.longitude),
      latDeg: Cesium.Math.toDegrees(carto.latitude),
      alt:    carto.height,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GerstnerWave 연동 메서드
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * WGS84 위경도 지점에서 Gerstner 파도의 **수면 고도(m)** 를 반환합니다.
   *
   * 내부적으로:
   *   1. (lon, lat) → 로컬 (localX, localZ)
   *   2. GerstnerWave.getWaterHeight(localX, localZ, time) → localY
   *   3. (localX, localY, localZ) → WGS84 고도
   *
   * @param {number} lonDeg 경도 (도)
   * @param {number} latDeg 위도 (도)
   * @param {import('../../core/math/GerstnerWave.js').GerstnerWave} solver
   * @param {number} time  경과 시간 (초)
   * @returns {number} WGS84 고도 (m)
   */
  getWaterAltitude(lonDeg, latDeg, solver, time) {
    const local = this.cartographicToLocal(lonDeg, latDeg, 0);
    const waterLocalY = solver.getWaterHeight(local.x, local.z, time);
    return this.localToCartographic(local.x, waterLocalY, local.z).alt;
  }

  /**
   * WGS84 위경도 지점에서 Gerstner 파도의 **ENU 법선 벡터** 를 반환합니다.
   * FloatingEntity 기울기 계산에 사용합니다.
   *
   * @param {number} lonDeg
   * @param {number} latDeg
   * @param {import('../../core/math/GerstnerWave.js').GerstnerWave} solver
   * @param {number} time
   * @returns {{ x: number, y: number, z: number }} ENU 공간의 법선 (단위 벡터)
   */
  getWaveNormalEnu(lonDeg, latDeg, solver, time) {
    const local = this.cartographicToLocal(lonDeg, latDeg, 0);
    // solver.normal 은 GerstnerWave 로컬 (x=East, y=Up, z=North)
    const n = solver.normal(local.x, local.z, time);
    // Cesium ENU (x=East, y=North, z=Up) 로 역변환
    return { x: n.x, y: n.z, z: n.y };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 유틸리티
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 이 탄젠트 평면의 ENU→ECEF 행렬을 Float32Array(16) 형태로 반환합니다.
   * WebGL uniform (mat4) 으로 직접 전달할 때 사용합니다.
   *
   * @returns {Float32Array}
   */
  getEcefTransformF32() {
    return new Float32Array(Cesium.Matrix4.toArray(this.enuToEcef));
  }

  toString() {
    return `TangentPlane(lon=${this.lon0Deg.toFixed(4)}, lat=${this.lat0Deg.toFixed(4)}, alt=${this.alt0})`;
  }
}
