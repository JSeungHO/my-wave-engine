import { describe, expect, it } from 'vitest';
import {
  buildCameraPresets,
  CAMERA_PRESETS,
  isValidCameraPreset,
} from './coastalPresets.js';

describe('coastalPresets', () => {
  const sceneCamera = {
    lon: 129.163,
    lat: 35.1568,
    heightM: 220,
    headingDeg: 0,
    pitchDeg: -48,
  };

  it('includes scene default as first preset', () => {
    const presets = buildCameraPresets(sceneCamera);
    expect(presets[0].id).toBe('haeundae-scene');
    expect(presets[0].heightM).toBe(220);
  });

  it('includes gangnam preset for GeoHazard link', () => {
    const gangnam = CAMERA_PRESETS.find((preset) => preset.id === 'gangnam');
    expect(gangnam?.lon).toBeCloseTo(127.0267, 4);
    expect(gangnam?.lat).toBeCloseTo(37.4975, 4);
  });

  it('validates all built presets', () => {
    buildCameraPresets(sceneCamera).forEach((preset) => {
      expect(isValidCameraPreset(preset)).toBe(true);
    });
  });
});
