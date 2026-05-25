# Flood / Obstacle — 기술 기획 (Phase 4~6)

> **상태:** §1 완료 · §2 구현 완료 · §3~4 예정  
> **로드맵:** [ROADMAP.md](../../ROADMAP.md)  
> **기획:** [기획서.md](../../기획서.md)

---

## §1 Phase 4 — 장애물 마스크 PoC ✅ 완료

> **배치·범위 편집:** [SCENE_LAYOUT.md](../../docs/SCENE_LAYOUT.md) — `scene.json` 물 범위, `obstacles.json` 차수벽 위치

### 목적
차수벽·건물 **뒤는 dry**, **앞 가장자리**만 물·거품.

### 구현 파일

| 파일 | 역할 |
|------|------|
| `Configs/obstacles.json` | 차수벽·건물 footprint (WGS84) |
| `core/types/ObstacleTypes.js` | 파싱, `obstacleBodiesToBoxes`, ENU 변환 |
| `core/math/ObstacleField.js` | AABB SDF, `isDry()`, `buildGlsl()` |
| `adapters/cesium/ObstacleRegistry.js` | Cesium Entity 시각화 |
| `GerstnerWaterPrimitiveGPU.js` | fragment dry mask, edge foam, landward clip |

---

## §2 Phase 5 — 2D Shallow Water ✅ 구현 완료 (2026-05-26)

### 목적
**h, u, v** 격자로 홍수가 밀려오고, 장애물에서 **분기·정체**.

### 물리 모델 (Diffusive-Advective Wave)

```
∂h/∂t = -v_N · ∂h/∂N + D · ∇²h
```

| 파라미터 | 값 | 설명 |
|----------|-----|------|
| v_N | sqrt(g · baseHeightM) ≈ 3.84 m/s | 북향 이류 (파동 전파) |
| D | 80 m²/s | 측면 확산 (건물 우회) |
| dt | CFL 제한 ≤ 0.18s | 안정성 |

**경계 조건:**

| 경계 | 조건 |
|------|------|
| 남쪽 (j=0) | Dirichlet: h = inflowH (유입) |
| 북쪽 (j=ny-1) | Dirichlet: h = 0 (유출) |
| 동·서 | Neumann: flux = 0 (반사) |
| 장애물·벽 | Neumann: no-flow (h_neighbor = h_cell) |

### 구현 파일

| 파일 | 역할 |
|------|------|
| `Configs/flood.json` | 격자·유입·혼합 설정 |
| `core/types/FloodTypes.js` | `loadFloodConfig()` |
| `core/math/ShallowWater.js` | CPU 시뮬레이션 엔진 |
| `adapters/cesium/FloodLayer.js` | CPU→GPU 텍스처 어댑터 |

### `flood.json` 스키마

```json
{
  "grid": {
    "cellSizeM": 8,
    "widthM":    1400,
    "depthM":    680,
    "originE":   -700,
    "originN":   -600
  },
  "inflow": {
    "bearingDeg":   180,
    "rateM3PerSec": 120,
    "baseHeightM":  1.5
  },
  "gerstnerBlend": 0.35,
  "speedFactor":   6.0,
  "maxHeightM":    3.5
}
```

### GPU 연동 (CPU → Vertex Shader, GLSL bake 방식)

> **v2 변경:** 이전 texture/uniform 방식은 DrawCommand 재생성 시 uniform 미주입 →
> `TypeError → renderError → ?material=1 redirect` 버그가 있었습니다.
> v2 에서는 **GLSL 리터럴 bake** 방식으로 교체하여 uniform 선언 없이 flood 를 표현합니다.

```
CPU ShallowWater → sw.getFloodFront(threshold)
  → 홍수 전선 ENU North (m)
  → ocean.updateFloodFront(frontN, maxH × blend)  [60 프레임마다]
    → buildVertexShader(..., frontN, effectiveMaxH)
      → smoothstep 상수 GLSL bake → VS 재빌드
      → 새 DrawCommand: uniform 선언 없음 → crash 없음
```

**Vertex Shader baked 코드 (예시):**

```glsl
/* ── Phase 5: flood front (리터럴 bake — uniform 없음) ── */
{
  float _frontN = -320.00;   /* 현재 전선 위치 (60 프레임마다 갱신) */
  float _maxH   = 3.5000;
  float _fH = _maxH * (1.0 - smoothstep(_frontN, _frontN + 200.0, xN));
  dispU += max(0.0, _fH);
}
```

* `xN < _frontN` → 1 − smoothstep(…) = 1 → 침수 (dispU += maxH)
* `xN > _frontN + 200` → 1 − smoothstep(…) = 0 → 건조
* 200 m 전환 구간으로 부드러운 전선 표현

### 합성 규칙

```
GPU dispU = gerstner_disp + flood_h × blend
```

### UI 컨트롤

| 요소 | 역할 |
|------|------|
| `btnFloodStart` | 시뮬레이션 시작/일시정지 |
| `btnFloodReset` | 초기화 (h=0) |
| `floodRateSlider` | 유입 수위 (0.2~3.5 m) |
| `floodBlendSlider` | Gerstner 혼합 비율 (0~1) |

### 성능

| 항목 | 값 |
|------|-----|
| 격자 | 175×85 = 14,875 셀 |
| 텍스처 | 175×85 RGBA Uint8 ≈ 58 KB |
| CPU per frame | < 1 ms (Float32Array 루프) |
| GPU upload | canvas.putImageData + copyFrom |

---

## §3 Phase 6 — 실경 연동 (예정)

### 해안선 clip

- GeoJSON coastline → ENU polygon → triangulated mesh (not axis-aligned rectangle)
- 참고: `buildCoastalEnuGeometry`, `SceneTypes.coastalBoundsToDegrees`

### 건물 footprint

| 방안 | 장단 |
|------|------|
| A. 수동 GeoJSON | 빠름, Phase 4~5와 동일 |
| B. Cesium 3D Tiles | 실경, 추출 복잡 |

### 차수벽 polyline

- `type: "flood_barrier_polyline"` + `widthM` + centerline coords

---

## §4 Phase 7 — Overflow (선택)

- 차수벽 `heightM` < flood.h → crest overflow particle / extra foam
- `overflowThresholdM` in `obstacles.json`

---

*구현 시작 시 이 문서를 [CONFIG.md](./CONFIG.md) 및 [API.md](./API.md)와 동기화한다.*
