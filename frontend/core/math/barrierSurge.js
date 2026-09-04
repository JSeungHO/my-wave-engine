/**
 * 차수벽 넘침 판정용 seaward(유입측) 홍수위 샘플러.
 *
 * 벽 footprint 내부는 ShallowWater wall mask 로 h=0 (dry) 이므로 벽 중심 샘플은
 * 홍수를 못 본다. 벽의 남쪽(유입측) 면 바로 앞을 벽 길이 방향으로 훑어 최대치를 쓴다.
 *
 * ponytail: 유입은 항상 ShallowWater 격자 j=0(남쪽) → seaward = -N 고정.
 *           북쪽 유입 시나리오가 생기면 방향 인자를 추가.
 *
 * @param {{ sampleHeightAt: (e: number, n: number) => number,
 *           getMaxSimHeight: () => number,
 *           blend?: number }} flood
 * @param {{ centerE: number, centerN: number, halfE: number, halfN: number }} b
 * @returns {number}  홍수위 (m, 정수위 제외)
 */
export function seawardFloodHeight(flood, b) {
  const nSea = b.centerN - b.halfN - 12; // 벽 남쪽 면 앞 ~1.5셀 — wall mask 밖
  let h = 0;
  for (let k = -4; k <= 4; k++) {
    const s = flood.sampleHeightAt(b.centerE + (k / 4) * b.halfE, nSea);
    if (s > h) h = s;
  }
  // 벽이 격자 밖이거나 샘플이 전부 dry → 도메인 최대 홍수위로 폴백 (fail-safe)
  if (h <= 0) h = flood.getMaxSimHeight() * (flood.blend ?? 1);
  return h;
}
