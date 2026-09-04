import { describe, expect, it } from 'vitest';
import { seawardFloodHeight } from './barrierSurge.js';

const BAR = { centerE: 0, centerN: 28, halfE: 600, halfN: 28 };
const flood = ({ sample = () => 0, blend = 1, max = 3 }) => ({
  sampleHeightAt: (e, n) => sample(e, n),
  getMaxSimHeight: () => max,
  blend,
});

describe('seawardFloodHeight', () => {
  it('seaward 샘플값을 그대로 반환', () => {
    expect(seawardFloodHeight(flood({ sample: () => 2.0 }), BAR)).toBeCloseTo(2.0);
  });

  it('벽 길이 방향 최대치 (중심이 dry 여도 양끝 물 반영)', () => {
    const f = flood({ sample: (e) => (Math.abs(e) > 500 ? 3.0 : 0) });
    expect(seawardFloodHeight(f, BAR)).toBeCloseTo(3.0);
  });

  it('벽 남쪽 면 앞(-N)을 샘플한다', () => {
    const seen = [];
    seawardFloodHeight({ ...flood({}), sampleHeightAt: (e, n) => { seen.push(n); return 1; } }, BAR);
    // nSea = 28 - 28 - 12 = -12
    expect(new Set(seen)).toEqual(new Set([-12]));
  });

  it('전부 dry → 도메인 최대 홍수위 폴백 (fail-safe)', () => {
    expect(seawardFloodHeight(flood({ sample: () => 0, max: 3.4 }), BAR)).toBeCloseTo(3.4);
  });

  it('폴백에도 blend 적용', () => {
    expect(seawardFloodHeight(flood({ sample: () => 0, max: 3.0, blend: 0.5 }), BAR)).toBeCloseTo(1.5);
  });
});
