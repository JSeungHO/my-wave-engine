# core — Gerstner Wave 핵심 모듈

> **Three.js·Cesium import 금지.** Cesium 프로젝트에 이 폴더만 복사해 사용한다.

## 포함 파일

```
core/
├── index.js              # 공개 API
├── types/WaveTypes.js    # loadWavesConfig, MAX_WAVES
├── math/GerstnerWave.js  # CPU 솔버
└── shaders/
    ├── gerstner.glsl
    ├── ocean.vert.glsl
    └── ocean.frag.glsl
```

## Cesium 프로젝트에 복사

```bash
cp -r core/ /path/to/cesium-project/src/wave-core/
```

복사 후:

```javascript
import { GerstnerWave, loadWavesConfig } from './wave-core/index.js';
```

## 최소 사용 (CPU only)

```javascript
import { GerstnerWave, loadWavesConfig } from './core/index.js';
import wavesJson from './configs/waves.json';

const { waves, ocean } = loadWavesConfig(wavesJson);
const solver = new GerstnerWave(waves, {
  buoyancyIterations: ocean.buoyancyIterations,
});

// 매 프레임 — Entity / Camera 고도
const waterY = solver.getWaterHeight(lonLocal, latLocal, timeSeconds);
```

> Cesium에서는 WGS84 좌표를 tangent plane xz로 변환한 뒤 `getWaterHeight`에 전달한다.  
> [INTEGRATION.md](../adapters/cesium/INTEGRATION.md) 참고.

## 공개 API

| Export | 설명 |
|--------|------|
| `GerstnerWave` | CPU 변위·법선·getWaterHeight |
| `loadWavesConfig` | JSON → 정규화 설정 |
| `MAX_WAVES` | `8` |

상세: [docs/API.md](../docs/API.md)

## 셰이더

GLSL은 `adapters/`에서 import해 엔진별 Material에 연결한다.

* Three.js: `vite-plugin-glsl`로 `.glsl` import
* Cesium: CustomShader `fragmentShader` / `vertexShader` 문자열로 주입

상세: [docs/SHADER.md](../docs/SHADER.md)

## 의존성

없음 (순수 ES Module + GLSL 파일).
