/**
 * @param {import('cesium').Viewer} viewer
 * @param {typeof import('cesium')} Cesium
 * @param {import('../../core/locations/coastalPresets.js').CameraPreset} preset
 * @param {{ duration?: number }} [options]
 */
export function flyToCamera(viewer, Cesium, preset, options = {}) {
  if (!viewer || viewer.isDestroyed?.()) {
    return;
  }

  const { duration = 1.4 } = options;

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      preset.lon,
      preset.lat,
      preset.heightM,
    ),
    orientation: {
      heading: Cesium.Math.toRadians(preset.headingDeg ?? 0),
      pitch: Cesium.Math.toRadians(preset.pitchDeg ?? -45),
      roll: 0,
    },
    duration,
  });
}
