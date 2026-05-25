# 프로젝트 폴더 구조 (frontend / backend)

> **갱신:** 2026-05-25 — `MyWaveCompany_Generated/` 를 `frontend/` 로, .NET CLI 를 `backend/` 로 분리

---

## 개요

| 폴더 | 역할 | 실행 |
|------|------|------|
| **`frontend/`** | Vite + Cesium + Three.js WebGL 데모 | `dotnet run -- serve` 또는 `cd frontend && npm run dev` |
| **`backend/`** | .NET 10 CLI — sync, serve, build, doctor, clean | 저장소 **루트**에서 `dotnet run -- <command>` |
| **`docs/`** | 기획·로드맵·QA 문서 | — |
| **루트** | `MyAutomationEngine.csproj`, `기획서.md`, `README.md` | `dotnet run` 진입점 |

---

## 디렉터리 트리

```
MyAutomationEngine/
├── MyAutomationEngine.csproj     # backend/**/*.cs 컴파일, frontend/ 제외
├── backend/
│   ├── Program.cs
│   ├── CommandRunner.cs
│   ├── EnginePaths.cs            # RepoRoot · frontend/ · backend/Templates 경로
│   ├── Commands/                 # sync, serve, build, check, doctor, clean
│   └── Templates/                # sync 시 frontend 로 복사할 생성 템플릿
├── frontend/                     # (구 MyWaveCompany_Generated)
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html, cesium.html, shore.html
│   ├── Configs/                  # waves, scene, obstacles, flood …
│   ├── core/                     # GerstnerWave, ShallowWater, ObstacleField …
│   ├── adapters/cesium|three/
│   ├── src/adapters/cesium/      # ★ Cesium 진입점 cesium-main.js
│   ├── docs/                     # API, CONFIG, SHADER, FLOOD …
│   └── Scripts/                  # smoke-test.mjs, anim-test.mjs
├── docs/                         # ROADMAP, SCENE_LAYOUT, PROJECT_LAYOUT …
├── 기획서.md
└── 진행상태.md
```

---

## 경로 매핑 (마이그레이션)

| 이전 | 이후 |
|------|------|
| `MyWaveCompany_Generated/` | `frontend/` |
| `Program.cs`, `Commands/` (루트) | `backend/` |
| `Templates/` (루트) | `backend/Templates/` |
| `EnginePaths.GeneratedProject` | `EnginePaths.FrontendProject` (별칭 `GeneratedProject` 유지) |

**Cesium 진입점:** `frontend/src/adapters/cesium/cesium-main.js`

**설정 JSON:** `frontend/Configs/*.json`

---

## CLI (`backend/EnginePaths.cs`)

- **Repo root:** `frontend/` 폴더 존재 여부로 자동 탐지 (루트 또는 `backend/` 에서 실행 가능)
- **`dotnet run -- sync`:** `기획서.md` 항목 → `frontend/` scaffold + `backend/Templates/` → `frontend/src/adapters/cesium/`
- **`dotnet run -- serve`:** `frontend/` 에서 `npm run dev`
- **`dotnet run -- build`:** `frontend/` Vite 프로덕션 빌드

---

## .gitignore

- `frontend/node_modules/`, `frontend/dist/`, `frontend/public/cesium/` (npm/vite 생성물)
- `MyWaveCompany_Generated/` (레거시 경로)

---

## 관련 문서

| 문서 | 내용 |
|------|------|
| [README.md](../README.md) | 빠른 시작 · 스크린샷 |
| [DOC_GUIDE.md](./DOC_GUIDE.md) | 역할별 읽기 순서 |
| [frontend/docs/CONFIG.md](../frontend/docs/CONFIG.md) | JSON 스키마 |
| [frontend/adapters/cesium/INTEGRATION.md](../frontend/adapters/cesium/INTEGRATION.md) | Cesium GPU 연동 |
