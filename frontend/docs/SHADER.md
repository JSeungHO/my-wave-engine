# 셰이더 레퍼런스

> 경로: `core/shaders/`

Three.js `ShaderMaterial` 및 Cesium `CustomShader`에서 공통 사용하는 GLSL 소스.

## 파일 구성

| 파일 | 역할 |
|------|------|
| `gerstner.glsl` | Gerstner 변위·법선 함수 (`#include` 대상) |
| `ocean.vert.glsl` | 버텍스 변위, 법선, varyings |
| `ocean.frag.glsl` | 프레넬 수면 색, 투명도 |

`ocean.vert.glsl` 상단:

```glsl
#include "./gerstner.glsl"
```

Vite `vite-plugin-glsl`이 빌드 시 include를 해석한다.

---

## Uniform 목록

### Vertex + Fragment 공통

| Uniform | 타입 | 설명 |
|---------|------|------|
| `uTime` | `float` | 경과 시간 (초) |
| `uWaveCount` | `int` | 활성 파도 수 (≤ 8) |
| `uWaveDirection` | `vec2[8]` | 정규화된 xz 방향 |
| `uWaveAmplitude` | `float[8]` | 진폭 A |
| `uWaveWavelength` | `float[8]` | 파장 L |
| `uWaveSpeed` | `float[8]` | 속력 |
| `uWaveSteepness` | `float[8]` | 첨예도 Q |

### Fragment only

| Uniform | 타입 | Default (Three.js) | 설명 |
|---------|------|-------------------|------|
| `uDeepColor` | `vec3` | `#003366` | 깊은 물 색 |
| `uShallowColor` | `vec3` | `#0099cc` | 얕은/하이라이트 색 |
| `uCameraPosition` | `vec3` | camera.position | 프레넬 계산용 |

---

## Varying

| Varying | 타입 | 설명 |
|---------|------|------|
| `vWorldPos` | `vec3` | 변위 후 월드 좌표 |
| `vNormal` | `vec3` | Gerstner 합산 법선 |
| `vWaveHeight` | `float` | 수직 변위 (frag 색 보간) |

---

## gerstner.glsl 함수

### `gerstnerDisplacement(...)`

입력: `worldXZ`, `time`, `waveCount`, 파도 배열 uniform  
출력: `vec3` 변위 `(dx, dy, dz)`

### `gerstnerNormal(...)`

입력: 동일  
출력: `vec3` 단위 법선

### `MAX_WAVES`

`#define MAX_WAVES 8` — `core/types/WaveTypes.js`의 `MAX_WAVES`와 일치.

---

## ocean.vert.glsl 파이프라인

```
local position
    → modelMatrix → world.xz
    → gerstnerDisplacement() → world + disp
    → gerstnerNormal()
    → gl_Position = P · V · worldPos
```

Three.js 기본 attribute/uniform (`position`, `modelMatrix`, `viewMatrix`, `projectionMatrix`) 사용.

---

## ocean.frag.glsl

1. **프레넬** — 시선각에 따라 deep/shallow 색 mix
2. **crest 하이라이트** — `vWaveHeight` 기반 crest 강조
3. **alpha** — `0.92` 고정 투명도

---

## Three.js uniform 갱신

```javascript
// 매 프레임
material.updateTime(elapsedSeconds);
material.uniforms.uCameraPosition.value.copy(camera.position);
```

파도 변경 시 `createOceanMaterial(newWaves)`로 material 재생성.

---

## Cesium CustomShader 매핑 (Phase 2)

| Three.js | Cesium CustomShader |
|----------|---------------------|
| `uTime` | `uniform float u_time;` |
| `uWaveDirection[i]` | `uniform vec2 u_waveDir[N];` 또는 UBO |
| `modelMatrix * position` | `czm_model * position` (Cesium built-in) |
| `uCameraPosition` | `czm_viewerPositionWC` |

자세한 이식 절차: [INTEGRATION.md](../adapters/cesium/INTEGRATION.md)

---

## CPU / GPU 일치 검증

동일 `(x, z, time)`에서:

* GPU: vertex shader `disp.y`
* CPU: `solver.displacement(x, z, time).y`

데모에서 `FloatingObject`가 CPU `getWaterHeight()`를 사용하며 GPU 수면과 시각적으로 일치하면 검증 완료.
