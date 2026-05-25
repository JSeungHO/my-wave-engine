/**
 * ObstacleField.js — Phase 4 CPU 장애물 dry zone 판별
 *
 * AABB(축 정렬 경계 상자) 배열을 받아 주어진 ENU 좌표가
 * 장애물 내부인지, 가장 가까운 경계까지의 거리는 얼마인지 계산합니다.
 *
 * ## 설계 원칙
 * * `core/` 원칙 준수: **Cesium·Three.js import 절대 금지**
 * * GPU(fragment shader) 와 동일한 AABB SDF 수식 사용 → CPU·GPU 일관성 보장
 *
 * ## AABB SDF 수식
 *
 * ```
 *   dE  = |e - centerE| − halfE
 *   dN  = |n - centerN| − halfN
 *   sdf = max(dE, dN)   // Chebyshev distance to nearest edge
 *   sdf < 0  ⟹  inside obstacle (dry)
 * ```
 *
 * @module core/math/ObstacleField
 * @see core/types/ObstacleTypes.js
 * @see adapters/cesium/GerstnerWaterPrimitiveGPU.js  buildFragmentShader
 * @see docs/FLOOD.md §1
 */

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

/** 지원 최대 장애물 수 — GPU buildFragmentShader MAX_OBSTACLES 와 동일 */
export const MAX_OBSTACLES = 8;

// ─────────────────────────────────────────────────────────────────────────────
// ObstacleField
// ─────────────────────────────────────────────────────────────────────────────

export class ObstacleField {
  /**
   * @param {import('../types/ObstacleTypes.js').ObstacleBox[]} boxes
   *   AABB 장애물 배열 (최대 MAX_OBSTACLES)
   */
  constructor(boxes) {
    /** @type {import('../types/ObstacleTypes.js').ObstacleBox[]} */
    this._boxes = (boxes ?? []).slice(0, MAX_OBSTACLES);
  }

  // ── 조회 ─────────────────────────────────────────────────────────────────

  /** @returns {import('../types/ObstacleTypes.js').ObstacleBox[]} */
  get boxes() { return this._boxes; }

  /** @returns {number} */
  get count() { return this._boxes.length; }

  // ── 판별 ─────────────────────────────────────────────────────────────────

  /**
   * ENU 좌표 (e, n) 가 어떤 장애물 내부인지 확인합니다.
   *
   * CPU 로직 = GPU fragment shader 의 AABB SDF 와 동일.
   *
   * @param {number} e  ENU East (m)
   * @param {number} n  ENU North (m)
   * @returns {boolean}  true = dry (장애물 내부)
   */
  isDry(e, n) {
    for (const b of this._boxes) {
      if (Math.abs(e - b.centerE) < b.halfE &&
          Math.abs(n - b.centerN) < b.halfN) {
        return true;
      }
    }
    return false;
  }

  /**
   * 가장 가까운 장애물까지의 SDF 거리를 반환합니다.
   *
   * * 음수 → 내부 (dry zone)
   * * 0    → 경계선 위
   * * 양수 → 외부 (물이 흐르는 구역)
   *
   * @param {number} e  ENU East (m)
   * @param {number} n  ENU North (m)
   * @returns {number}  meters, negative = inside
   */
  signedDist(e, n) {
    let minDist = Infinity;
    for (const b of this._boxes) {
      const dE   = Math.abs(e - b.centerE) - b.halfE;
      const dN   = Math.abs(n - b.centerN) - b.halfN;
      const dist = Math.max(dE, dN);
      if (dist < minDist) minDist = dist;
    }
    return minDist;
  }

  /**
   * SDF 를 기준으로 edge foam 강도 (0~1) 를 반환합니다.
   * `edgeWidthM` 이내에서 선형적으로 증가합니다.
   *
   * @param {number} e
   * @param {number} n
   * @param {number} [edgeWidthM=8]
   * @returns {number}  0 (외부) ~ 1 (경계 바로 앞)
   */
  edgeFoam(e, n, edgeWidthM = 8) {
    const dist = this.signedDist(e, n);
    if (dist < 0) return 0; // 내부 — 이미 dry
    const t = 1 - dist / edgeWidthM;
    return t > 0 ? t * t : 0; // quadratic falloff
  }

  // ── Landward Clip ─────────────────────────────────────────────────────────

  /**
   * 차수벽 뒤(landward) 보호 — surge/파고가 벽 높이 미만일 때만 **서서히** 약화.
   * 지리적 일자 discard 대신 높이 기반 + 북쪽으로 부드러운 fade.
   *
   * @returns {string} GLSL — `barrierShield`, `barrierOvertop`, `barrierSplash`
   */
  buildGlslBarrierShield() {
    const barriers = this._boxes.filter((b) => b.type === 'flood_barrier');
    if (barriers.length === 0) {
      return `
    float barrierShield  = 0.0;
    float barrierOvertop = 0.0;
    float barrierSplash  = 0.0;
`;
    }

    let code = `
    float barrierShield  = 0.0;
    float barrierOvertop = 0.0;
    float barrierSplash  = 0.0;
`;
    for (let i = 0; i < barriers.length; i++) {
      const b = barriers[i];
      const ce = b.centerE.toFixed(4);
      const he = b.halfE.toFixed(4);
      const hn = b.halfN.toFixed(4);
      const northEdge = (b.centerN + b.halfN).toFixed(4);
      const southEdge = (b.centerN - b.halfN).toFixed(4);
      const wallH = b.heightM.toFixed(4);
      code += `
    /* barrier shield ${i}: ${b.id} */
    {
      bool  _inE${i}   = abs(v_enuPos.x - ${ce}) <= ${he};
      float _landN${i} = v_enuPos.y - ${northEdge};
      if (_inE${i} && _landN${i} > 0.0) {
        float _fadeN${i} = smoothstep(90.0, 4.0, _landN${i});
        float _over${i}  = v_waveHeight - ${wallH};
        if (_over${i} < 0.0) {
          float _below${i} = smoothstep(0.0, ${wallH}, -_over${i});
          barrierShield = max(barrierShield, _below${i} * _fadeN${i});
        } else {
          barrierOvertop = max(barrierOvertop, smoothstep(0.0, 1.8, _over${i}) * _fadeN${i});
        }
      }
      if (_inE${i} && v_enuPos.y >= ${southEdge} - 6.0 && v_enuPos.y <= ${northEdge} + 4.0) {
        float _hit${i} = smoothstep(${wallH} * 0.75, ${wallH} * 1.15, v_waveHeight);
        float _face${i} = 1.0 - smoothstep(0.0, ${hn}, abs(v_enuPos.y - ${southEdge}));
        barrierSplash = max(barrierSplash, _hit${i} * _face${i});
      }
    }
`;
    }
    return code;
  }

  /**
   * @deprecated buildGlslBarrierShield() — 높이 기반 보호
   * @returns {string}
   */
  buildGlslLandwardDry() {
    return this.buildGlslBarrierShield();
  }

  /**
   * 차수벽 **양끝 밖** 미보호 구간 넘침 foam (fragment)
   * @returns {string} GLSL — `float sideOverflow` 0~1
   */
  buildGlslSideOverflow() {
    const barriers = this._boxes.filter((b) => b.type === 'flood_barrier');
    if (barriers.length === 0) {
      return 'float sideOverflow = 0.0;';
    }

    let code = 'float sideOverflow = 0.0;\n';
    for (let i = 0; i < barriers.length; i++) {
      const b = barriers[i];
      const ce = b.centerE.toFixed(4);
      const cn = b.centerN.toFixed(4);
      const he = b.halfE.toFixed(4);
      const hn = b.halfN.toFixed(4);
      const southEdge = (b.centerN - b.halfN).toFixed(4);
      const wallH = b.heightM.toFixed(4);
      code += `
    /* side overflow ${i}: ${b.id} */
    {
      float _beyondE${i} = abs(v_enuPos.x - ${ce}) - ${he};
      if (_beyondE${i} > 0.0 && _beyondE${i} < 120.0 && v_enuPos.y > ${southEdge}) {
        float _crest${i} = smoothstep(${wallH} * 0.65, ${wallH} * 1.05, v_waveHeight);
        float _sideT${i} = (1.0 - _beyondE${i} / 120.0) * _crest${i};
        sideOverflow = max(sideOverflow, _sideT${i});
      }
    }
`;
    }
    return code;
  }

  /**
   * @deprecated fragment shader 는 buildGlslLandwardDry() 사용
   * @returns {number}
   */
  getLandwardClipN() {
    let clipN = -Infinity;
    for (const b of this._boxes) {
      if (b.type === 'flood_barrier') {
        const northEdge = b.centerN + b.halfN;
        if (northEdge > clipN) clipN = northEdge;
      }
    }
    return clipN === -Infinity ? Infinity : clipN;
  }

  // ── GPU 셰이더 지원 ───────────────────────────────────────────────────────

  /**
   * GLSL 장애물 테스트 코드를 생성합니다.
   * `buildFragmentShader` 내에서 호출됩니다.
   *
   * 생성 GLSL 변수:
   *   `bool isDry`       — true if inside any obstacle
   *   `float obstMinDist` — signed distance to nearest edge (m)
   *
   * @returns {string}  GLSL 코드 스니펫
   */
  buildGlsl() {
    let code = `
    float obstMinDist = 1.0e6;
    bool  isDry       = false;
`;
    for (let i = 0; i < this._boxes.length; i++) {
      const b   = this._boxes[i];
      const ce  = b.centerE.toFixed(4);
      const cn  = b.centerN.toFixed(4);
      const he  = b.halfE.toFixed(4);
      const hn  = b.halfN.toFixed(4);
      code += `
    /* obstacle ${i}: ${b.id} (${b.type}) */
    {
      float _dE${i} = abs(v_enuPos.x - ${ce}) - ${he};
      float _dN${i} = abs(v_enuPos.y - ${cn}) - ${hn};
      float _d${i}  = max(_dE${i}, _dN${i});
      if (_d${i} < 0.0) isDry = true;
      obstMinDist   = min(obstMinDist, _d${i});
    }
`;
    }
    return code;
  }
}
