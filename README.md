# MyAutomationEngine

기획서(`기획서.md`)를 읽어 WebGL 오션 프로젝트 스캐폴드를 생성하는 .NET 10 자동화 엔진.

## 빠른 시작

```bash
# 1. 기획서 기반 폴더·파일 생성
dotnet run

# 2. WebGL 데모 실행
cd MyWaveCompany_Generated
npm install
npm run dev
```

## 문서 목록

| 문서 | 설명 |
|------|------|
| [기획서.md](./기획서.md) | **제품 목표**, North Star, 성공 기준, Phase 의사결정 |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | **Phase별 로드맵**, DoD, 작업 목록, 참조 파일 |
| [docs/DOC_GUIDE.md](./docs/DOC_GUIDE.md) | **구현 시 읽는 순서**, 설정↔코드 매핑, 역할별 가이드 |
| [docs/VERIFY_PHASE4.md](./docs/VERIFY_PHASE4.md) | **Phase 4 막힘 UX** — 왜 안 보이는지, QA 방법 |
| [docs/SCENE_LAYOUT.md](./docs/SCENE_LAYOUT.md) | **물 범위·차수벽 위치** — JSON 설정·프리셋·정합 규칙 |
| [docs/REFERENCE_VIDEO.md](./docs/REFERENCE_VIDEO.md) | **참조 영상** ([YouTube](https://youtu.be/pKvdDQYj6J0)) 타겟 UX·갭·Phase 5a |
| [진행상태.md](./진행상태.md) | 현재 완료/미완 스냅샷 |
| [MyWaveCompany_Generated/README.md](./MyWaveCompany_Generated/README.md) | WebGL 오션 프로젝트 진입점 |
| [MyWaveCompany_Generated/docs/](./MyWaveCompany_Generated/docs/) | 아키텍처, API, 설정, 셰이더 상세 |

## 프로젝트 구성

```
MyAutomationEngine/
├── Program.cs                  # 기획서 → MyWaveCompany_Generated/ 생성
├── 기획서.md
├── 진행상태.md
└── MyWaveCompany_Generated/    # Gerstner Wave WebGL 오션 (Three.js 데모)
    ├── core/                   # ★ Cesium 이식 핵심
    ├── adapters/three/         # Three.js 어댑터
    ├── adapters/cesium/        # Cesium 연동 (Phase 2)
    └── demo/                   # WebGL PoC
```
