import { buildCameraPresets } from '../../core/locations/coastalPresets.js';
import { flyToCamera } from './flyToCamera.js';

/**
 * @param {import('cesium').Viewer} viewer
 * @param {typeof import('cesium')} Cesium
 * @param {import('../../core/types/SceneTypes.js').SceneCamera} sceneCamera
 */
export function bindCameraPresets(viewer, Cesium, sceneCamera) {
  const grid = document.getElementById('cameraPresetGrid');
  if (!grid) {
    return;
  }

  grid.replaceChildren();

  buildCameraPresets(sceneCamera).forEach((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'camera-preset-btn';
    button.textContent = preset.label;
    button.title = preset.description ?? preset.label;
    button.addEventListener('click', () => {
      flyToCamera(viewer, Cesium, preset);
    });
    grid.appendChild(button);
  });
}
