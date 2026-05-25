# 장면 배치 기획 — 물 범위·차수벽 위치 설정

> **역할:** 수면(물) **범위**와 **차수벽·건물 위치**를 JSON만으로 바꿀 수 있게 하는 **기획·설정 가이드**  
> **상태:** 📋 기획 확정 (구현: Phase 4~6 일부 반영, 편집 UX·검증은 예정)  
> **관련:** [기획서.md](../기획서.md) · [CONFIG.md](../frontend/docs/CONFIG.md) · [FLOOD.md](../frontend/docs/FLOOD.md)

---

## 1. 목표

| # | 기획 목표 |
|---|-----------|
| 1 | **물 범위**를 코드 수정 없이 `scene.json`만으로 조절 |
| 2 | **차수벽·건물 위치**를 `obstacles.json`만으로 배치·이동 |
| 3 | 두 설정이 **같은 좌표계(앵커 ENU)** 를 공유해 Cesium 위성과 **정합** |
| 4 | (후속) 에디터·프리셋·검증 도구로 **기획·QA가 직접 튜닝** |

**Anti-goal:** 지도에서 드래그 UI는 Phase 6 이후 — 1차는 **JSON 편집 + 새로고침**.

---

## 2. 설정 파일 역할 분리

```
Configs/scene.json       ← 물이 깔리는 직사각형 수면 (범위·방향·격자)
Configs/obstacles.json   ← 차수벽·건물 footprint (막힘·dry zone)
Configs/waves.json       ← 파도 모양 (범위·위치와 무관)
```

| 변경하고 싶은 것 | 수정 파일 | 섹션 |
|------------------|-----------|------|
| 바다로 얼마나 멀리 / 육지로 얼마나 | `scene.json` | `coast.offshoreM`, `coast.landwardM` |
| 해안선 따라 수면 길이 | `scene.json` | `coast.alongCoastM` |
| 수면 회전 (해안 방향) | `scene.json` | `coast.alongCoastBearingDeg`, `offshoreBearingDeg` |
| 수면 메시 해상도 | `scene.json` | `coast.resolution` |
| 장면 기준점 (해안 한 점) | `scene.json` | `anchor` |
| 차수벽 위치·길이·두께 | `obstacles.json` | `footprint` (WGS84) |
| 건물 위치·크기 | `obstacles.json` | `footprint` |
| 차수벽 높이 (overflow 연출용) | `obstacles.json` | `heightM` |

---

## 3. 좌표계 (반드시 공통 이해)

### 3.1 앵커 (Anchor)

`scene.json` → `anchor.lon`, `anchor.lat` = **해안 기준점** (ENU 원점).

해운대 기본값: `129.163, 35.159`

### 3.2 ENU 로컬 (East–North–Up)

```
  North (+)  = 위도 증가 방향 ≈ 내륙(북)
  East  (+)  = 경도 증가 방향 ≈ 동
  Up    (+)  = 고도
```

모든 `obstacles.json` footprint는 WGS84 `[lon, lat]` 이지만, **내부적으로 앵커 기준 ENU(m)** 로 변환해 GPU·CPU가 사용한다.

### 3.3 해안 정렬 축 (scene.json `coast`)

```
                    alongCoast (+)
                         ↑
    landward (−seaM) ←── anchor ──→ offshore (+seaM, 바다)
         (육지)              │
                             ↓
                    alongCoast (−)
```

| 축 | 필드 | 해운대 기본 | 의미 |
|----|------|-------------|------|
| **바다 방향** | `offshoreBearingDeg: 180` | 남 | `offshoreM` 만큼 **남쪽**으로 수면 |
| **육지 방향** | (반대) | 북 | `landwardM` 만큼 **북쪽**으로 수면 |
| **해안선 방향** | `alongCoastBearingDeg: 90` | 동 | `alongCoastM` 의 중심선이 **동–서** |

**seaM = 0** → 앵커 = **해안선 위 한 점** (수면 직사각형의 “육지↔바다” 경계).

---

## 4. 물 범위 — `scene.json` → `coast`

### 4.1 필드 정의

| 필드 | 타입 | Default | 설명 |
|------|------|---------|------|
| `offshoreM` | number | 7000 | 앵커에서 **바다 쪽** 수면 연장 (m) |
| `landwardM` | number | 400 | 앵커에서 **육지 쪽** 수면 연장 (m) |
| `alongCoastM` | number | 9000 | 해안선 **따라** 수면 폭 (m), 앵커 중심 대칭 |
| `offshoreBearingDeg` | number | 90 | 바다 방위 (0=북, 90=동, **180=남**) |
| `alongCoastBearingDeg` | number | 0 | 해안선 방향 (수면 **긴 변** 방향) |
| `resolution` | number | 128 | ENU 격자 한 변 세그먼트 (GPU 메시 밀도) |

**총 수면 크기 (근사):** `(landwardM + offshoreM) × alongCoastM` 직사각형.

### 4.2 해운대 현재값 (참고)

```json
"coast": {
  "alongCoastBearingDeg": 90,
  "offshoreBearingDeg": 180,
  "offshoreM": 5500,
  "landwardM": 380,
  "alongCoastM": 6500,
  "resolution": 160
}
```

→ 해안(anchor)에서 **남 5.5km**, **북 380m**, **동–서 6.5km** 파란 수면.

### 4.3 자주 쓰는 튜닝 시나리오

| 시나리오 | 변경 | 효과 |
|----------|------|------|
| **데모 축소** | `offshoreM: 800`, `landwardM: 120`, `alongCoastM: 1200` | 작은 수면, 성능·막힘 확인 쉬움 |
| **육지 침수만** | `landwardM: 600`, `offshoreM: 200` | 바다 대신 **내륙 침수** 연출 |
| **넓은 바다** | `offshoreM: 8000` | 멀리 파도 패턴 |
| **차수벽 뒤 dry** (기획) | `landwardM` ≤ 차수벽까지 거리 | 벽 **북쪽**에 수면 메시 자체를 안 깔기 (Phase 4+ clip) |
| **카메라만** | `camera.*` | 범위와 무관, 확인용 |

### 4.4 제약·권장

| 항목 | 권장 |
|------|------|
| `resolution` | 64~256. 높을수록 GPU 부하 ↑, edge foam 정밀 ↑ |
| `landwardM` | 차수벽이 **육지 쪽**이면, `landwardM`은 **벽 위치 이하**로 (§5.3) |
| `alongCoastM` | 차수벽 `footprint` 동–서 길이와 **같거나 더 길게** |
| 앵커 이동 | `anchor` + `obstacles` footprint **함께** 옮기거나 ENU 재계산 |

---

## 5. 차수벽·건물 — `obstacles.json`

### 5.1 스키마 (현재)

```json
{
  "obstacles": [
    {
      "id": "barrier-1",
      "type": "flood_barrier",
      "heightM": 3.5,
      "footprint": [
        [129.14982, 35.15976],
        [129.17618, 35.15976],
        [129.17618, 35.16003],
        [129.14982, 35.16003]
      ]
    }
  ]
}
```

| 필드 | 필수 | 설명 |
|------|------|------|
| `id` | ✅ | 고유 ID (라벨·로그) |
| `type` | ✅ | `flood_barrier` \| `building` \| `custom` |
| `heightM` | ✅ | 장애물 높이 (m) — Cesium 박스·overflow |
| `footprint` | ✅ | WGS84 `[lon, lat][]` **폐곡선** (≥3점). **시계/반시계 통일** (구현: AABB로 근사) |

### 5.2 footprint ↔ ENU 변환 (기획 규약)

앵커 `(anchorLon, anchorLat)` 기준:

```
eastM  = (lon - anchorLon) × 111320 × cos(anchorLat)
northM = (lat - anchorLat) × 111320
```

**차수벽을 옮기는 실무:**

1. Cesium에서 목표 위치 **lon/lat** 확인 (개발자 도구 / 우클릭 좌표)
2. `footprint` 4꼭짓점을 **동–서 직선 벽**이면:  
   - 같은 `lat` (또는 좁은 lat 범위) = 벽 **두께**  
   - `lon` min/max = 벽 **길이**
3. 저장 → dev server 새로고침

### 5.3 차수벽 ↔ 물 범위 정합 (기획 규칙)

차수벽이 “막힌다”고 **보이려면** 아래를 함께 맞춘다.

```
  [ 육지 / dry ]  |  차수벽  |  [ 물 / wet ]
       ↑              ↑            ↑
  landwardM      footprint      offshoreM
  (수면 없음)     (장애물)      (수면 있음)
```

| 규칙 | 설명 |
|------|------|
| **R1** | 차수벽은 **seaM ≈ 0 근처**(해안선) 또는 **육지 쪽 가장자리**에 둔다 |
| **R2** | `footprint` **남쪽 면** = 바다 쪽 (해운대: lat **작은** 쪽 = 남) |
| **R3** | 벽 **북쪽(landward)** 은 `landwardM` 밖이거나, Phase 4+ **landward clip** 으로 수면 제거 |
| **R4** | 벽 **동–서 길이** ≤ `alongCoastM` (수면 밖으로 나가면 clip 안 됨) |
| **R5** | PoC용 **두께** ≥ 50m 권장 (현재 25m는 [VERIFY_PHASE4.md](./VERIFY_PHASE4.md) — 잘 안 보임) |

### 5.4 해운대 `barrier-1` (현재)

| 항목 | 값 |
|------|-----|
| 위치 | anchor 기준 **북 ~85m** (내륙) |
| 크기 | 동–서 ~2.4km × 남–북 ~25m |
| 문제 | 벽 **뒤(북)** 에도 `landwardM: 380` 수면 → “막힘” UX 깨짐 |

**기획 권장 수정 (예시):**

- **A.** 벽을 **해안선(seaM≈0)** 으로 이동 — lat ≈ `35.159`  
- **B.** `landwardM: 80` 으로 줄여 벽 **북쪽** 수면 제거  
- **C.** footprint lat 두께 **0.0005° (~55m)** 이상

### 5.5 건물 배치

동일 스키마. `type: "building"`, `heightM` 10~30.

- footprint는 **수면 mesh 안** (`landwardM` / `offshoreM` / `alongCoastM` 범위)  
- Phase 5 이후: 건물 **사이** gap = 물이 **갈라지는** 통로

---

## 6. 프리셋 (복사해서 사용)

### 6.1 `presets/demo-narrow` — 막힘 확인용 작은 장면

**scene.json `coast`:**

```json
"coast": {
  "alongCoastBearingDeg": 90,
  "offshoreBearingDeg": 180,
  "offshoreM": 600,
  "landwardM": 80,
  "alongCoastM": 1400,
  "resolution": 96
}
```

**obstacles.json `barrier-1` footprint (앵커 동일 가정):**

```json
"footprint": [
  [129.156, 35.1590],
  [129.170, 35.1590],
  [129.170, 35.1595],
  [129.156, 35.1595]
]
```

→ 해안선(lat≈35.159)에 **얇은 동–서 벽**, 육지 80m만 수면, 바다 600m.

### 6.2 `presets/haeundae-wide` — 현재 프로덕션에 가까움

`Configs/scene.json`, `Configs/obstacles.json` **그대로** (§4.2, §5.4).

### 6.3 `presets/inland-flood` — 내륙 침수

```json
"coast": {
  "offshoreBearingDeg": 180,
  "offshoreM": 150,
  "landwardM": 500,
  "alongCoastM": 2000,
  "alongCoastBearingDeg": 90,
  "resolution": 128
}
```

→ 앵커 **북쪽** 넓은 수면, 남쪽은 짧은 “배수” 구역.

---

## 7. 편집 워크플로 (기획·QA)

**런타임 UI (구현됨):** Cesium 메인 화면 **우측 「장면 설정」 패널**

| 기능 | 조작 |
|------|------|
| 차수벽 배치 | 「+ 클릭 위치에 차수벽」→ 지도 클릭 |
| 차수벽 편집 | #번호별 동(E)·북(N)·길이·두께·높이 |
| 물 범위 | offshore / landward / along 슬라이더 |
| 물 높이 | 파고 슬라이더 + 정수위 |
| 넘침 확인 | 수면합 &gt; 벽 높이 → ⚠ 표시·벽 빨간색 |
| 저장 | 「설정 JSON 내보내기」 |

```
1. scene.json 수정 (물 범위)
2. obstacles.json 수정 (벽·건물)
3. dotnet run -- serve  또는  npm run dev
4. 브라우저 새로고침
5. 오버레이: 장면 이름, 장애물 개수, GPU 2b 확인
6. 콘솔: obstacle ENU boxes 로그 (centerE/N, halfE/N)
7. 카메라: 벽 근처 15~30m — [VERIFY_PHASE4.md](./VERIFY_PHASE4.md)
```

| URL 파라미터 | 용도 |
|--------------|------|
| `?material=1` | GPU 마스크 off — 수면·범위만 확인 |
| `?debugObstacles=1` | 📋 예정 — dry=빨강, wet=파랑 |
| `?preset=demo-narrow` | 📋 예정 — §6.1 JSON 스왑 |

---

## 8. 향후 확장 (기획 backlog)

### 8.1 설정 표현 방식

| 단계 | 방식 | 장점 |
|------|------|------|
| **현재** | WGS84 `footprint` | Cesium 위성과 직접 대조 |
| Phase 4b | **ENU 상대 좌표** (앵커 기준 m) | 기획자가 미터 단위로 직관적 편집 |
| Phase 6 | **GeoJSON** import | GIS·실측 데이터 |
| Phase 6 | **Polyline 차수벽** `centerline + widthM` | 해안선 따라 곡선 벽 |

**ENU 모드 스키마 (안):**

```json
{
  "id": "barrier-1",
  "type": "flood_barrier",
  "heightM": 3.5,
  "placement": "enu",
  "centerE": -200,
  "centerN": 50,
  "halfE": 1200,
  "halfN": 40
}
```

`placement: "wgs84"` (기본) vs `"enu"` — `loadObstaclesConfig()` 에서 통합.

### 8.2 물 범위 고급

| 기능 | 파일 | 설명 |
|------|------|------|
| **해안선 polygon clip** | `scene.json` + GeoJSON | 직사각형 탈피 (Phase 6) |
| **landwardClipM** | `scene.json` | 앵커 북쪽 N m 이상 수면 금지 |
| **waterLevelM** | `scene.json` | 기준 수위 (Phase 5 flood와 합성) |
| **presets/** | `Configs/presets/*.json` | 원클릭 장면 전환 |

### 8.3 에디터 UX (Phase 6+)

| 기능 | 설명 |
|------|------|
| Cesium 클릭 → footprint 꼭짓점 | WGS84 자동 기입 |
| Gizmo 드래그 | ENU 실시간, JSON export |
| “벽을 해안선에 스냅” | `seaM=0` 투영 |
| 미리보기 wireframe | 수면·AABB 동시 표시 |

---

## 9. 검증 체크리스트

배치 변경 후 QA:

- [ ] 수면 직사각형이 **위성 해안**과 대략 일치 (rotation 확인)
- [ ] 차수벽 Entity 라벨이 **footprint 중심** 근처
- [ ] 콘솔 ENU box가 footprint와 **같은 대략 위치**
- [ ] `offshoreM`/`landwardM` 변경 시 **메시 크기** 변화 (스모크)
- [ ] 장애물이 수면 **밖**이면 마스크 **적용 안 됨** — 범위 재조정
- [ ] [VERIFY_PHASE4.md](./VERIFY_PHASE4.md) — 막힘 UX (landward clip 포함 시)

---

## 10. 구현 DoD (이 기획 문서 기준)

| # | 항목 | 상태 |
|---|------|------|
| L1 | `scene.json` `coast` 로 물 범위 변경 | ✅ |
| L2 | `obstacles.json` `footprint` 로 벽·건물 이동 | ✅ |
| L3 | CONFIG.md에 스키마 문서화 | 📋 본 문서 + CONFIG §scene/obstacles |
| L4 | `landwardM` ↔ 차수벽 정합 가이드 | ✅ (§5.3) |
| L5 | ENU placement 모드 | 📋 §8.1 |
| L6 | preset / debug URL | 📋 §7, §8 |
| L7 | landward 자동 clip (벽 북쪽 수면 제거) | 📋 ROADMAP Phase 4 |

---

## 11. 코드·파일 매핑

| JSON 필드 | 로더 | 소비 |
|-----------|------|------|
| `scene.coast.*` | `loadSceneConfig()` | `buildCoastalEnuGeometry()`, Material bounds |
| `scene.anchor` | `loadSceneConfig()` | ENU 원점, obstacles 변환 |
| `obstacles[].footprint` | `loadObstaclesConfig()` | `ObstacleField`, `ObstacleRegistry` |
| `obstacles[].heightM` |同上| Cesium BoxGraphics 높이 |

**핵심 파일:**

- `frontend/Configs/scene.json`
- `frontend/Configs/obstacles.json`
- `frontend/core/types/SceneTypes.js`
- `frontend/core/types/ObstacleTypes.js`
- `frontend/adapters/cesium/GerstnerWaterPrimitiveGPU.js`

---

*최종 갱신: 2026-05-25 — 물 범위·차수벽 위치 설정 기획 추가. 구현 변경 시 [CONFIG.md](../frontend/docs/CONFIG.md), [FLOOD.md](../frontend/docs/FLOOD.md), [진행상태.md](../진행상태.md) 동기화.*
