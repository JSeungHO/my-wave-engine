# 문서 가이드 — 무엇을 읽고, 어디서 작업하는가

> **대상:** 이 레포에서 **구현·연동·설정**을 담당하는 개발자.  
> **기획만 볼 때:** [기획서.md](../기획서.md) → [ROADMAP.md](./ROADMAP.md) 만으로 충분.

---

## 1. 문서 계층

```
기획서.md              ← WHY / WHAT (목표, 성공 기준)
    ↓
docs/ROADMAP.md        ← WHEN / HOW BIG (Phase, 마일스톤)
    ↓
진행상태.md            ← NOW (완료·미완 스냅샷)
    ↓
frontend/docs/   ← HOW (기술 상세)
    ├── ARCHITECTURE.md
    ├── API.md
    ├── CONFIG.md
    └── SHADER.md
    ↓
adapters/cesium/INTEGRATION.md  ← Cesium 연동 실무
```

---

## 2. 역할별 읽기 순서

### A. 처음 합류 (30분)

| 순서 | 문서 | 목적 |
|------|------|------|
| 1 | [기획서.md](../기획서.md) | 제품 목표·North Star |
| 2 | [ROADMAP.md](./ROADMAP.md) | 지금 어느 Phase인지 |
| 3 | [진행상태.md](../진행상태.md) | 이미 뭐가 돼 있는지 |
| 4 | [frontend/README.md](../frontend/README.md) | 실행 방법 |

### B. Cesium / 수면 렌더링 담당

| 순서 | 문서 | 목적 |
|------|------|------|
| 1 | [INTEGRATION.md](../frontend/adapters/cesium/INTEGRATION.md) | Phase 2a/2b, 좌표계, TangentPlane |
| 2 | [ARCHITECTURE.md](../frontend/docs/ARCHITECTURE.md) | core / adapters / demo 레이어 |
| 3 | [API.md](../frontend/docs/API.md) | `GerstnerWave`, `loadWavesConfig` |
| 4 | [CONFIG.md](../frontend/docs/CONFIG.md) | `waves.json`, `scene.json` |
| 5 | **코드** `src/adapters/cesium/cesium-main.js` | **실제 진입점** (구 `adapters/cesium/cesium-main.js` 아님) |

**핵심 구현 파일:**

| 파일 | 역할 |
|------|------|
| `adapters/cesium/GerstnerWaterPrimitiveGPU.js` | GPU 3D 수면 (Phase 2b) |
| `adapters/cesium/GerstnerWaterPrimitive.js` | Material 평면 (Phase 2a) |
| `adapters/cesium/TangentPlane.js` | WGS84 ↔ ENU |
| `adapters/cesium/FloatingEntity.js` | Entity 부력·기울기 |
| `adapters/cesium/WakeRegistry.js` | Wake CPU → GPU 연동 |
| `core/types/SceneTypes.js` | `scene.json` 해안 정렬 |
| `Configs/scene.json` | 장면·카메라·해안 |

### C. GLSL / 셰이더 담당

| 순서 | 문서 | 목적 |
|------|------|------|
| 1 | [SHADER.md](../frontend/docs/SHADER.md) | uniform, include 규칙 |
| 2 | `core/shaders/gerstner.glsl` | Gerstner 수식 (Three.js) |
| 3 | `GerstnerWaterPrimitiveGPU.js` 내 `buildVertexShader` / `buildFragmentShader` | Cesium GPU (인라인 GLSL) |
| 4 | `core/shaders/wake.glsl` | Wake (Phase 2c, GPU 미연결) |

**주의:** Cesium Fabric은 **배열 uniform 불가** — `GerstnerWaterPrimitive.js` 주석 참고.

### D. Three.js PoC / 비교용

| 문서/경로 | 목적 |
|-----------|------|
| `adapters/three/README.md` | OceanMaterial, OceanMesh |
| `demo/main.js`, `demo/shore-main.js` | 로컬 xz 데모 |
| `core/shaders/ocean.vert.glsl`, `ocean.frag.glsl` | Three.js용 |

### E. Phase 4+ (장애물·차수벽·홍수) — **신규 작업**

| 순서 | 참고 | 작업 |
|------|------|------|
| 1 | [ROADMAP.md § Phase 4](./ROADMAP.md#phase-4--장애물--차수벽-poc) | 범위·DoD |
| 2 | `core/types/InteractionTypes.js` | `CollisionBody` 패턴 → `ObstacleBody` 확장 참고 |
| 3 | `Configs/interaction.json` | collision 섹션 |
| 4 | [ARCHITECTURE.md § 확장 포인트](../frontend/docs/ARCHITECTURE.md) | 새 모듈 위치 |
| 5 | **신규** [Configs/obstacles.json](../frontend/Configs/obstacles.json) | 건물·차수벽 footprint |
| 6 | [SCENE_LAYOUT.md](./SCENE_LAYOUT.md) | **물 범위·차수벽 위치** JSON 편집 |
| 7 | [FLOOD.md](../frontend/docs/FLOOD.md) | 2D flow, 마스크, GPU 합성 (스펙 초안) |

---

## 3. 설정 파일 ↔ 코드 매핑

| JSON | 로더 | 소비처 |
|------|------|--------|
| `Configs/waves.json` | `loadWavesConfig()` | GPU VS, Material, `GerstnerWave` |
| `Configs/scene.json` | `loadSceneConfig()` | `cesium-main.js` 카메라·해안·Entity |
| `Configs/interaction.json` | `loadInteractionConfig()` | `WakeRegistry`, (collision 미연동) |
| `Configs/settings.json` | — | 스텁 (미사용) |
| `Configs/obstacles.json` | 📋 예정 | Phase 4 |
| `Configs/flood.json` | 📋 예정 | Phase 5 |

**배치 편집:** [SCENE_LAYOUT.md](./SCENE_LAYOUT.md) — `scene.json` 물 범위, `obstacles.json` 차수벽 footprint.

---

## 4. 실행·검증

| 작업 | 명령 / URL |
|------|------------|
| Dev 서버 | `dotnet run -- serve` (또는 `frontend`에서 `npm run dev`) |
| Cesium 메인 | `http://localhost:5173/` (포트는 터미널 확인) |
| Three.js 해변 | `/shore.html` |
| GPU 강제 | 기본 GPU 2b; 평면 디버그 `?material=1` |
| 스모크 테스트 | `node frontend/scripts/smoke-test.mjs <URL>` |

---

## 5. 코드 생성 (.NET) 작업 시

| 문서 | 내용 |
|------|------|
| [진행상태.md § dotnet run 주의](../진행상태.md) | 기존 파일 보호 정책 |
| `Templates/` | `dotnet run` 생성 스텁 |
| [기획서.md § Phase 3](../기획서.md) | 생성기는 후순위 |

**원칙:** `core/`, `adapters/cesium/` 수동 구현본은 생성 대상과 겹치지 않게 — 변경 전 `Templates/`와 `Program.cs` 확인.

---

## 6. 문서 갱신 규칙

| 이벤트 | 갱신할 문서 |
|--------|-------------|
| Phase 완료 | `진행상태.md`, `ROADMAP.md` 체크박스 |
| 새 Config 추가 | `CONFIG.md`, [SCENE_LAYOUT.md](./SCENE_LAYOUT.md), 이 가이드 §3 |
| Cesium API 변경 | `INTEGRATION.md`, `API.md` |
| 셰이더 규칙 변경 | `SHADER.md` |
| 목표/범위 변경 | `기획서.md` |

---

## 7. 외부 참고

| 자료 | 용도 |
|------|------|
| [GPU Gems Ch.1 — Water Simulation](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models) | Gerstner 원전 |
| [Cesium Custom Shaders / Appearance](https://cesium.com/learn/cesiumjs/ref-doc/) | GPU Primitive |
| Shallow Water Equations (2D) | Phase 5 flood grid |

---

*이 문서는 구현 착수 시 **첫 번째로 열 문서**다. Phase가 바뀌면 [ROADMAP.md](./ROADMAP.md) 해당 절을 읽고 돌아온다.*
