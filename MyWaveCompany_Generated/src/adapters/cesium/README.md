# Templates/ — 자동화 엔진 템플릿 저장소

> Phase 3 `Program.cs` 가 이 폴더의 파일을 읽어 `MyWaveCompany_Generated/` 에 코드를 생성합니다.

## 접두사 규칙 (`.cursorrules` §5)

| 접두사 | 의미 | 생성 후 수정 |
|--------|------|-------------|
| `gen_` | 자동 생성 대상 | **금지** — 기획서·템플릿만 수정 |
| `src_` | 개발자 직접 작성 | 자유롭게 수정 |
| `lib_` | 외부 라이브러리 의존 | `core/` 내 **금지** |

## 경로 매핑 (Program.cs Phase 3 구현 예정)

| Templates 파일 | gen_ 접두사 제거 후 | 출력 경로 |
|----------------|---------------------|-----------|
| `configs/gen_interaction.json` | `interaction.json` | `MyWaveCompany_Generated/configs/` |
| `core/gen_WakeField.js` | `WakeField.js` | `MyWaveCompany_Generated/core/math/` |
| `core/gen_wake.glsl` | `wake.glsl` | `MyWaveCompany_Generated/core/shaders/` |
| `adapters/cesium/gen_WakeRegistry.js` | `WakeRegistry.js` | `MyWaveCompany_Generated/adapters/cesium/` |

## 현재 상태 (Phase 2c)

Phase 3 자동화 전까지 `MyWaveCompany_Generated/` 내 파일을 수동으로 유지합니다.
`gen_` 파일은 Phase 3 설계 문서 역할을 합니다.

## 템플릿 변수 (Phase 3 치환 예정)

`{{변수명}}` 형식으로 기획서 또는 JSON 설정에서 값을 주입합니다.

| 변수 | 출처 |
|------|------|
| `{{maxSources}}` | `interaction.json → wake.maxSources` |
| `{{decayTimeSec}}` | `interaction.json → wake.decayTimeSec` |
| `{{minSpeedKnots}}` | `interaction.json → wake.minSpeedKnots` |
| `{{waveCount}}` | `waves.json → waves.length` |

## 폴더 구조

```
Templates/
├── README.md                           ← 이 파일
├── configs/
│   └── gen_interaction.json            ✅ Phase 2c-1
├── core/
│   ├── gen_WakeField.js                ✅ Phase 2c-1 stub
│   └── gen_wake.glsl                   ← Phase 2c-3 예정
└── adapters/cesium/
    ├── gen_WakeRegistry.js             ← Phase 2c-2 예정
    └── src_FloatingEntity.patch.md     ← Phase 2c-2 예정 (수동 merge 가이드)
```
