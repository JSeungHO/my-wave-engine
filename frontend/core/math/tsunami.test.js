import { describe, it, expect } from 'vitest';
import { etaIn, DEFAULT_TSUNAMI, inflowDuration } from './TsunamiInflow.js';
import { buildCoastTerrain, applyWallHeight, groundHeight, CELL, COAST_LAYOUT } from './CoastTerrain.js';

describe('TsunamiInflow', () => {
  const p = { ...DEFAULT_TSUNAMI, startDelay: 3 };

  it('시작 전에는 0', () => {
    expect(etaIn(0, p)).toBe(0);
    expect(etaIn(2.9, p)).toBe(0);
  });

  it('물 빠짐이 먼저 오고 그다음 주 파봉', () => {
    let minT = 0, minV = 0, maxT = 0, maxV = 0;
    for (let t = 0; t < inflowDuration(p); t += 0.5) {
      const v = etaIn(t, p);
      if (v < minV) { minV = v; minT = t; }
      if (v > maxV) { maxV = v; maxT = t; }
    }
    expect(minV).toBeLessThan(-0.3 * p.amplitude);
    expect(minT).toBeLessThan(maxT);
    expect(maxV).toBeGreaterThan(0.95 * p.amplitude);
    expect(maxV).toBeLessThan(1.05 * p.amplitude);
  });

  it('곡선은 끝나면 거의 0 으로 돌아옴', () => {
    expect(Math.abs(etaIn(inflowDuration(p) + 60, p))).toBeLessThan(0.05);
  });
});

describe('CoastTerrain', () => {
  it('앞바다 → 해변 → 육지로 높아짐', () => {
    expect(groundHeight(0)).toBeCloseTo(COAST_LAYOUT.seabedDepth, 5);
    expect(groundHeight(COAST_LAYOUT.shoreline)).toBeCloseTo(0, 5);
    expect(groundHeight(COAST_LAYOUT.wallStart)).toBeCloseTo(COAST_LAYOUT.groundAtWall, 5);
    expect(groundHeight(COAST_LAYOUT.lengthX)).toBeCloseTo(COAST_LAYOUT.groundInland, 5);
  });

  it('격자 크기와 건물·차수벽 셀', () => {
    const t = buildCoastTerrain({ dx: 4, wallHeight: 5 });
    expect(t.nx).toBe(320);
    expect(t.ny).toBe(160);
    expect(t.buildings.length).toBeGreaterThan(20);
    let wall = 0, bld = 0;
    for (let k = 0; k < t.type.length; k++) {
      if (t.type[k] === CELL.WALL) { wall++; expect(t.b[k]).toBeCloseTo(t.ground[k] + 5, 4); }
      if (t.type[k] === CELL.BUILDING) { bld++; expect(t.b[k]).toBeGreaterThan(t.ground[k] + 5); }
    }
    expect(wall).toBeGreaterThan(t.ny * 0.8);
    expect(bld).toBeGreaterThan(100);
  });

  it('계단 통로를 켜면 벽이 끊김', () => {
    const withGaps = buildCoastTerrain({ dx: 4, wallGaps: true });
    const noGaps = buildCoastTerrain({ dx: 4, wallGaps: false });
    expect(withGaps.wallRows.length).toBeLessThan(noGaps.wallRows.length);
  });

  it('차수벽 높이만 바꾸면 건물은 그대로', () => {
    const t = buildCoastTerrain({ dx: 4, wallHeight: 2 });
    const before = Float32Array.from(t.b);
    applyWallHeight(t, 10);
    for (let k = 0; k < t.b.length; k++) {
      if (t.type[k] === CELL.WALL) expect(t.b[k]).toBeCloseTo(t.ground[k] + 10, 4);
      else expect(t.b[k]).toBe(before[k]);
    }
  });
});
