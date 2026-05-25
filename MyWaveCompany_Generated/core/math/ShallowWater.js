/**
 * ShallowWater.js — Phase 5 CPU 2D 홍수 시뮬레이션
 *
 * 간략화된 Diffusive-Advective Wave 모델:
 *   ∂h/∂t = -v_N · ∂h/∂N + D · ∇²h
 *
 * * v_N  = sqrt(g · baseHeightM)   (얕은 수파 전파 속도)
 * * D    = 80 m²/s                 (측면 확산 — 건물 우회)
 *
 * ## 그리드
 * * 원점 (originE, originN) = 수면 메시의 남서 모서리
 * * 셀 (i, j): East = originE + (i+0.5)·cs, North = originN + (j+0.5)·cs
 * * j=0 : 남쪽 유입 경계 (Dirichlet h = inflowH)
 * * j=ny-1 : 북쪽 유출 경계 (Dirichlet h = 0)
 * * 동·서 : Neumann (flux = 0)
 * * 장애물 셀 : Neumann (no-flow)
 *
 * ## CFL 안정성 조건
 * ```
 * dt ≤ 0.9 · min(cs / v_N, cs² / (4D))
 * ```
 *
 * ## 설계 원칙
 * * `core/` 규칙 — Cesium·Three.js import 금지
 *
 * @module core/math/ShallowWater
 * @see core/types/FloodTypes.js    설정 타입
 * @see adapters/cesium/FloodLayer.js  GPU 연동
 * @see docs/FLOOD.md §2
 */

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

/** 중력 가속도 m/s² */
const G = 9.81;

/** 측면 확산 계수 m²/s — 건물 주위 우회 확산 */
const LATERAL_DIFFUSION = 80.0;

// ─────────────────────────────────────────────────────────────────────────────
// ShallowWater
// ─────────────────────────────────────────────────────────────────────────────

export class ShallowWater {
  /**
   * @param {{
   *   cellSizeM: number,
   *   widthM:    number,
   *   depthM:    number,
   *   originE:   number,
   *   originN:   number,
   * }} gridCfg
   * @param {import('../types/FloodTypes.js').FloodInflowConfig} inflowCfg
   * @param {import('./ObstacleField.js').ObstacleField|null} obstacleField
   */
  constructor(gridCfg, inflowCfg, obstacleField = null) {
    const cs    = gridCfg.cellSizeM ?? 8;
    const nx    = Math.ceil(gridCfg.widthM / cs);
    const ny    = Math.ceil(gridCfg.depthM / cs);

    this._cs      = cs;
    this._nx      = nx;
    this._ny      = ny;
    this._originE = gridCfg.originE ?? -700;
    this._originN = gridCfg.originN ?? -600;

    /** 유입 높이 (m) — UI에서 실시간 변경 가능 */
    this._inflowH = inflowCfg.baseHeightM ?? 1.5;

    /** 북향 파동 전파 속도 (m/s) — inflowH 에서 계산 */
    this._vN = Math.sqrt(G * this._inflowH);

    /** 높이 필드 h[i + j*nx] (m) */
    this._h = new Float32Array(nx * ny);

    /** 장애물 마스크 (1 = wall, no-flow) */
    this._wallMask = new Uint8Array(nx * ny);

    if (obstacleField) {
      this._buildWallMask(obstacleField);
    }
  }

  // ── 조회 ──────────────────────────────────────────────────────────────────

  get nx() { return this._nx; }
  get ny() { return this._ny; }
  get cellSizeM() { return this._cs; }
  get originE() { return this._originE; }
  get originN() { return this._originN; }
  get inflowH() { return this._inflowH; }

  /**
   * 현재 높이 필드를 반환합니다.
   * @returns {Float32Array}  length = nx * ny
   */
  getHeightField() { return this._h; }

  // ── 설정 ──────────────────────────────────────────────────────────────────

  /**
   * 유입 높이 변경 — UI 슬라이더와 연동
   * @param {number} h  m
   */
  setInflowHeight(h) {
    this._inflowH = Math.max(0.05, h);
    this._vN      = Math.sqrt(G * this._inflowH);
  }

  // ── 시뮬레이션 ──────────────────────────────────────────────────────────

  /**
   * 시뮬레이션을 dt 초 진행합니다.
   *
   * CFL 조건이 요구하는 서브스텝 수를 자동 계산합니다.
   *
   * @param {number} dt  시뮬레이션 시간 (초)
   */
  step(dt) {
    if (dt <= 0) return;

    const cs    = this._cs;
    const vN    = this._vN;
    const D     = LATERAL_DIFFUSION;

    // CFL 조건: advection + diffusion 합산
    const dtAdv  = cs / (vN + 1e-8);
    const dtDiff = cs * cs / (4.0 * D);
    const dtMax  = 0.9 * Math.min(dtAdv, dtDiff);

    const nSub = Math.max(1, Math.ceil(dt / dtMax));
    const dts  = dt / nSub;

    for (let s = 0; s < nSub; s++) {
      this._doStep(dts);
    }
  }

  /**
   * 시뮬레이션 상태를 초기화합니다 (h = 0).
   */
  reset() {
    this._h.fill(0);
  }

  // ── 내부 ──────────────────────────────────────────────────────────────────

  /**
   * 단일 explicit 서브스텝 (advection-diffusion).
   * @private
   * @param {number} dt
   */
  _doStep(dt) {
    const nx    = this._nx;
    const ny    = this._ny;
    const cs    = this._cs;
    const cs2   = cs * cs;
    const D     = LATERAL_DIFFUSION;
    const vN    = this._vN;
    const inflH = this._inflowH;
    const h     = this._h;
    const wall  = this._wallMask;
    const hNew  = new Float32Array(h);

    // ── 남쪽 경계 (j=0): 고정 유입 (Dirichlet) ───────────────────────────
    for (let i = 0; i < nx; i++) {
      hNew[i] = inflH;
    }

    // ── 내부 셀 ──────────────────────────────────────────────────────────
    for (let j = 1; j < ny; j++) {
      const isNorth = j === ny - 1;

      for (let i = 0; i < nx; i++) {
        const idx = i + j * nx;

        if (wall[idx]) {
          hNew[idx] = 0;
          continue;
        }

        const hij = h[idx];

        // ── 이웃 높이 가져오기 (경계·벽 → Neumann) ────────────────────────
        // 남 (j-1): j=1 이면 유입 경계, 아니면 배열 참조
        const hS = (j === 1)
          ? inflH
          : (wall[i + (j - 1) * nx] ? hij : h[i + (j - 1) * nx]);

        // 북 (j+1): 마지막 행 → 유출 경계 (h=0)
        const hN = isNorth
          ? 0
          : (wall[i + (j + 1) * nx] ? hij : h[i + (j + 1) * nx]);

        // 서 (i-1): 도메인 밖 → Neumann (반사)
        const hW = (i === 0)
          ? hij
          : (wall[(i - 1) + j * nx] ? hij : h[(i - 1) + j * nx]);

        // 동 (i+1): 도메인 밖 → Neumann (반사)
        const hE = (i === nx - 1)
          ? hij
          : (wall[(i + 1) + j * nx] ? hij : h[(i + 1) + j * nx]);

        // ── 확산 (Laplacian 중앙차분) ────────────────────────────────────
        const lap = (hS + hN + hW + hE - 4.0 * hij) / cs2;

        // ── 북향 이류 (upwind: j 증가 방향) ─────────────────────────────
        //   ∂h/∂N ≈ (h[j] - h[j-1]) / cs  (upwind, 북향 속도 vN)
        const advN = vN * (hij - hS) / cs;

        // ── 시간 적분 (forward Euler) ────────────────────────────────────
        hNew[idx] = Math.max(0, hij + dt * (D * lap - advN));
      }
    }

    // ── 북쪽 경계 (j=ny-1): 유출 (h=0) ──────────────────────────────────
    for (let i = 0; i < nx; i++) {
      const idx = i + (ny - 1) * nx;
      if (!wall[idx]) hNew[idx] = 0;
    }

    this._h = hNew;
  }

  /**
   * ObstacleField 를 사용해 장애물 마스크를 빌드합니다.
   *
   * 셀 중심이 장애물 내부인 경우 wall=1.
   *
   * @private
   * @param {import('./ObstacleField.js').ObstacleField} obstacleField
   */
  _buildWallMask(obstacleField) {
    const { _nx: nx, _ny: ny, _cs: cs, _originE: oE, _originN: oN } = this;
    const mask = this._wallMask;

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const e = oE + (i + 0.5) * cs;
        const n = oN + (j + 0.5) * cs;
        mask[i + j * nx] = obstacleField.isDry(e, n) ? 1 : 0;
      }
    }
  }

  /**
   * 홍수 전선 ENU North 좌표를 반환합니다.
   *
   * `threshold` 이상의 수위가 있는 셀 중 가장 북쪽(j 최대)의 행 중심 N 반환.
   * 홍수가 없으면 격자 남쪽 500 m 아래(originN − 500)를 반환합니다.
   *
   * ## GerstnerWaterPrimitiveGPU 연동
   * 반환값을 `ocean.updateFloodFront(frontN, effectiveMaxH)` 에 전달하면
   * GPU 버텍스 셰이더가 smoothstep 으로 홍수 전선을 시각화합니다.
   *
   * @param {number} [threshold=0.05]  최소 수위 임계값 (m)
   * @returns {number}  ENU North (m)
   */
  getFloodFront(threshold = 0.05) {
    const nx = this._nx;
    const ny = this._ny;
    const h  = this._h;

    for (let j = ny - 1; j >= 0; j--) {
      for (let i = 0; i < nx; i++) {
        if (h[i + j * nx] > threshold) {
          return this._originN + (j + 0.5) * this._cs;
        }
      }
    }

    // 홍수 없음 — 격자 남쪽 500 m 아래 반환
    // GLSL 에서 smoothstep(originN-500, originN-300, xN) → xN 전체 ≥ 1 → flood=0
    return this._originN - 500;
  }

  /**
   * ENU 위치 (e, n) 에서 이중선형 보간된 홍수 수면 높이를 반환합니다.
   *
   * @param {number} e  ENU East (m)
   * @param {number} n  ENU North (m)
   * @returns {number}  홍수 수면 높이 (m), 그리드 밖이면 0
   */
  getHeightAt(e, n) {
    const cs  = this._cs;
    const oE  = this._originE;
    const oN  = this._originN;
    const nx  = this._nx;
    const ny  = this._ny;
    const h   = this._h;

    const fi = (e - oE) / cs - 0.5;
    const fj = (n - oN) / cs - 0.5;

    const i0 = Math.floor(fi);
    const j0 = Math.floor(fj);
    const i1 = i0 + 1;
    const j1 = j0 + 1;

    if (i0 < 0 || i1 >= nx || j0 < 0 || j1 >= ny) return 0;

    const tx = fi - i0;
    const ty = fj - j0;

    const h00 = h[i0 + j0 * nx];
    const h10 = h[i1 + j0 * nx];
    const h01 = h[i0 + j1 * nx];
    const h11 = h[i1 + j1 * nx];

    return (1 - tx) * (1 - ty) * h00
      +    tx       * (1 - ty) * h10
      + (1 - tx)   *     ty   * h01
      +    tx       *     ty   * h11;
  }
}
