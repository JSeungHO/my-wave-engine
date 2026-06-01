# MyAutomationEngine

**Cesium 위 해운대 해안에서 Gerstner 파도·2D 홍수·차수벽을 실시간으로 시뮬레이션하는 WebGL 프로젝트**

`backend/` — .NET CLI (sync, serve, build) · `frontend/` — Vite + Cesium + Three.js 데모

---

## 스크린샷

### 해운대 해안 — Gerstner GPU 3D + 차수벽 + 장면 설정

![해운대 해안 Gerstner 수면, 차수벽 3개, 장면 설정 패널](docs/screenshots/haeundae-ocean.png)

*위성 지도와 블렌드된 청록색 3D 수면 · 클릭 배치 차수벽(#1~#3) · 파고/surge 분리 · 우측 장면 설정 패널*

| 화면 요소 | 설명 |
|-----------|------|
| **좌상단 오버레이** | 파고(ripple) · surge(정수위+홍수) · 차수벽 넘침 여부 · 홍수 상태 |
| **3D 수면** | GPU Gerstner 변위 + CPU 2D 홍수 높이 필드(`a_floodH`) 합성 |
| **차수벽** | 클릭 배치 · 벽 높이 vs surge 넘침 판정 · 양끝 미보호 구간 |
| **장면 설정** | 물 범위(offshore/landward/해안선) · 파고 · 정수위 · JSON 내보내기 |

### Phase 5 — 2D Shallow Water 홍수

![2D 홍수 시뮬레이션](docs/screenshots/flood-simulation.png)

*바다 쪽 유입 → 건물·차수벽 우회 → CPU 2D 격자 결과를 GPU 정점 높이로 반영*

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| **Gerstner GPU 3D** | ENU 격자 + 버텍스 셰이더 실제 파고 변위 (`GerstnerWaterPrimitiveGPU`) |
| **위성 톤 블렌드** | `scene.json` `oceanColors` — 청록·저투명도, 격자 가장자리 fade |
| **해안 정렬** | 해운대 앵커, offshore/landward 수면 범위 (물 범위 ≠ 벽 길이) |
| **차수벽·건물** | 클릭 배치, AABB 마스크, **높이 기반** shield(일자 clip 없음), 양끝 넘침 |
| **장면 에디터** | 물 범위·파고(시각)·정수위(surge)·차수벽 #별 크기/위치/높이, JSON 내보내기 |
| **빠른 이동** | 해운대 장면/광역, 강남역(GeoHazard) 카메라 프리셋 |
| **넘침 판정** | 파고와 분리 — `surge = 정수위 + 홍수` vs 벽 높이 |
| **2D 홍수 (Phase 5)** | Shallow Water 격자, 유입·재생, 2D 높이 필드 → GPU |
| **Three.js PoC** | `/shore.html` — 로컬 xz 데모 |

---

## 빠른 시작

### 요구 사항

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js 20+](https://nodejs.org/) (Vite dev server)
- (선택) [Cesium ion](https://ion.cesium.com/) 토큰 — `.env` 에 `VITE_CESIUM_ION_TOKEN`

### 실행

```bash
git clone <repository-url>
cd MyAutomationEngine

# frontend/ 스캐폴드 동기화 (최초 1회)
dotnet run -- sync

# 개발 서버 (npm install 자동)
dotnet run -- serve
```

터미널에 표시된 **Local URL** 을 브라우저에서 엽니다 (예: `http://localhost:5173/`).

| URL | 내용 |
|-----|------|
| `/` | Cesium 메인 — Gerstner + 차수벽 + 홍수 |
| `/shore.html` | Three.js 해변 데모 |
| `/?material=1` | Material 2a 평면 모드 (GPU 디버그) |
| `/?debugObstacles=1` | 장애물 shield/넘침 색상 오버레이 |

### 수동 실행 (npm만)

```bash
cd frontend
npm install
npm run dev
```

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| **backend/** | .NET 10 CLI — sync, serve, build, doctor |
| **frontend/** | Vite 5, CesiumJS 1.122, Three.js 0.169 |
| 파도 | Gerstner (GPU Gems Ch.1) — CPU + GLSL |
| 홍수 | 2D Shallow Water (CPU) → 정점 `a_floodH` (GPU) |
| 설정 | JSON (`frontend/Configs/*.json`) |

---

## 프로젝트 구조

```
MyAutomationEngine/
├── MyAutomationEngine.csproj  # 루트에서 dotnet run
├── backend/                   # .NET CLI · Templates
│   ├── Commands/              # sync, serve, build, clean …
│   ├── Templates/             # 코드 생성 템플릿
│   └── Program.cs
├── frontend/                  # WebGL 데모 (구 MyWaveCompany_Generated)
│   ├── Configs/               # waves, scene, obstacles, flood …
│   ├── core/                  # GerstnerWave, ShallowWater, ObstacleField …
│   ├── adapters/              # cesium/, three/
│   ├── src/adapters/cesium/   # ★ Cesium 진입점 (cesium-main.js)
│   └── index.html
├── docs/                      # 로드맵 · 기획 · 스크린샷
├── 기획서.md
└── 진행상태.md
```

**Cesium 진입점:** `frontend/src/adapters/cesium/cesium-main.js`

---

## 설정 파일

| 파일 | 역할 |
|------|------|
| `frontend/Configs/waves.json` | Gerstner 8파도 — 진폭·파장·방향 |
| `frontend/Configs/scene.json` | 해운대 앵커, 수면 범위, 카메라, **`oceanColors`** |
| `frontend/Configs/obstacles.json` | 차수벽·건물 footprint |
| `frontend/Configs/flood.json` | 2D 홍수 격자·유입·속도 |
| `frontend/Configs/interaction.json` | Wake, collision |

우측 **「장면 설정」** 패널에서 런타임 조정 후 **설정 JSON 내보내기** 가능.  
상세: [docs/SCENE_LAYOUT.md](./docs/SCENE_LAYOUT.md)

### 물색 조정 (`frontend/Configs/scene.json`)

```json
"oceanColors": {
  "deep":    [0.05, 0.13, 0.16, 0.58],
  "shallow": [0.10, 0.28, 0.30, 0.52]
}
```

RGBA 마지막 값(alpha)을 낮추면 위성 지도가 더 비칩니다.

---

## 아키텍처 (요약)

```
Layer 3  GPU 시각     — 거품, edge foam, barrier shield, 넘침 색
Layer 2  CPU 2D 홍수  — ShallowWater → FloodLayer → a_floodH
Layer 1  Gerstner     — swell + chop (GPU 버텍스, 파고 배율)
Layer 0  Cesium       — 위성·지형·Entity 장애물
```

**surge vs 파고:** 파고 슬라이더는 ripple(시각)만 키우고, 넘침 판정은 `정수위 + 홍수` surge 기준입니다.

---

## 문서

| 문서 | 설명 |
|------|------|
| [기획서.md](./기획서.md) | 제품 목표, 성공 기준 |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | Phase별 로드맵 |
| [docs/DOC_GUIDE.md](./docs/DOC_GUIDE.md) | 구현 시 읽는 순서 |
| [진행상태.md](./진행상태.md) | 완료/미완 스냅샷 |
| [docs/SCENE_LAYOUT.md](./docs/SCENE_LAYOUT.md) | 물·차수벽 배치 |
| [docs/PROJECT_LAYOUT.md](./docs/PROJECT_LAYOUT.md) | frontend/backend 폴더 구조 |
| [frontend/docs/](./frontend/docs/) | API, CONFIG, SHADER |

---

## 개발 상태 (2026-05)

| Phase | 내용 | 상태 |
|-------|------|------|
| 1~2c | Gerstner + Cesium GPU 3D | ✅ |
| 4 | 차수벽·건물 + SceneEditor + 넘침 UI | ✅ |
| 5 | 2D Shallow Water + 2D height field GPU | ✅ |
| — | surge/파고 분리, barrier shield, oceanColors | ✅ |
| — | frontend/backend 폴더 분리 | ✅ | [PROJECT_LAYOUT.md](./docs/PROJECT_LAYOUT.md) |
| 6 | 3D Tiles·지형 침수 | 📋 |
| 7 | Wake GPU, 연출 | 📋 |

---

## 스크린샷 갱신

```bash
dotnet run -- serve
node frontend/Scripts/smoke-test.mjs http://localhost:5173/
# 캡처 → docs/screenshots/
```

---

## 참고

- [Cesium Gerstner GPU PoC](./frontend/adapters/cesium/INTEGRATION.md)
- [GPU Gems Ch.1 — Water Simulation](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models)

---

*MyAutomationEngine — 해안 도시 홍수·파도 WebGL 시뮬레이션*
