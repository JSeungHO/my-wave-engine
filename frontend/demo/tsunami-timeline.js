/**
 * tsunami-timeline.js — 쓰나미 진행 타임라인 (단계 · 사건 표시 · 앞바다 수위 곡선)
 *
 * 단계는 계산 결과(축소 텍스처 통계)로 판단한다 — 미리 정한 시각이 아님.
 *   대기 → 물 빠짐 → 파도 접근 → 차수벽 충돌 → 월파·침수 → 물 빠짐(후퇴)
 *
 * @module demo/tsunami-timeline
 */
import { etaIn, inflowDuration } from '../core/math/TsunamiInflow.js';

export const PHASES = [
  { id: 'idle',     label: '대기 중',          color: '#8c99a6' },
  { id: 'drawdown', label: '물 빠짐',          color: '#6aa9d8' },
  { id: 'approach', label: '파도 접근',        color: '#4fd1c5' },
  { id: 'impact',   label: '차수벽 충돌',      color: '#f2c14e' },
  { id: 'flood',    label: '월파 · 도시 침수', color: '#ff6b4a' },
  { id: 'recede',   label: '물이 빠지는 중',   color: '#9b8cff' },
];
const PH = Object.fromEntries(PHASES.map((p, i) => [p.id, i]));

/** 해안 근처 수위가 이 값(해발 m)을 넘으면 '파도가 해안에 도착'으로 본다 */
export const ARRIVAL_LEVEL = 1.0;

export class TsunamiTimeline {
  constructor(canvas) {
    this.canvas = canvas;
    this.reset();
  }

  reset() {
    this.phase = PH.idle;
    this.events = [];        // { t, label, color }
    this.segments = [];      // { phase, t0, t1 }
    this.peakArea = 0;
    this.peakTime = 0;
    this.impactTime = null;
    this.floodTime = null;
  }

  /** 시작 시각 기록 */
  start(t, params) {
    this.reset();
    this.params = { ...params };
    this._enter(PH.drawdown, t);
    this._event(t, '쓰나미 발생', '#6aa9d8');
    // 앞바다에서 물이 다시 차오르기 시작하는 시각 (곡선상 최저점 이후 0 을 넘는 시각)
    const T = inflowDuration(params);
    let tMin = 0, vMin = 0;
    for (let s = params.startDelay; s < T; s += 0.25) { const v = etaIn(s, params); if (v < vMin) { vMin = v; tMin = s; } }
    let tUp = tMin;
    while (tUp < T && etaIn(tUp, params) < 0.05 * params.amplitude) tUp += 0.25;
    this.waveLeaves = tUp;
  }

  _enter(phase, t) {
    if (this.segments.length) this.segments[this.segments.length - 1].t1 = t;
    this.segments.push({ phase, t0: t, t1: t });
    this.phase = phase;
  }

  _event(t, label, color) { this.events.push({ t, label, color }); }

  /**
   * 매 통계 갱신마다 호출
   * @param {number} t 시뮬레이션 시간
   * @param {{front:number, areaHa:number, maxDepth:number}|null} st
   * @param {number} etaNow 앞바다 수위
   */
  update(t, st, etaNow) {
    if (this.phase === PH.idle || !st) return;
    const p = this.params;
    if (this.segments.length) this.segments[this.segments.length - 1].t1 = t;

    if (this.phase === PH.drawdown && t >= this.waveLeaves) {
      this._enter(PH.approach, t);
      this._event(t, '파도 출발', '#4fd1c5');
    }
    if (this.phase <= PH.approach && st.front >= ARRIVAL_LEVEL) {
      if (this.phase === PH.drawdown) this._event(t, '파도 출발', '#4fd1c5');
      this._enter(PH.impact, t);
      this.impactTime = t;
      this._event(t, '해안 도착', '#f2c14e');
    }
    if (this.phase <= PH.impact && this.phase >= PH.approach && st.areaHa > 0.05) {
      this._enter(PH.flood, t);
      this.floodTime = t;
      this._event(t, '월파', '#ff6b4a');
    }
    if (st.areaHa > this.peakArea) { this.peakArea = st.areaHa; this.peakTime = t; }
    const quiet = Math.abs(etaNow) < 0.15 * p.amplitude && t > this.waveLeaves + 0.4 * p.period;
    if ((this.phase === PH.flood && st.areaHa < this.peakArea * 0.8 && quiet) ||
        (this.phase === PH.impact && quiet && st.front < ARRIVAL_LEVEL && t - this.impactTime > 20)) {
      if (this.phase === PH.flood) this._event(this.peakTime, `최대 침수 ${this.peakArea.toFixed(1)} ha`, '#ff6b4a');
      this._enter(PH.recede, t);
    }
  }

  get phaseInfo() { return PHASES[this.phase]; }
  get canSkip() { return this.phase === PH.drawdown || this.phase === PH.approach; }

  /** 단계별 안내 문구 */
  hint(t) {
    switch (this.phase) {
      case PH.idle: return '‘쓰나미 발생’을 누르면 시작합니다';
      case PH.drawdown: return `앞바다 물이 먼저 빠집니다 · ${Math.max(0, this.waveLeaves - t).toFixed(0)}초 뒤 큰 파도 출발`;
      case PH.approach: return '파도가 해안으로 오면서 얕아져 높아지는 중 (도착 시각은 계산이 정함)';
      case PH.impact: return '파도가 해안에 닿음 — 차수벽에 부딪히는 중';
      case PH.flood: return '벽을 넘은 물이 도로·건물 사이로 퍼지는 중';
      case PH.recede: return '물이 바다로 되돌아가는 중 · 땅의 진흙색 = 최대 침수 흔적';
      default: return '';
    }
  }

  draw(t, started) {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.params) return this._drawIdle(ctx, w, h);

    const p = this.params;
    const t0 = p.startDelay - 2;
    const tEnd = Math.max(inflowDuration(p) + 50, t + 10);
    const X = (s) => ((s - t0) / (tEnd - t0)) * w;
    const barY = 30, barH = 10;

    // 앞바다 수위 곡선 (배경)
    const A = Math.max(1, p.amplitude);
    const Y = (e) => barY - 6 - (e / A) * 18;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke();
    ctx.strokeStyle = 'rgba(79,209,197,0.55)'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i <= w; i += 2) { const e = etaIn(t0 + (i / w) * (tEnd - t0), p); i === 0 ? ctx.moveTo(i, Y(e)) : ctx.lineTo(i, Y(e)); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '10px sans-serif';
    ctx.fillText('앞바다 수위', 2, 9);

    // 막대: 지나간 단계 색칠
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, barY, w, barH);
    for (const sg of this.segments) {
      ctx.fillStyle = PHASES[sg.phase].color;
      ctx.fillRect(X(sg.t0), barY, Math.max(1, X(sg.t1) - X(sg.t0)), barH);
    }

    // 사건 표시
    ctx.font = '11px sans-serif';
    let lastLabelEnd = -Infinity, row = 0;
    for (const ev of [...this.events].sort((a, b) => a.t - b.t)) {
      const x = X(ev.t);
      ctx.strokeStyle = ev.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, barY - 2); ctx.lineTo(x, barY + barH + 4); ctx.stroke();
      const tw = ctx.measureText(ev.label).width;
      row = x < lastLabelEnd + 6 ? 1 - row : 0;
      const ly = barY + barH + 15 + row * 13;
      const lx = Math.min(Math.max(0, x - tw / 2), w - tw);
      ctx.fillStyle = ev.color;
      ctx.fillText(ev.label, lx, ly);
      lastLabelEnd = lx + tw;
    }

    // 현재 위치
    if (started) {
      const x = X(t);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(x - 5, barY - 7); ctx.lineTo(x + 5, barY - 7); ctx.lineTo(x, barY - 1); ctx.fill();
      ctx.fillRect(x - 1, barY - 1, 2, barH + 2);
      ctx.beginPath(); ctx.arc(x, Y(etaIn(t, p)), 3, 0, Math.PI * 2); ctx.fill();
    }

    // 눈금 (30 s)
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '10px sans-serif';
    for (let s = 0; s <= tEnd; s += 30) {
      const x = X(s + p.startDelay);
      if (x < 0 || x > w - 20) continue;
      ctx.fillRect(x, barY + barH, 1, 3);
      ctx.fillText(`${s}s`, x + 2, h - 2);
    }
  }

  _drawIdle(ctx, w, h) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, 30, w, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '11px sans-serif';
    const labels = PHASES.slice(1).map((p) => p.label).join('  →  ');
    ctx.fillText(labels, 2, 58);
  }
}
