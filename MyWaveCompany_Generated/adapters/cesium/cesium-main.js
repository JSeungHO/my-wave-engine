/**
 * Cesium 단독 데모 진입점  (Task 2-4 / Phase 2b·2c 업데이트)
 *
 * Three.js 없이 Cesium + core/ 만으로 Gerstner 수면과 부유 Entity를 구현합니다.
 *
 * ## Phase 2c 변경 사항 (Task 2c-1~3)
 *   WakeRegistry 연동 — 선박 이동 시 Wake(尾迹) GPU 렌더링 활성화
 *
 * ## Phase 2b 변경 사항
 *   GPU 버텍스 변위 모드: GerstnerWaterPrimitiveGPU 사용
 *
 * ## 실행
 *   vite dev → http://localhost:5173/cesium.html
 *
 * ## 파일 구조
 *   cesium.html          ← HTML 진입점 (루트)
 *   adapters/cesium/
 *     cesium-main.js           ← 이 파일
 *     GerstnerWaterPrimitiveGPU.js  Phase 2b+2c (GPU 버텍스 변위 + Wake)
 *     WakeRegistry.js          Phase 2c-2 (Wake 소스 관리)
 *     FloatingEntity.js        Phase 2c-2 (속도 추적 연동)
 *     TangentPlane.js
 *   core/                ← Three.js import 없음
 *   configs/waves.json
 *   configs/interaction.json   Phase 2c-1 (Wake 설정)
 */

import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

import wavesJson        from '../../configs/waves.json';
import interactionJson  from '../../configs/interaction.json';
import { loadWavesConfig, loadInteractionConfig } from '../../core/index.js';
// Phase 2b: GPU 버텍스 변위 — Phase 2a 로 돌아가려면 아래 두 줄을 바꾸세요
// import { GerstnerWaterPrimitive } from './GerstnerWaterPrimitive.js';
import { GerstnerWaterPrimitiveGPU as GerstnerWaterPrimitive } from './GerstnerWaterPrimitiveGPU.js';
import { FloatingEntity }  from './FloatingEntity.js';
import { WakeRegistry }    from './WakeRegistry.js';  // Phase 2c-2

// ─────────────────────────────────────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────────────────────────────────────

// Cesium Ion 토큰 — 실제 배포 시 자신의 토큰으로 교체
// https://ion.cesium.com/tokens
Cesium.Ion.defaultAccessToken = import.meta.env.CESIUM_ION_TOKEN || 'YOUR_CESIUM_ION_TOKEN';

/** 데모 중심 좌표 (부산항 앞바다) */
const CENTER_LON = 129.04;
const CENTER_LAT =  35.10;

// ─────────────────────────────────────────────────────────────────────────────
// Cesium Viewer 생성
// ─────────────────────────────────────────────────────────────────────────────

const viewer = new Cesium.Viewer('cesiumContainer', {
  terrain:             Cesium.Terrain.fromWorldTerrain(),
  timeline:            false,
  animation:           false,
  baseLayerPicker:     false,
  geocoder:            false,
  homeButton:          false,
  sceneModePicker:     false,
  navigationHelpButton: false,
  infoBox:             false,
  selectionIndicator:  false,
});

// 초기 카메라 위치
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(CENTER_LON, CENTER_LAT, 3000),
  orientation: {
    heading: Cesium.Math.toRadians(0),
    pitch:   Cesium.Math.toRadians(-45),
    roll:    0,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// waves.json 로드 + Gerstner 수면 생성
// ─────────────────────────────────────────────────────────────────────────────

const config = loadWavesConfig(wavesJson);
const iCfg   = loadInteractionConfig(interactionJson);   // Phase 2c-1

const ocean = new GerstnerWaterPrimitive(viewer, config.waves, {
  lon0:       CENTER_LON,
  lat0:       CENTER_LAT,
  alt0:       0,           // 해수면 기준
  widthDeg:   0.09,        // ≈ 10 km
  heightDeg:  0.09,
  resolution: 96,          // Phase 2b: GPU 격자 해상도 (65×65 → 97×97 = 9409 verts)
  deepColor:    new Cesium.Color(0.00, 0.10, 0.25, 0.88),
  shallowColor: new Cesium.Color(0.04, 0.44, 0.65, 0.88),
  buoyancyIterations: config.ocean.buoyancyIterations,
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2c-2: WakeRegistry 생성 + GPU 연결
// ─────────────────────────────────────────────────────────────────────────────

const registry = new WakeRegistry(viewer, iCfg);
registry.connectOcean(ocean);   // 매 tick 후 ocean.updateWakeSources() 자동 호출

// ─────────────────────────────────────────────────────────────────────────────
// 선박 Entity — GerstnerWave 수면 추종
// ─────────────────────────────────────────────────────────────────────────────

const shipEntity = viewer.entities.add({
  name: '선박',
  box: {
    dimensions: new Cesium.Cartesian3(30, 10, 60),   // 30m × 10m × 60m
    material:   new Cesium.ColorMaterialProperty(
      new Cesium.Color(1.0, 0.4, 0.1, 1.0),
    ),
  },
  label: {
    text:            '선박',
    font:            '14pt sans-serif',
    fillColor:       Cesium.Color.WHITE,
    pixelOffset:     new Cesium.Cartesian2(0, -50),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  },
});

const ship = new FloatingEntity(
  viewer, shipEntity, ocean.plane, ocean.gerstnerSolver,
  {
    lon:          CENTER_LON + 0.005,
    lat:          CENTER_LAT + 0.003,
    offsetAlt:    5,       // 흘수선 위 5m
    tiltStrength: 0.10,
    wakeRegistry: registry,             // Phase 2c-2: Wake 속도 자동 등록
    wakeStrength: 0.5,                  // 선박 Wake 세기
    wakeRadiusM:  30,                   // 선박 Wake 반지름 (m)
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 부표 Entity
// ─────────────────────────────────────────────────────────────────────────────

const buoyEntity = viewer.entities.add({
  name: '부표',
  ellipsoid: {
    radii:    new Cesium.Cartesian3(3, 3, 4),
    material: Cesium.Color.RED.withAlpha(0.9),
  },
  label: {
    text:  '부표',
    font:  '12pt sans-serif',
    fillColor: Cesium.Color.WHITE,
    pixelOffset: new Cesium.Cartesian2(0, -30),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  },
});

const buoy = new FloatingEntity(
  viewer, buoyEntity, ocean.plane, ocean.gerstnerSolver,
  {
    lon:         CENTER_LON - 0.008,
    lat:         CENTER_LAT - 0.004,
    offsetAlt:   1.5,
    tiltStrength: 0.18,
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// UI 오버레이
// ─────────────────────────────────────────────────────────────────────────────

const overlay = document.getElementById('overlay');

viewer.scene.preRender.addEventListener(() => {
  if (!overlay) return;
  const shipAlt   = ship.getWaterAltitude().toFixed(1);
  const buoyAlt   = buoy.getWaterAltitude().toFixed(1);
  const wakeCnt   = registry.sourceCount;
  overlay.innerHTML =
    `<b>Gerstner Wave — Cesium 데모 (Phase 2c)</b><br>` +
    `파도 수 : ${config.waves.length}<br>` +
    `선박 고도 : ${shipAlt} m<br>` +
    `부표 고도 : ${buoyAlt} m<br>` +
    `Wake 소스 : ${wakeCnt}<br>` +
    `<small>core/ + adapters/cesium/ — GPU Wake 활성화</small>`;
});

// ─────────────────────────────────────────────────────────────────────────────
// 정리 (HMR / 페이지 언로드)
// ─────────────────────────────────────────────────────────────────────────────

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    ship.destroy();
    buoy.destroy();
    registry.destroy();   // Phase 2c-2
    ocean.destroy();
    viewer.destroy();
  });
}
