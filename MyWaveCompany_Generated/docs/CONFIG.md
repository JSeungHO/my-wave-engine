# 설정 스키마 — waves.json

> 경로: `configs/waves.json`

파도 파라미터와 메시 설정의 단일 출처. CPU(`GerstnerWave`)와 GPU(`OceanMaterial` uniform) 모두 이 파일을 사용한다.

## 전체 구조

```json
{
  "ocean": { ... },
  "waves": [ ... ]
}
```

---

## `ocean` 객체

| 필드 | 타입 | Default | 설명 |
|------|------|---------|------|
| `meshResolutionX` | `number` | `128` | PlaneGeometry 가로 세그먼트 |
| `meshResolutionZ` | `number` | `128` | PlaneGeometry 세로 세그먼트 |
| `meshSizeX` | `number` | `200` | 메시 가로 크기 (미터) |
| `meshSizeZ` | `number` | `200` | 메시 세로 크기 (미터) |
| `buoyancyIterations` | `number` | `3` | `getWaterHeight()` 반복 보정 횟수 |

`meshResolution*`이 높을수록 GPU 변위가 정밀하지만 draw call 비용 증가.

---

## `waves` 배열

최대 **8개** (`MAX_WAVES`). 초과분은 `loadWavesConfig()`에서 잘림.

### 파도 객체

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `name` | `string` | 아니오 | 식별용 이름 |
| `direction` | `[x, z]` | 예 | 진행 방향 (자동 정규화) |
| `amplitude` | `number` | 예 | 진폭 A (미터, 파고의 절반) |
| `wavelength` | `number` | 예 | 파장 L (미터, 파봉 간 거리) |
| `speed` | `number` | 예 | 파도 속력 (m/s) |
| `steepness` | `number` | 예 | 첨예도 Q (0=사인파, 1=최대 Gerstner) |

### 파라미터 가이드

| 파라미터 | 권장 범위 | 효과 |
|----------|-----------|------|
| `amplitude` | 0.1 ~ 2.0 | 파도 높이 |
| `wavelength` | 10 ~ 200 | 파도 간격 |
| `speed` | 1 ~ 15 | 애니메이션 속도 |
| `steepness` | 0.3 ~ 0.7 | 파도 crest 날카로움 (1.0 초과 시 mesh 꼬임) |

---

## 기본값 (현재 프로젝트)

| name | direction | amplitude | wavelength | speed | steepness |
|------|-----------|-----------|------------|-------|-----------|
| Main Swell | [1.0, 0.5] | 0.8 | 80 | 8 | 0.5 |
| Cross Swell | [0.3, 1.0] | 0.4 | 40 | 5 | 0.4 |
| Ripple | [-0.5, 0.8] | 0.15 | 15 | 3 | 0.3 |

---

## 예시

```json
{
  "ocean": {
    "meshResolutionX": 64,
    "meshResolutionZ": 64,
    "meshSizeX": 100,
    "meshSizeZ": 100,
    "buoyancyIterations": 4
  },
  "waves": [
    {
      "name": "Calm",
      "direction": [1, 0],
      "amplitude": 0.3,
      "wavelength": 50,
      "speed": 4,
      "steepness": 0.4
    }
  ]
}
```

---

## 변경 반영 방법

1. `configs/waves.json` 수정
2. Vite dev server는 HMR로 자동 반영 (`demo/main.js`가 import)
3. 파도 수·파라미터 변경 시 페이지 새로고침 권장

> Phase 3에서 `dotnet run` 시 waves.json → 생성 코드 주입 예정.

---

# 설정 스키마 — scene.json (물 범위·장면)

> 경로: `Configs/scene.json`  
> **배치 기획·튜닝 가이드:** [docs/SCENE_LAYOUT.md](../../docs/SCENE_LAYOUT.md)

## 전체 구조

```json
{
  "name": "해운대 해안",
  "anchor": { "lon": 129.163, "lat": 35.159, "altM": 0 },
  "coast": { ... },
  "camera": { ... },
  "entities": { ... },
  "oceanColors": { ... }
}
```

## `anchor`

| 필드 | 타입 | 설명 |
|------|------|------|
| `lon`, `lat` | number | ENU 원점 — 해안 기준점 |
| `altM` | number | 기준 고도 (m) |

## `coast` — **물 범위** (직사각형 수면)

| 필드 | 타입 | Default | 설명 |
|------|------|---------|------|
| `offshoreM` | number | 7000 | 앵커 → **바다** 방향 수면 길이 (m) |
| `landwardM` | number | 400 | 앵커 → **육지** 방향 수면 길이 (m) |
| `alongCoastM` | number | 9000 | 해안선 **따라** 수면 폭 (m) |
| `offshoreBearingDeg` | number | 90 | 바다 방위 (0=북, 180=남) |
| `alongCoastBearingDeg` | number | 0 | 해안선 방향 |
| `resolution` | number | 128 | GPU ENU 격자 세그먼트 |

로더: `loadSceneConfig()` → `GerstnerWaterPrimitiveGPU` `buildCoastalEnuGeometry()`

## `camera` / `entities` / `oceanColors`

| 섹션 | 용도 |
|------|------|
| `camera` | 초기 Cesium 카메라 (lon, lat, heightM, headingDeg, pitchDeg) |
| `entities.ship`, `entities.buoy` | 부유체 WGS84 위치 |
| `oceanColors.deep`, `shallow` | RGBA 0~1 — GPU fragment 색 |

---

# 설정 스키마 — obstacles.json (차수벽·건물)

> 경로: `Configs/obstacles.json`  
> **위치·범위 정합:** [docs/SCENE_LAYOUT.md](../../docs/SCENE_LAYOUT.md) §5

## 전체 구조

```json
{
  "obstacles": [
    {
      "id": "barrier-1",
      "type": "flood_barrier",
      "heightM": 3.5,
      "footprint": [ [lon, lat], ... ]
    }
  ]
}
```

## 장애물 객체

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `id` | string | ✅ | 고유 ID |
| `type` | string | ✅ | `flood_barrier` \| `building` \| `custom` |
| `heightM` | number | ✅ | 장애물 높이 (m) |
| `footprint` | `[lon,lat][]` | ✅ | WGS84 폐곡선 (≥3점) → ENU AABB |

로더: `loadObstaclesConfig()` → `ObstacleField`, `ObstacleRegistry`

## footprint 편집 요령

- 앵커는 `scene.json` `anchor` 와 **동일**해야 ENU 정합
- 차수벽: 동–서 `lon` 범위 = 길이, `lat` 차 = **두께** (PoC ≥50m 권장)
- `landwardM` 은 차수벽 **육지 쪽** 수면과 함께 조정 — [SCENE_LAYOUT.md §5.3](../../docs/SCENE_LAYOUT.md)

## 변경 반영

1. `Configs/obstacles.json` 수정
2. 페이지 새로고침
3. 콘솔 `obstacle ENU boxes` 로그 확인
