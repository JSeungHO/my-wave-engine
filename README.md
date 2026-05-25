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
| [기획서.md](./기획서.md) | 프로젝트 목표, 폴더 구조, 생성 대상, 백로그 |
| [진행상태.md](./진행상태.md) | 현재 진행 상태, 완료/미완 항목 |
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
