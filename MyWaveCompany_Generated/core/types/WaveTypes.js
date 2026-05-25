export const MAX_WAVES = 8;

/**
 * @typedef {Object} GerstnerWaveParams
 * @property {string} name
 * @property {[number, number]} direction - 정규화된 xz 방향
 * @property {number} amplitude
 * @property {number} wavelength
 * @property {number} speed
 * @property {number} steepness
 */

/**
 * @typedef {Object} OceanConfig
 * @property {number} meshResolutionX
 * @property {number} meshResolutionZ
 * @property {number} meshSizeX
 * @property {number} meshSizeZ
 * @property {number} buoyancyIterations
 */

/**
 * @typedef {Object} WavesConfig
 * @property {OceanConfig} ocean
 * @property {GerstnerWaveParams[]} waves
 */

function normalizeDirection(dir) {
  const x = Array.isArray(dir) ? dir[0] : dir.x ?? 1;
  const z = Array.isArray(dir) ? dir[1] : dir.z ?? dir.y ?? 0;
  const len = Math.hypot(x, z);
  return len < 1e-6 ? [1, 0] : [x / len, z / len];
}

/**
 * @param {object} data - waves.json 파싱 결과
 * @returns {WavesConfig}
 */
export function loadWavesConfig(data) {
  const ocean = data.ocean ?? {};

  /** @type {GerstnerWaveParams[]} */
  const waves = (data.waves ?? []).slice(0, MAX_WAVES).map((w) => ({
    name:       w.name       ?? '',
    direction:  normalizeDirection(w.direction),
    amplitude:  w.amplitude  ?? 0,
    wavelength: w.wavelength ?? 1,
    speed:      w.speed      ?? 1,
    steepness:  w.steepness  ?? 0.5,
  }));

  return {
    ocean: {
      meshResolutionX:    ocean.meshResolutionX    ?? 128,
      meshResolutionZ:    ocean.meshResolutionZ    ?? 128,
      meshSizeX:          ocean.meshSizeX          ?? 200,
      meshSizeZ:          ocean.meshSizeZ          ?? 200,
      buoyancyIterations: ocean.buoyancyIterations ?? 3,
    },
    waves,
  };
}
