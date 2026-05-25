import * as THREE from 'three';
import vertexShader   from '../../core/shaders/ocean.vert.glsl';
import fragmentShader from '../../core/shaders/ocean.frag.glsl';
import { MAX_WAVES }  from '../../core/index.js';

function packDirections(waves) {
  const arr = [];
  for (let i = 0; i < MAX_WAVES; i++) {
    const w = waves[i];
    arr.push(new THREE.Vector2(w?.direction[0] ?? 0, w?.direction[1] ?? 0));
  }
  return arr;
}

function packScalar(waves, key) {
  const arr = new Array(MAX_WAVES).fill(0);
  for (let i = 0; i < waves.length && i < MAX_WAVES; i++) {
    arr[i] = waves[i][key];
  }
  return arr;
}

/**
 * @param {import('../../core/types/WaveTypes.js').GerstnerWaveParams[]} waves
 * @returns {OceanMaterial}
 */
export function createOceanMaterial(waves) {
  return new OceanMaterial(waves);
}

export class OceanMaterial extends THREE.ShaderMaterial {
  /**
   * @param {import('../../core/types/WaveTypes.js').GerstnerWaveParams[]} waves
   */
  constructor(waves) {
    super({
      uniforms: {
        uTime:          { value: 0 },
        uWaveCount:     { value: Math.min(waves.length, MAX_WAVES) },
        uWaveDirection: { value: packDirections(waves) },
        uWaveAmplitude: { value: packScalar(waves, 'amplitude') },
        uWaveWavelength:{ value: packScalar(waves, 'wavelength') },
        uWaveSpeed:     { value: packScalar(waves, 'speed') },
        uWaveSteepness: { value: packScalar(waves, 'steepness') },
        uWavePhase:     { value: packScalar(waves, 'phase') },
        uDeepColor:     { value: new THREE.Color(0x003366) },
        uShallowColor:  { value: new THREE.Color(0x0099cc) },
        uCameraPosition:{ value: new THREE.Vector3() },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
    });
  }

  /** @param {number} time */
  updateTime(time) {
    this.uniforms.uTime.value = time;
  }
}
