/**
 * Gerstner Wave CPU 솔버 — Three.js / Cesium 공통 사용
 * GPU Gems Ch.1 수식과 동일
 */
export class GerstnerWave {
  /**
   * @param {import('../types/WaveTypes.js').GerstnerWaveParams[]} waves
   * @param {{ buoyancyIterations?: number, baseY?: number }} [options]
   */
  constructor(waves, options = {}) {
    this.waves = waves;
    this.buoyancyIterations = options.buoyancyIterations ?? 3;
    this.baseY = options.baseY ?? 0;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} time
   * @returns {{ x: number, y: number, z: number }}
   */
  displacement(x, z, time) {
    let dx = 0, dy = 0, dz = 0;

    for (const w of this.waves) {
      if (w.amplitude < 1e-6) continue;

      const [Dx, Dz] = w.direction;
      const k     = (2 * Math.PI) / Math.max(w.wavelength, 0.001);
      const omega = w.speed * k;
      const phi   = k * (Dx * x + Dz * z) + omega * time;
      const sinP  = Math.sin(phi);
      const cosP  = Math.cos(phi);

      dx += w.steepness * w.amplitude * Dx * cosP;
      dz += w.steepness * w.amplitude * Dz * cosP;
      dy += w.amplitude * sinP;
    }

    return { x: dx, y: dy, z: dz };
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} time
   * @returns {{ x: number, y: number, z: number }}
   */
  normal(x, z, time) {
    let sumNx = 0, sumNz = 0, sumNy = 0;

    for (const w of this.waves) {
      if (w.amplitude < 1e-6) continue;

      const [Dx, Dz] = w.direction;
      const k     = (2 * Math.PI) / Math.max(w.wavelength, 0.001);
      const omega = w.speed * k;
      const kA    = k * w.amplitude;
      const phi   = k * (Dx * x + Dz * z) + omega * time;
      const sinP  = Math.sin(phi);
      const cosP  = Math.cos(phi);

      sumNx += Dx * kA * cosP;
      sumNz += Dz * kA * cosP;
      sumNy += w.steepness * kA * sinP;
    }

    const nx  = -sumNx;
    const ny  = 1 - sumNy;
    const nz  = -sumNz;
    const len = Math.hypot(nx, ny, nz) || 1;

    return { x: nx / len, y: ny / len, z: nz / len };
  }

  /**
   * @param {number} x - 월드 x
   * @param {number} z - 월드 z
   * @param {number} time
   * @returns {number} 수면 y 높이
   */
  getWaterHeight(x, z, time) {
    let sx = x, sz = z;

    for (let i = 0; i < this.buoyancyIterations; i++) {
      const disp = this.displacement(sx, sz, time);
      sx = x - disp.x;
      sz = z - disp.z;
    }

    return this.baseY + this.displacement(sx, sz, time).y;
  }
}
