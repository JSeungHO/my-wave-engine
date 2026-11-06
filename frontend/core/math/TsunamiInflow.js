/**
 * TsunamiInflow.js — 앞바다 경계에서 들어오는 쓰나미 수위 곡선 η_in(t)
 *
 * 실제 쓰나미의 전형적인 모양(leading-depression N-wave)을 단순화했다.
 *   1) 물 빠짐 (drawdown)   — 해안의 물이 먼저 바다 쪽으로 빠져나감
 *   2) 주 파봉 (main crest) — 가장 큰 파도
 *   3) 후속 파 (2nd crest)  — 더 작은 두 번째 파도
 *
 * 앞바다(수심 ~24 m)에서 정의한 값이며, 해안으로 올수록 얕아져서
 * 파고가 커지고 앞면이 가팔라져 '물 벽(bore)'이 된다 — 이건 계산기가 만든다.
 *
 * GLSL 버전(core/shaders/tsunamiSwe.js 의 ETA_IN_GLSL)과 식이 같아야 한다.
 *
 * ## 설계 원칙
 * * `core/` 규칙 — Cesium·Three.js import 금지
 *
 * @module core/math/TsunamiInflow
 */

/** @typedef {{amplitude:number, period:number, drawdown:number, secondWave:number, startDelay:number}} TsunamiParams */

/** 기본값: 앞바다 파고 6 m, 주기 90 s */
export const DEFAULT_TSUNAMI = Object.freeze({
  amplitude: 6.0,   // 주 파봉 높이 (m, 앞바다 기준)
  period: 90.0,     // 파도 한 주기 (s)
  drawdown: 0.45,   // 물 빠짐 깊이 = amplitude × drawdown
  secondWave: 0.45, // 두 번째 파봉 = amplitude × secondWave
  startDelay: 4.0,  // 시작 후 대기 (s)
});

function gauss(x, c, w) {
  const d = (x - c) / w;
  return Math.exp(-d * d);
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * 앞바다 경계 수위 (m, 평균 해수면 기준)
 * @param {number} t  시뮬레이션 시간 (s)
 * @param {TsunamiParams} p
 */
export function etaIn(t, p = DEFAULT_TSUNAMI) {
  const tau = t - p.startDelay;
  if (tau <= 0) return 0;
  const T = p.period;
  const ramp = smoothstep(0, 0.12 * T, tau);
  const down = -p.drawdown * gauss(tau, 0.22 * T, 0.16 * T);
  const main = gauss(tau, 0.72 * T, 0.2 * T);
  const second = p.secondWave * gauss(tau, 1.75 * T, 0.24 * T);
  return p.amplitude * ramp * (down + main + second);
}

/** 이 곡선이 사실상 끝나는 시각 (s) — 그래프 x축 범위용 */
export function inflowDuration(p = DEFAULT_TSUNAMI) {
  return p.startDelay + 2.4 * p.period;
}
