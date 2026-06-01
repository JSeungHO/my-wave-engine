/**
 * @typedef {Object} CameraPreset
 * @property {string} id
 * @property {string} label
 * @property {number} lon
 * @property {number} lat
 * @property {number} heightM
 * @property {number} [headingDeg=0]
 * @property {number} [pitchDeg=-45]
 * @property {string} [description]
 */

/** @type {CameraPreset[]} */
export const CAMERA_PRESETS = [
  {
    id: 'haeundae-wide',
    label: '해운대 (광역)',
    lon: 129.163,
    lat: 35.158,
    heightM: 1200,
    headingDeg: 0,
    pitchDeg: -55,
    description: '수면·차수벽 전체 조망',
  },
  {
    id: 'gangnam',
    label: '강남역',
    lon: 127.0267,
    lat: 37.4975,
    heightM: 650,
    headingDeg: 15,
    pitchDeg: -40,
    description: 'GeoHazard 홍수 시뮬레이션 연계',
  },
];

/**
 * @param {import('../types/SceneTypes.js').SceneCamera} sceneCamera
 * @returns {CameraPreset[]}
 */
export function buildCameraPresets(sceneCamera) {
  return [
    {
      id: 'haeundae-scene',
      label: '해운대 (장면)',
      lon: sceneCamera.lon,
      lat: sceneCamera.lat,
      heightM: sceneCamera.heightM,
      headingDeg: sceneCamera.headingDeg,
      pitchDeg: sceneCamera.pitchDeg,
      description: 'scene.json 기본 카메라',
    },
    ...CAMERA_PRESETS,
  ];
}

/** @param {CameraPreset} preset */
export function isValidCameraPreset(preset) {
  return (
    Boolean(preset?.id)
    && Boolean(preset?.label)
    && Number.isFinite(preset.lon)
    && Number.isFinite(preset.lat)
    && Number.isFinite(preset.heightM)
    && preset.heightM > 0
  );
}
