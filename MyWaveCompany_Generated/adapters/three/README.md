# adapters/three — Three.js 어댑터

Three.js `ShaderMaterial` + `PlaneGeometry`로 Gerstner 수면을 렌더링한다.

## export

```javascript
import { createOceanMaterial, OceanMaterial, OceanMesh } from './adapters/three/index.js';
```

## 사용법

```javascript
import * as THREE from 'three';
import wavesJson from '../../configs/waves.json';
import { loadWavesConfig } from '../../core/index.js';
import { createOceanMaterial, OceanMesh } from './index.js';

const config = loadWavesConfig(wavesJson);
const material = createOceanMaterial(config.waves);
const ocean = new OceanMesh(config, material);

scene.add(ocean);

// animate loop
const t = clock.getElapsedTime();
ocean.update(t);
material.uniforms.uCameraPosition.value.copy(camera.position);
```

## OceanMaterial

| 항목 | 설명 |
|------|------|
| Base | `THREE.ShaderMaterial` |
| Shaders | `core/shaders/ocean.vert.glsl`, `ocean.frag.glsl` |
| Method | `updateTime(seconds)` — `uTime` 갱신 |

### 주요 uniform

`uTime`, `uWaveCount`, `uWaveDirection[8]`, `uWaveAmplitude[8]`, …  
전체 목록: [docs/SHADER.md](../../docs/SHADER.md)

## OceanMesh

| 항목 | 설명 |
|------|------|
| Geometry | `PlaneGeometry(meshSizeX, meshSizeZ, resX, resZ)` |
| Rotation | X축 -90° (xz 수평면) |
| Method | `update(time)` |

## Cesium 이식 시

이 폴더는 **Three.js 전용**. Cesium 프로젝트에 복사하지 않는다.  
대신 `core/` + `adapters/cesium/`을 사용한다.

## 데모 참고

전체 씬 구성: [demo/main.js](../../demo/main.js)
