/**
 * CoastTerrain.js — 쓰나미 계산용 해안 지형 격자 생성
 *
 * 앞바다(x=0) → 해저 경사 → 해변 → 차수벽 → 해안도로 → 도시(건물) 순서.
 * 해운대처럼 해변 바로 뒤에 고층 건물이 늘어선 모양을 단순화했다.
 *
 * 좌표: x = 앞바다→육지 (m), z = 해안선 방향 (m). 셀 (i, j) 중심 = ((i+0.5)dx, (j+0.5)dx)
 *
 * 출력 격자 (모두 nx*ny, 인덱스 j*nx + i)
 *   b      : 바닥 높이 (m). 건물·차수벽은 그 꼭대기 높이 → 계산기에서 물이 못 들어가는 벽
 *   ground : 건물·벽을 뺀 땅 높이 (렌더링용)
 *   type   : CELL 종류 (아래 CELL)
 *   n      : Manning 조도계수 (마찰)
 *
 * ## 설계 원칙
 * * `core/` 규칙 — Cesium·Three.js import 금지
 *
 * @module core/math/CoastTerrain
 */

export const CELL = Object.freeze({
  SEABED: 0, BEACH: 1, WALL: 2, PROMENADE: 3, ROAD: 4, SIDEWALK: 5, PLAZA: 6, BUILDING: 7, STREET: 8,
});

/** 장면 치수 (m). x' = x - shoreOffset(z) 기준 */
export const COAST_LAYOUT = Object.freeze({
  lengthX: 1280,
  lengthZ: 640,
  seabedDepth: -24,   // 앞바다 수심
  shelfEnd: 600,      // 완만한 대륙붕 끝 (수심 -6 m)
  shoreline: 760,     // 해수면(0 m)과 만나는 지점
  beachTop: 815,      // 해변 끝 (2.6 m)
  wallStart: 815,     // 차수벽 (두께 4 m)
  wallEnd: 819,
  promenadeEnd: 830,
  roadEnd: 852,
  sidewalkEnd: 858,
  cityStart: 862,
  groundAtWall: 3.0,  // 차수벽 바닥 높이
  groundInland: 6.0,  // 내륙 끝 땅 높이
});

/** 해안선 굴곡 (m). GLSL 에도 같은 식이 있다 (SHORE_OFFSET_GLSL) */
export function shoreOffset(z) {
  return 25 * Math.sin((2 * Math.PI * z) / 900) + 10 * Math.sin((2 * Math.PI * z) / 310 + 1.0);
}

/** 결정론 난수 (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 건물·벽을 뺀 땅 높이 (x' 기준) */
export function groundHeight(xp) {
  const L = COAST_LAYOUT;
  if (xp < L.shelfEnd) return L.seabedDepth + (L.seabedDepth * -1 - 6) * (xp / L.shelfEnd);
  if (xp < L.shoreline) return -6 + 6 * ((xp - L.shelfEnd) / (L.shoreline - L.shelfEnd));
  if (xp < L.beachTop) return 2.6 * ((xp - L.shoreline) / (L.beachTop - L.shoreline));
  const t = Math.min(1, Math.max(0, (xp - L.wallStart) / (L.lengthX - L.wallStart)));
  return L.groundAtWall + (L.groundInland - L.groundAtWall) * t;
}

/**
 * @param {object} opt
 * @param {number} [opt.dx=2]          셀 크기 (m)
 * @param {number} [opt.wallHeight=4]  차수벽 높이 (땅 위, m). 0 이면 벽 없음
 * @param {boolean} [opt.wallGaps=true] 해변 계단 통로 (벽이 끊긴 곳) 2개
 * @param {number} [opt.seed=7]
 */
export function buildCoastTerrain({ dx = 2, wallHeight = 4, wallGaps = true, seed = 7 } = {}) {
  const L = COAST_LAYOUT;
  const nx = Math.round(L.lengthX / dx);
  const ny = Math.round(L.lengthZ / dx);
  const N = nx * ny;
  const b = new Float32Array(N);
  const ground = new Float32Array(N);
  const type = new Uint8Array(N);
  const n = new Float32Array(N);

  const gaps = wallGaps ? [L.lengthZ * 0.32, L.lengthZ * 0.71] : [];
  const gapHalf = 8;
  const inGap = (z) => gaps.some((g) => Math.abs(z - g) < gapHalf);

  // 1) 기본 지형
  for (let j = 0; j < ny; j++) {
    const z = (j + 0.5) * dx;
    const off = shoreOffset(z);
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * dx;
      const xp = x - off;
      const k = j * nx + i;
      const g = groundHeight(xp);
      ground[k] = g;
      b[k] = g;
      let t = CELL.SEABED;
      if (xp >= L.shoreline - 30 && xp < L.wallStart) t = CELL.BEACH;
      else if (xp >= L.wallStart && xp < L.wallEnd) t = inGap(z) ? CELL.PROMENADE : CELL.WALL;
      else if (xp >= L.wallEnd && xp < L.promenadeEnd) t = CELL.PROMENADE;
      else if (xp >= L.promenadeEnd && xp < L.roadEnd) t = CELL.ROAD;
      else if (xp >= L.roadEnd && xp < L.sidewalkEnd) t = CELL.SIDEWALK;
      else if (xp >= L.sidewalkEnd) t = CELL.PLAZA;
      type[k] = t;
      n[k] = t === CELL.SEABED ? 0.022 : t === CELL.BEACH ? 0.028 : 0.018;
      if (t === CELL.WALL && wallHeight > 0) b[k] = g + wallHeight;
    }
  }

  // 2) 도시 블록 — 해안선과 나란한 직선 격자 (월드 x 기준)
  const rand = rng(seed);
  const buildings = [];
  const blockX = 58, blockZ = 74, street = 14;
  const maxOff = 36;
  const city0 = L.cityStart + maxOff;
  for (let bx = city0; bx + blockX < L.lengthX - 6; bx += blockX + street) {
    const row = Math.round((bx - city0) / (blockX + street)); // 0 = 해안 첫 줄
    for (let bz = 6; bz + blockZ < L.lengthZ - 6; bz += blockZ + street) {
      // 블록을 1~3 x 1~3 로 나눔
      const sx = 1 + Math.floor(rand() * 2);
      const sz = 1 + Math.floor(rand() * 3);
      const cw = blockX / sx, cd = blockZ / sz;
      for (let a = 0; a < sx; a++) {
        for (let c = 0; c < sz; c++) {
          if (rand() < 0.12) continue; // 공터·주차장
          const inset = 3 + rand() * 3;
          const x0 = bx + a * cw + inset, x1 = bx + (a + 1) * cw - inset;
          const z0 = bz + c * cd + inset, z1 = bz + (c + 1) * cd - inset;
          if (x1 - x0 < 8 || z1 - z0 < 8) continue;
          const tall = row === 0 ? 45 + rand() * 75 : row === 1 ? 20 + rand() * 45 : 10 + rand() * 30;
          buildings.push({ x0, x1, z0, z1, h: tall, hue: rand() });
        }
      }
    }
  }

  // 블록 사이 도로
  for (let j = 0; j < ny; j++) {
    const z = (j + 0.5) * dx;
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * dx;
      const k = j * nx + i;
      if (type[k] !== CELL.PLAZA || x < city0 - 4) continue;
      const lx = (x - city0) % (blockX + street);
      const lz = (z - 6) % (blockZ + street);
      if (lx > blockX || lz > blockZ || z < 6) type[k] = CELL.STREET;
    }
  }

  // 건물 셀 표시 + 건물 바닥 높이 기록
  for (const bd of buildings) {
    const i0 = Math.max(0, Math.floor(bd.x0 / dx)), i1 = Math.min(nx - 1, Math.ceil(bd.x1 / dx) - 1);
    const j0 = Math.max(0, Math.floor(bd.z0 / dx)), j1 = Math.min(ny - 1, Math.ceil(bd.z1 / dx) - 1);
    let gmin = Infinity;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) gmin = Math.min(gmin, ground[j * nx + i]);
    bd.ground = gmin;
    bd.x0 = i0 * dx; bd.x1 = (i1 + 1) * dx; bd.z0 = j0 * dx; bd.z1 = (j1 + 1) * dx;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        type[k] = CELL.BUILDING;
        b[k] = gmin + bd.h;
      }
    }
  }

  // 차수벽 조각 (렌더링용): 행(j)마다 벽 셀 범위
  const wallRows = [];
  for (let j = 0; j < ny; j++) {
    let i0 = -1, i1 = -1;
    for (let i = 0; i < nx; i++) {
      if (type[j * nx + i] === CELL.WALL) { if (i0 < 0) i0 = i; i1 = i; }
    }
    if (i0 >= 0) wallRows.push({ j, i0, i1, ground: ground[j * nx + i0] });
  }

  return { nx, ny, dx, b, ground, type, n, buildings, wallRows, wallHeight, gaps };
}

/** 차수벽 높이만 바꿔 b 를 다시 계산 (건물·지형은 그대로) */
export function applyWallHeight(terrain, wallHeight) {
  const { b, ground, type } = terrain;
  for (let k = 0; k < b.length; k++) {
    if (type[k] === CELL.WALL) b[k] = ground[k] + Math.max(0, wallHeight);
  }
  terrain.wallHeight = wallHeight;
  return terrain;
}
