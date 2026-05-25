# Core API 레퍼런스

> `core/` 모듈 공개 API. Three.js·Cesium 공통 사용.

## import

```javascript
import { GerstnerWave, loadWavesConfig, MAX_WAVES } from './core/index.js';
```

---

## `loadWavesConfig(data)`

`waves.json` 파싱 결과를 정규화된 설정 객체로 반환한다.

### Parameters

| 이름 | 타입 | 설명 |
|------|------|------|
| `data` | `object` | JSON.parse 결과 또는 import한 waves.json |

### Returns: `WavesConfig`

```typescript
{
  ocean: {
    meshResolutionX: number,   // default 128
    meshResolutionZ: number,   // default 128
    meshSizeX: number,         // default 200 (미터)
    meshSizeZ: number,         // default 200
    buoyancyIterations: number // default 3
  },
  waves: GerstnerWaveParams[]  // 최대 MAX_WAVES(8)개
}
```

### `GerstnerWaveParams`

```typescript
{
  name: string,
  direction: [number, number],  // xz 방향, 자동 정규화
  amplitude: number,            // A (미터)
  wavelength: number,           // L (미터)
  speed: number,                // m/s
  steepness: number             // Q (0~1)
}
```

### Example

```javascript
import wavesJson from '../configs/waves.json';
const config = loadWavesConfig(wavesJson);
console.log(config.waves.length); // 3
```

---

## `GerstnerWave`

Gerstner Wave CPU 솔버. GPU Gems Ch.1 수식과 동일.

### `new GerstnerWave(waves, options?)`

| Parameter | 타입 | Default | 설명 |
|-----------|------|---------|------|
| `waves` | `GerstnerWaveParams[]` | — | 파도 배열 |
| `options.buoyancyIterations` | `number` | `3` | getWaterHeight 반복 보정 횟수 |
| `options.baseY` | `number` | `0` | 수면 기준 y 높이 |

```javascript
const solver = new GerstnerWave(config.waves, {
  buoyancyIterations: config.ocean.buoyancyIterations,
});
```

---

### `displacement(x, z, time)`

주어진 xz 위치에서 Gerstner 합산 **변위 벡터**를 반환한다.

| Parameter | 타입 | 설명 |
|-----------|------|------|
| `x` | `number` | 월드 x |
| `z` | `number` | 월드 z |
| `time` | `number` | 경과 시간 (초) |

**Returns:** `{ x, y, z }` — 수평(x,z) + 수직(y) 변위

```javascript
const disp = solver.displacement(10, 5, 2.5);
// disp.y → 해당 지점 수직 변위
```

---

### `normal(x, z, time)`

주어진 xz 위치에서 **단위 법선 벡터**를 반환한다.

**Returns:** `{ x, y, z }` — 정규화된 법선

```javascript
const n = solver.normal(10, 5, 2.5);
// 보트 기울기, 조명 계산에 사용
```

---

### `getWaterHeight(x, z, time)`

수평 변위 보정(iterative) 후 **수면 y 높이**를 반환한다.  
Cesium Entity 고도, 부력, 레이캐스트 피킹에 사용한다.

| Parameter | 타입 | 설명 |
|-----------|------|------|
| `x` | `number` | 조회 x |
| `z` | `number` | 조회 z |
| `time` | `number` | 경과 시간 (초) |

**Returns:** `number` — `baseY + 수직 변위`

```javascript
const y = solver.getWaterHeight(15, 10, elapsed);
entity.position.y = y + hullOffset;
```

#### 반복 보정

Gerstner 파도는 수평 변위가 있어 `(x, z)`에서 직접 샘플하면 오차가 생긴다.  
`buoyancyIterations`만큼 역변위를 적용해 샘플 위치를 보정한다.

---

## `MAX_WAVES`

상수 `8`. GPU 셰이더 `MAX_WAVES`와 동일. 파도는 최대 8개까지.

---

## Three.js Adapter API

> `adapters/three/` — Three.js 전용

### `createOceanMaterial(waves)`

`GerstnerWaveParams[]` → `OceanMaterial` (ShaderMaterial) 생성.

### `OceanMaterial.updateTime(time)`

`uTime` uniform 갱신. 매 프레임 호출.

### `OceanMesh`

| Constructor | `(config: WavesConfig, material: OceanMaterial)` |
| Method | `update(time)` — material.updateTime 위임 |

---

## Cesium Adapter API (Phase 2)

> `adapters/cesium/GerstnerWaterPrimitive` — 미구현

현재 `new GerstnerWaterPrimitive()` 호출 시 에러.  
[INTEGRATION.md](../adapters/cesium/INTEGRATION.md) 참고.
