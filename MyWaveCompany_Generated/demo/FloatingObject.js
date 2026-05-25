import * as THREE from 'three';

const _up       = new THREE.Vector3(0, 1, 0);
const _targetUp = new THREE.Vector3();
const _quat     = new THREE.Quaternion();

/**
 * CPU getWaterHeight 기반 부력 샘플 — Cesium 엔티티 연동 시 동일 API 사용
 */
export class FloatingObject {
  /**
   * @param {import('../core/math/GerstnerWave.js').GerstnerWave} solver
   * @param {THREE.Object3D} mesh
   * @param {{ offsetY?: number, tiltStrength?: number }} [options]
   */
  constructor(solver, mesh, options = {}) {
    this.solver       = solver;
    this.mesh         = mesh;
    this.offsetY      = options.offsetY      ?? 0.5;
    this.tiltStrength = options.tiltStrength ?? 0.12;
  }

  /** @param {number} time */
  update(time) {
    const { x, z } = this.mesh.position;
    const y        = this.solver.getWaterHeight(x, z, time);
    this.mesh.position.y = y + this.offsetY;

    const n = this.solver.normal(x, z, time);
    _targetUp.set(n.x, n.y, n.z);
    _quat.setFromUnitVectors(_up, _targetUp);
    this.mesh.quaternion.slerp(_quat, this.tiltStrength);
  }
}
