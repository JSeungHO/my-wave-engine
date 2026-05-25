# Cesium.js 연동 가이드

> Phase 2a ✅ 완료 · Phase 2b ✅ 완료 · Phase 2c 예정.

## 목표

Three.js 데모에서 검증된 `core/` 모듈을 Cesium Viewer 위 Gerstner 수면으로 렌더링한다.

## 이식 범위

### 복사 대상

| 경로 | 용도 |
|------|------|
| `core/math/GerstnerWave.js`  | CPU `getWaterHeight()` — Entity·카메라 |
| `core/types/WaveTypes.js`    | `loadWavesConfig()` |
| `core/shaders/*.glsl`        | Material GLSL / Phase 2b CustomShader |
| `configs/waves.json`         | 파도 설정 |

### 복사하지 않음

| 경로 | 이유 |
|------|------|
| `demo/`           | Three.js PoC |
| `adapters/three/` | Three.js 전용 |
| `index.html`, `vite.config.js` | Three.js 빌드 |

---

## 좌표계 변환

Three.js 데모는 **Y-up 로컬 xz** 평면을 사용한다.  
Cesium은 **WGS84 / ECEF** 좌표계를 사용한다.

### 구현: Local Tangent Plane → `TangentPlane.js`

```
1. 관심 영역 중심 (lon₀, lat₀) 으로 TangentPlane 생성
2. ENU (East-North-Up) tangent frame 생성
3. Cesium Cartesian3 → 로컬 (x=East, y=Up, z=North) 변환
4. GerstnerWave.getWaterHeight(localX, localZ, time) 호출
5. 결과 Up 고도를 Cartographic altitude 로 역변환
```

### 좌표 매핑

| Cesium ENU | GerstnerWave 로컬 |
|------------|-------------------|
| East  (x)  | local x           |
| North (y)  | local z           |
| Up    (z)  | local y  (파고)   |

### Cesium API

```javascript
import { TangentPlane } from './adapters/cesium/TangentPlane.js';

const plane = new TangentPlane(lon0, lat0);

// WGS84 위경도 → 수면 고도
const alt = plane.getWaterAltitude(lon, lat, solver, time);

// Phase 2b GPU 용 ENU→ECEF 행렬 (Float32Array, mat4)
const mat = plane.getEcefTransformF32();
```

---

## uniform 매핑 (Three.js → Cesium)

| Three.js (OceanMaterial) | Cesium (GerstnerWaterPrimitive fabric) |
|---------------------------|----------------------------------------|
| `uTime`                   | `u_time`                               |
| `uWaveCount`              | `u_waveCount`                          |
| `uWaveDirection[i]`       | `u_waveDir[8]` (Cesium.Cartesian2)     |
| `uWaveAmplitude[i]`       | `u_waveAmp[8]`                         |
| `uWaveWavelength[i]`      | `u_waveLen[8]`                         |
| `uWaveSpeed[i]`           | `u_waveSpeed[8]`                       |
| `uWaveSteepness[i]`       | `u_waveSteep[8]`                       |
| `uDeepColor`              | `u_deepColor`                          |
| `uShallowColor`           | `u_shallowColor`                       |
| `uCameraPosition`         | `czm_viewerPositionWC` (built-in)      |
| `modelMatrix * position`  | `czm_model * position`                 |

---

## 렌더링 전략

### Phase 2a — ✅ 완료

`GerstnerWaterPrimitive.js` — `Cesium.Primitive` + `MaterialAppearance` + `Cesium.Material(fabric)`

- Fragment shader 에서 Gerstner 파고를 UV 기반으로 근사
- `preRender` 이벤트에서 `u_time` 갱신 → 파도 색상 애니메이션
- 정적 `RectangleGeometry` (vertex 변위 없음)

### Phase 2b — ✅ 완료  (`GerstnerWaterPrimitiveGPU.js`)

```
구현:
1. ENU 로컬 Float32 N×N tessellated Geometry 생성
     attribute a_enuPos (vec3: East, North, Up=0)
     attribute a_st     (vec2: UV)
2. buildVertexShader(waves): GLSL ES 1.00 버텍스 셰이더 동적 생성
     - 파도 파라미터를 GLSL 리터럴로 인라인 (배열 생성자 없음)
     - Gerstner 수식: dispE/N/U 변위 + ENU 법선 누산
3. primitive.modelMatrix = enuToEcef  → czm_model 이 ENU→ECEF 변환 담당
     (별도 u_enuToWorld uniform 불필요)
4. primitive._commands uniformMap 인터셉트
     u_time / u_deepColor / u_shallowColor 매 프레임 갱신
5. Fragment: czm_viewerPositionWC 기반 Fresnel + Specular 수면 색상
```

**cesium-main.js**: `GerstnerWaterPrimitiveGPU as GerstnerWaterPrimitive` 로 드롭인 교체.

### Phase 2c — 대규모 (예정)

- Rectangle 타일 분할 (LOD)
- 카메라 거리별 meshResolution 조절
- Globe curvature 보정 (넓은 영역)

---

## Entity / Camera 고도 동기화

```javascript
import { GerstnerWaterPrimitive } from './adapters/cesium/GerstnerWaterPrimitive.js';
import { FloatingEntity }         from './adapters/cesium/FloatingEntity.js';
import { loadWavesConfig }        from './core/index.js';
import wavesJson from './configs/waves.json';

const config = loadWavesConfig(wavesJson);

// 1. 수면 렌더링 Primitive 생성
const ocean = new GerstnerWaterPrimitive(viewer, config.waves, {
  lon0: 126.5, lat0: 37.5,
  widthDeg: 0.09, heightDeg: 0.09,
});

// 2. Entity 에 부력 적용 (solver 공유)
const shipEntity = viewer.entities.add({ ... });
const ship = new FloatingEntity(
  viewer, shipEntity, ocean.plane, ocean.gerstnerSolver,
  { lon: 126.501, lat: 37.501, offsetAlt: 2.5 },
);

// 3. 이동
ship.moveTo(126.502, 37.502);

// 4. 정리
ship.destroy();
ocean.destroy();
```

---

## 구현 체크리스트

### Phase 2a — CPU 연동 ✅

* [x] `core/` Cesium 프로젝트에 복사 가이드 (`core/README.md`)
* [x] ENU tangent plane 유틸 → `TangentPlane.js`
* [x] `getWaterHeight()` → Entity `position` 동기화 → `FloatingEntity.js`
* [x] `viewer.clock` → `time` seconds 변환 (`JulianDate.secondsDifference`)

### Phase 2b — GPU 연동 ✅ 완료

* [x] `GerstnerWaterPrimitive.js` — Primitive + Material 생성 (Phase 2a)
* [x] `u_time` 매 프레임 갱신 (`preRender` 이벤트)
* [x] GPU 버텍스 변위 — `GerstnerWaterPrimitiveGPU.js` 구현
  * ENU 로컬 `Float32Array` N×N Geometry (`a_enuPos`, `a_st`)
  * `primitive.modelMatrix = enuToEcef` (czm_model = ENU→ECEF)
  * GLSL ES 1.00 동적 VS — 파도 파라미터 인라인 리터럴
  * `primitive._commands` uniformMap 인터셉트 (`u_time`, `u_deepColor`, `u_shallowColor`)
  * 정확한 Gerstner 법선 → Fresnel + Specular fragment 색상
* [x] `cesium-main.js` Phase 2b 드롭인 연동 (`resolution: 96`)
* [ ] Three.js 데모와 시각적 파도 형태 비교 (선택적)

### Phase 2c — 대규모

* [ ] Rectangle 타일 분할 (LOD)
* [ ] 카메라 거리별 meshResolution 조절
* [ ] Globe curvature 보정

---

## 참고

* [Cesium CustomShader](https://cesium.com/learn/cesiumjs/ref-doc/CustomShader.html)
* [Cesium Transforms.eastNorthUpToFixedFrame](https://cesium.com/learn/cesiumjs/ref-doc/Transforms.html)
* [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
* [docs/SHADER.md](../../docs/SHADER.md)
