/**
 * gen_WakeField.js  — 자동화 엔진 템플릿
 *
 * 대상: core/math/WakeField.js
 * 접두사: gen_ → Program.cs 가 생성, 직접 수정 금지
 *
 * Phase 3 에서 Program.cs 가 이 파일을 읽어
 *   1. `{{maxSources}}`, `{{decayTimeSec}}` 등 template 변수를
 *      interaction.json / 기획서.md 값으로 치환
 *   2. gen_ 접두사를 제거한 뒤 core/math/WakeField.js 로 출력
 *
 * 현재(Phase 2c) 는 수동으로 MyWaveCompany_Generated/core/math/WakeField.js 를 유지합니다.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 템플릿 변수 목록 (Phase 3 치환 대상)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * {{maxSources}}     interaction.json → wake.maxSources         (기본 16)
 * {{decayTimeSec}}   interaction.json → wake.decayTimeSec       (기본 8)
 * {{minSpeedKnots}}  interaction.json → wake.minSpeedKnots      (기본 1.0)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 생성 경로
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Templates/core/gen_WakeField.js
 *     → (Program.cs 치환 + 복사)
 *     → MyWaveCompany_Generated/core/math/WakeField.js
 *
 * @see 기획서.md §Templates/ 호환 구조
 * @see 기획서.md §Phase 2c 기획 §3. core/math/WakeField.js
 */

// TODO: Phase 3 — Program.cs 가 이 파일을 기반으로 WakeField.js 를 생성합니다.
//       현재는 MyWaveCompany_Generated/core/math/WakeField.js 를 직접 유지하세요.

import { MAX_WAKE_SOURCES, KNOTS_TO_MS } from '../types/InteractionTypes.js';

const TWO_PI = 2 * Math.PI;

export class WakeField {
  constructor(config = {}) {
    this.maxSources   = config.maxSources   ?? {{maxSources}};
    this.decayTimeSec = config.decayTimeSec ?? {{decayTimeSec}};
    this.minSpeedMs   = (config.minSpeedKnots ?? {{minSpeedKnots}}) * KNOTS_TO_MS;
    this._sources     = [];
  }

  // ... (Phase 3: Program.cs 가 WakeField.js 전체 구현을 인라인)
}
