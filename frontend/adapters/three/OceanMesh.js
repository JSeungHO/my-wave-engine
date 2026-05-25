import * as THREE from 'three';

/**
 * Three.js PlaneGeometry 기반 Ocean 메시
 * waves.json config 로 크기·해상도를 설정하고, update(t) 로 OceanMaterial uTime 을 갱신합니다.
 */
export class OceanMesh extends THREE.Mesh {
  /**
   * @param {import('../../core/types/WaveTypes.js').WavesConfig} config
   * @param {import('./OceanMaterial.js').OceanMaterial} material
   */
  constructor(config, material) {
    const { meshResolutionX, meshResolutionZ, meshSizeX, meshSizeZ } = config.ocean;

    const geometry = new THREE.PlaneGeometry(
      meshSizeX, meshSizeZ,
      meshResolutionX, meshResolutionZ,
    );
    // PlaneGeometry 는 XY 평면 → XZ 평면으로 회전
    geometry.rotateX(-Math.PI / 2);

    super(geometry, material);
    this._material = material;
  }

  /** @param {number} time 경과 시간(초) */
  update(time) {
    this._material.updateTime(time);
  }
}
