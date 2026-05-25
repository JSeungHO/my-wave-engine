/**
 * ObstacleTypes.js — Phase 4 장애물·차수벽 데이터 구조
 *
 * `obstacles.json` 파싱 + WGS84 footprint → ENU AABB 변환.
 *
 * ## 설계 원칙
 * * `core/` 원칙 준수: **Cesium·Three.js import 절대 금지**
 * * 모든 좌표는 ENU 로컬 (x=East m, y=North m) — TangentPlane 앵커 기준
 * * `ObstacleBox` 는 AABB(축 정렬 경계 상자) — GPU 및 CPU 모두 사용
 *
 * ## 좌표 규약
 *
 * ```
 *   anchorLon / anchorLat  — scene.json 의 anchor 값
 *   eastM  = (lon - anchorLon) * DEG2M_LAT * cos(anchorLat)
 *   northM = (lat - anchorLat) * DEG2M_LAT
 *   (ENU North +) = 내륙(북), (ENU North −) = 바다(남)
 * ```
 *
 * @module core/types/ObstacleTypes
 * @see docs/FLOOD.md §1
 * @see docs/CONFIG.md
 */

const DEG2M_LAT = 111_320;

// ─────────────────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} ObstacleBody
 * @property {string}       id         — 고유 식별자
 * @property {'flood_barrier'|'building'|'custom'} type
 * @property {number}       heightM    — 장애물 높이 (m)
 * @property {[number,number][]} footprint — WGS84 [[lon,lat], ...] 폐곡선 (≥3점)
 */

/**
 * @typedef {object} ObstacleBox
 * @property {string}  id
 * @property {'flood_barrier'|'building'|'custom'} type
 * @property {number}  centerE   — AABB 중심 East (m)
 * @property {number}  centerN   — AABB 중심 North (m)
 * @property {number}  halfE     — AABB 반폭 East (m)
 * @property {number}  halfN     — AABB 반폭 North (m)
 * @property {number}  heightM   — 장애물 높이 (m)
 */

// ─────────────────────────────────────────────────────────────────────────────
// WGS84 ↔ ENU 변환 (core 전용, Cesium 미사용)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WGS84 (lon, lat) → ENU 로컬 (eastM, northM)
 *
 * @param {number} lon         — 경도 (도)
 * @param {number} lat         — 위도 (도)
 * @param {number} anchorLon   — 앵커 경도 (도)
 * @param {number} anchorLat   — 앵커 위도 (도)
 * @returns {{ eastM: number, northM: number }}
 */
export function lonLatToEnu(lon, lat, anchorLon, anchorLat) {
  const cosLat = Math.cos(anchorLat * (Math.PI / 180));
  return {
    eastM:  (lon - anchorLon) * DEG2M_LAT * cosLat,
    northM: (lat - anchorLat) * DEG2M_LAT,
  };
}

/**
 * ENU (eastM, northM) → WGS84 (lon, lat)
 *
 * @param {number} eastM
 * @param {number} northM
 * @param {number} anchorLon
 * @param {number} anchorLat
 * @returns {{ lon: number, lat: number }}
 */
export function enuToLonLat(eastM, northM, anchorLon, anchorLat) {
  const cosLat = Math.cos(anchorLat * (Math.PI / 180));
  return {
    lon: anchorLon + eastM  / (DEG2M_LAT * cosLat),
    lat: anchorLat + northM / DEG2M_LAT,
  };
}

/**
 * WGS84 footprint → ENU AABB (axis-aligned bounding box)
 *
 * footprint 의 모든 점을 ENU 로 변환한 뒤 min/max 로 AABB 를 산출합니다.
 * Phase 4 PoC: 직사각형 footprint 는 정확히 일치; 임의 다각형은 외접 AABB 사용.
 *
 * @param {[number,number][]} footprint  [[lon, lat], ...]
 * @param {number} anchorLon
 * @param {number} anchorLat
 * @returns {{ centerE: number, centerN: number, halfE: number, halfN: number }}
 */
export function obstacleFootprintToEnuBox(footprint, anchorLon, anchorLat) {
  let minE =  Infinity, maxE = -Infinity;
  let minN =  Infinity, maxN = -Infinity;

  for (const [lon, lat] of footprint) {
    const { eastM, northM } = lonLatToEnu(lon, lat, anchorLon, anchorLat);
    if (eastM  < minE) minE = eastM;
    if (eastM  > maxE) maxE = eastM;
    if (northM < minN) minN = northM;
    if (northM > maxN) maxN = northM;
  }

  return {
    centerE: (minE + maxE) * 0.5,
    centerN: (minN + maxN) * 0.5,
    halfE:   (maxE - minE) * 0.5,
    halfN:   (maxN - minN) * 0.5,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 설정 로더
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `obstacles.json` 을 파싱해 정규화된 `ObstacleBody[]` 를 반환합니다.
 *
 * @param {object} data  JSON.parse(obstacles.json)
 * @returns {{ obstacles: ObstacleBody[] }}
 */
export function loadObstaclesConfig(data) {
  const raw = Array.isArray(data?.obstacles) ? data.obstacles : [];

  const obstacles = raw.map((o) => ({
    id:        String(o.id       ?? ''),
    type:      String(o.type     ?? 'building'),
    heightM:   Number(o.heightM  ?? 5),
    footprint: Array.isArray(o.footprint) ? o.footprint : [],
  }));

  return { obstacles };
}

/**
 * `ObstacleBody[]` + 앵커 좌표 → `ObstacleBox[]`
 *
 * footprint 가 없거나 3점 미만인 항목은 건너뜁니다.
 *
 * @param {ObstacleBody[]} obstacles
 * @param {number} anchorLon
 * @param {number} anchorLat
 * @returns {ObstacleBox[]}
 */
export function obstacleBodiesToBoxes(obstacles, anchorLon, anchorLat) {
  const boxes = [];
  for (const obs of obstacles) {
    if (!obs.footprint || obs.footprint.length < 3) continue;
    const aabb = obstacleFootprintToEnuBox(obs.footprint, anchorLon, anchorLat);
    boxes.push({
      id:      obs.id,
      type:    obs.type,
      heightM: obs.heightM,
      ...aabb,
    });
  }
  return boxes;
}

/**
 * ENU 직사각형 → WGS84 footprint (4점, 축 정렬)
 *
 * @param {number} centerE
 * @param {number} centerN
 * @param {number} halfE
 * @param {number} halfN
 * @param {number} anchorLon
 * @param {number} anchorLat
 * @returns {[number, number][]}
 */
export function enuRectToFootprint(centerE, centerN, halfE, halfN, anchorLon, anchorLat) {
  const corners = [
    [centerE - halfE, centerN - halfN],
    [centerE + halfE, centerN - halfN],
    [centerE + halfE, centerN + halfN],
    [centerE - halfE, centerN + halfN],
  ];
  return corners.map(([e, n]) => {
    const { lon, lat } = enuToLonLat(e, n, anchorLon, anchorLat);
    return [lon, lat];
  });
}

/**
 * @param {ObstacleBox} box
 * @param {number} anchorLon
 * @param {number} anchorLat
 * @returns {ObstacleBody}
 */
export function obstacleBoxToBody(box, anchorLon, anchorLat) {
  return {
    id:        box.id,
    type:      box.type,
    heightM:   box.heightM,
    footprint: enuRectToFootprint(
      box.centerE, box.centerN, box.halfE, box.halfN, anchorLon, anchorLat,
    ),
  };
}

/**
 * @param {string} id
 * @param {number} heightM
 * @param {number} centerE
 * @param {number} centerN
 * @param {number} halfE
 * @param {number} halfN
 * @returns {ObstacleBox}
 */
export function makeFloodBarrierBox(id, heightM, centerE, centerN, halfE, halfN) {
  return {
    id,
    type:    'flood_barrier',
    heightM,
    centerE,
    centerN,
    halfE,
    halfN,
  };
}
