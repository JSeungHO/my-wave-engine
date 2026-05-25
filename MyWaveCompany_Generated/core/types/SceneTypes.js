/**
 * Cesium 장면(해안 정렬·카메라·Entity) 설정
 */

const DEG2M_LAT = 111_320;

/**
 * @typedef {Object} SceneAnchor
 * @property {number} lon
 * @property {number} lat
 * @property {number} [altM]
 */

/**
 * @typedef {Object} CoastAlignment
 * @property {number} alongCoastBearingDeg  해안선 방향 (북=0°, 시계)
 * @property {number} offshoreBearingDeg    바다 쪽 방위 (offshoreM 가 +)
 * @property {number} offshoreM
 * @property {number} landwardM
 * @property {number} alongCoastM
 * @property {number} [resolution]
 */

/**
 * @typedef {Object} SceneCamera
 * @property {number} lon
 * @property {number} lat
 * @property {number} heightM
 * @property {number} headingDeg
 * @property {number} pitchDeg
 */

/**
 * @typedef {Object} SceneConfig
 * @property {string} name
 * @property {SceneAnchor} anchor
 * @property {CoastAlignment} coast
 * @property {SceneCamera} camera
 * @property {{ ship?: object, buoy?: object }} [entities]
 * @property {{ deep?: number[], shallow?: number[] }} [oceanColors]
 */

/** @param {number} deg @returns {{ e: number, n: number }} */
export function bearingToEnu(deg) {
  const r = (deg * Math.PI) / 180;
  return { e: Math.sin(r), n: Math.cos(r) };
}

/**
 * 해안 정렬 수면의 WGS84 경계 (Material 2a Rectangle용)
 * @param {SceneAnchor} anchor
 * @param {CoastAlignment} coast
 */
export function coastalBoundsToDegrees(anchor, coast) {
  const along = bearingToEnu(coast.alongCoastBearingDeg);
  const sea   = bearingToEnu(coast.offshoreBearingDeg);
  const half  = coast.alongCoastM * 0.5;
  const cosLat = Math.cos((anchor.lat * Math.PI) / 180);

  /** @type {{ lon: number, lat: number }[]} */
  const corners = [
    cornerEnu(anchor, along, sea, -coast.landwardM, -half, cosLat),
    cornerEnu(anchor, along, sea, -coast.landwardM, +half, cosLat),
    cornerEnu(anchor, along, sea, +coast.offshoreM, -half, cosLat),
    cornerEnu(anchor, along, sea, +coast.offshoreM, +half, cosLat),
  ];

  let west = corners[0].lon;
  let east = corners[0].lon;
  let south = corners[0].lat;
  let north = corners[0].lat;

  for (const c of corners) {
    west  = Math.min(west, c.lon);
    east  = Math.max(east, c.lon);
    south = Math.min(south, c.lat);
    north = Math.max(north, c.lat);
  }

  return { west, south, east, north, corners };
}

/**
 * @param {SceneAnchor} anchor
 * @param {{ e: number, n: number }} along
 * @param {{ e: number, n: number }} sea
 * @param {number} seaM
 * @param {number} alongM
 * @param {number} cosLat
 */
function cornerEnu(anchor, along, sea, seaM, alongM, cosLat) {
  const eastM  = seaM * sea.e + alongM * along.e;
  const northM = seaM * sea.n + alongM * along.n;
  return {
    lon: anchor.lon + eastM / (DEG2M_LAT * cosLat),
    lat: anchor.lat + northM / DEG2M_LAT,
  };
}

/**
 * @param {unknown} data
 * @returns {SceneConfig}
 */
export function loadSceneConfig(data) {
  const d = /** @type {Record<string, unknown>} */ (data);
  const anchor = /** @type {SceneAnchor} */ (d.anchor ?? { lon: 129.04, lat: 35.1, altM: 0 });
  const coastRaw = /** @type {Record<string, number>} */ (d.coast ?? {});

  const coast = {
    alongCoastBearingDeg: coastRaw.alongCoastBearingDeg ?? 0,
    offshoreBearingDeg:   coastRaw.offshoreBearingDeg   ?? 90,
    offshoreM:            coastRaw.offshoreM            ?? 7000,
    landwardM:            coastRaw.landwardM            ?? 400,
    alongCoastM:          coastRaw.alongCoastM          ?? 9000,
    resolution:           coastRaw.resolution           ?? 128,
  };

  const camRaw = /** @type {Record<string, number>} */ (d.camera ?? {});
  const camera = {
    lon:        camRaw.lon        ?? anchor.lon,
    lat:        camRaw.lat        ?? anchor.lat,
    heightM:    camRaw.heightM    ?? 450,
    headingDeg: camRaw.headingDeg ?? 0,
    pitchDeg:   camRaw.pitchDeg   ?? -25,
  };

  return {
    name: String(d.name ?? 'Scene'),
    anchor: {
      lon:  Number(anchor.lon),
      lat:  Number(anchor.lat),
      altM: Number(anchor.altM ?? 0),
    },
    coast,
    camera,
    entities: /** @type {SceneConfig['entities']} */ (d.entities ?? {}),
    oceanColors: /** @type {SceneConfig['oceanColors']} */ (d.oceanColors),
  };
}
