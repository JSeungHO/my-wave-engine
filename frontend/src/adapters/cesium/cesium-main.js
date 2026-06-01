/**
 * Cesium 데모 진입점 (src/adapters/cesium/)
 * 구현 모듈은 adapters/cesium/ 에 위치 — Program.cs Templates 경로와 일치
 *
 * Cesium 코어는 CESIUM_BASE_URL 확정 후 dynamic import — ESM 번들이
 * import.meta.url(assets/*.js) 로 Workers 를 찾는 문제 방지.
 */

import wavesJson       from '../../../Configs/waves.json';
import sceneJson       from '../../../Configs/scene.json';
import interactionJson from '../../../Configs/interaction.json';
import obstaclesJson   from '../../../Configs/obstacles.json';
import floodJson       from '../../../Configs/flood.json';
import { loadWavesConfig, loadInteractionConfig, loadSceneConfig,
         loadObstaclesConfig, obstacleBodiesToBoxes,
         loadFloodConfig }                                        from '../../../core/index.js';
import { SceneEditor } from '../../../adapters/cesium/SceneEditor.js';
import { bindCameraPresets } from '../../../adapters/cesium/CameraPresets.js';
import { FloodLayer }  from '../../../adapters/cesium/FloodLayer.js';

const TAG = '[cesium-main]';
const CESIUM_BASE = '/cesium/';

/** @param {number|string} step @param {...unknown} args */
function log(step, ...args) {
  console.log(`${TAG} Step ${step}:`, ...args);
}

function waitForDom() {
  if (document.readyState === 'loading') {
    return new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  }
  return Promise.resolve();
}

/** @returns {string} */
function ensureCesiumBaseUrl() {
  const baseUrl = window.CESIUM_BASE_URL || CESIUM_BASE;
  window.CESIUM_BASE_URL = baseUrl;
  globalThis.CESIUM_BASE_URL = baseUrl;
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

/**
 * @param {string} baseUrl
 * @returns {Promise<{ ok: boolean, failures: string[] }>}
 */
async function verifyCesiumAssets(baseUrl) {
  const probes = [
    'Assets/approximateTerrainHeights.json',
    'ThirdParty/basis_transcoder.wasm',
    'Widgets/widgets.css',
  ];
  const failures = [];

  for (const rel of probes) {
    const url = `${baseUrl}${rel}`;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      log('assets', `${rel} → HTTP ${res.status}`);
      if (!res.ok) failures.push(`${rel} (${res.status})`);
    } catch (err) {
      log('assets', `${rel} → FAIL`, err);
      failures.push(`${rel} (network)`);
    }
  }

  return { ok: failures.length === 0, failures };
}

/**
 * @param {HTMLElement | null} overlay
 * @param {string} html
 */
function setOverlay(overlay, html) {
  if (overlay) overlay.innerHTML = html;
}

/**
 * @param {import('cesium')} Cesium
 * @param {string} baseUrl
 * @param {HTMLElement} container
 */
async function createViewer(Cesium, baseUrl, container) {
  Cesium.Ion.defaultAccessToken =
    import.meta.env.CESIUM_ION_TOKEN ||
    import.meta.env.VITE_CESIUM_ION_TOKEN ||
    'YOUR_CESIUM_ION_TOKEN';

  const viewer = new Cesium.Viewer(container, {
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    timeline:             false,
    animation:            false,
    baseLayerPicker:      false,
    geocoder:             false,
    homeButton:           false,
    sceneModePicker:      false,
    navigationHelpButton: false,
    infoBox:              false,
    selectionIndicator:   false,
  });

  // Ion 실패 시에도 지구 텍스처 표시 (NaturalEarthII — /cesium/Assets)
  try {
    const layers = viewer.imageryLayers;
    if (layers.length === 0 || Cesium.Ion.defaultAccessToken === 'YOUR_CESIUM_ION_TOKEN') {
      layers.removeAll();
      const neUrl = `${baseUrl}Assets/Textures/NaturalEarthII`;
      const provider = await Cesium.TileMapServiceImageryProvider.fromUrl(neUrl);
      layers.addImageryProvider(provider);
      log('imagery', 'NaturalEarthII', neUrl);
    }
  } catch (err) {
    log('imagery', 'fallback failed', err);
  }

  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.globe.show = true;
  viewer.scene.skyAtmosphere.show = true;

  // 시뮬레이션 시간이 흐르도록 clock 활성화 + 연속 렌더
  viewer.clock.shouldAnimate = true;
  viewer.clock.multiplier = 1.25;
  viewer.scene.requestRenderMode = false;

  viewer.scene.renderError.addEventListener((_scene, error) => {
    console.error(`${TAG} renderError:`, error);

    // GPU 실패 시 Material 2a 로 자동 전환
    try {
      const url = new URL(globalThis.location.href);
      if (!url.searchParams.has('material') && runtime.useGpu) {
        console.warn(`${TAG} GPU render failed — switching to Material mode`);
        url.searchParams.set('material', '1');
        globalThis.location.replace(url.pathname + url.search + url.hash);
        return;
      }
    } catch { /* ignore */ }

    const overlay = document.getElementById('overlay');
    const msg = error?.message ?? String(error);
    setOverlay(
      overlay,
      `<b>렌더링 오류</b><br>${msg}<br>` +
      `<small>터미널 <code>dotnet run -- serve</code> 의 Local URL 사용<br>` +
      `(5190·5191·5192 등 예전 포트 X)</small>`,
    );
  });

  return viewer;
}

/**
 * @param {string} baseUrl
 */
async function loadCesiumRuntime(baseUrl) {
  log('cesium-import', 'dynamic import (base URL already set)', baseUrl);

  const Cesium = await import('cesium');
  await import('cesium/Build/Cesium/Widgets/widgets.css');

  if (Cesium.buildModuleUrl?.setBaseUrl) {
    Cesium.buildModuleUrl.setBaseUrl(baseUrl);
  }
  if (Cesium.buildModuleUrl?._clearBaseResource) {
    Cesium.buildModuleUrl._clearBaseResource();
    Cesium.buildModuleUrl.setBaseUrl(baseUrl);
  }

  const resolvedBase = Cesium.buildModuleUrl?.getCesiumBaseUrl?.()?.url;
  log('cesium-import', 'buildModuleUrl resolved', resolvedBase);

  // GPU 3D 파고 기본 — ?material=1 이면 Material 2a (평면) 강제
  // ?debugObstacles=1 → 장애물 색상 오버레이 (red/orange/yellow/blue)
  const urlParams      = new URLSearchParams(globalThis.location?.search ?? '');
  const useGpu         = !urlParams.has('material');
  const debugObstacles = urlParams.has('debugObstacles');
  log('cesium-import', 'ocean mode', useGpu ? 'GPU 2b (3D 파고)' : 'Material 2a (?material=1)', {
    debugObstacles,
    envViteGpuOcean: import.meta.env.VITE_GPU_OCEAN,
  });

  const oceanImport = useGpu
    ? import('../../../adapters/cesium/GerstnerWaterPrimitiveGPU.js')
    : import('../../../adapters/cesium/GerstnerWaterPrimitive.js');

  const [
    oceanModule,
    { FloatingEntity },
    { WakeRegistry },
    { ObstacleRegistry },
  ] = await Promise.all([
    oceanImport,
    import('../../../adapters/cesium/FloatingEntity.js'),
    import('../../../adapters/cesium/WakeRegistry.js'),
    import('../../../adapters/cesium/ObstacleRegistry.js'),
  ]);

  const GerstnerWaterPrimitive = useGpu
    ? oceanModule.GerstnerWaterPrimitiveGPU
    : oceanModule.GerstnerWaterPrimitive;

  return { Cesium, GerstnerWaterPrimitive, FloatingEntity, WakeRegistry, ObstacleRegistry, useGpu, debugObstacles };
}

/** @type {Record<string, unknown>} */
const runtime = {};

/**
 * @param {number} waves
 * @returns {number}
 */
function sumWaveAmplitude(waves) {
  return waves.reduce((s, w) => s + (w.amplitude ?? 0), 0);
}

/**
 * @param {{
 *   ocean: { setAmplitudeScale: (n: number) => void, amplitudeScale?: number },
 *   viewer: import('cesium').Viewer,
 *   baseAmplitudeM: number,
 *   sceneEditor?: import('../../../adapters/cesium/SceneEditor.js').SceneEditor,
 * }} ctx
 */
function setupWaveHeightSlider(ctx) {
  const slider = document.getElementById('waveScaleSlider');
  const heightEl = document.getElementById('waveScaleValue');
  const subEl = document.getElementById('waveScaleSub');
  if (!slider || !heightEl) return;

  /** @param {number} scale */
  const applyScale = (scale) => {
    ctx.ocean.setAmplitudeScale(scale);
    const heightM = ctx.baseAmplitudeM * scale;
    heightEl.textContent = `${heightM.toFixed(1)} m`;
    if (subEl) subEl.textContent = `배율 ${scale.toFixed(2)}×`;
    runtime.waveScale = scale;
    runtime.waveHeightM = heightM;
    ctx.sceneEditor?.refreshOverflow();
    ctx.viewer.scene.requestRender();
  };

  slider.addEventListener('input', () => {
    applyScale(Number(slider.value));
  });

  applyScale(Number(slider.value));
}

/**
 * Phase 5: 홍수 시뮬레이션 UI 컨트롤 바인딩
 *
 * @param {{ floodLayer: import('../../../adapters/cesium/FloodLayer.js').FloodLayer|null, viewer: import('cesium').Viewer }} ctx
 */
function setupFloodControls({ floodLayer, viewer, sceneEditor }) {
  if (!floodLayer) {
    const sec = document.getElementById('floodSection');
    if (sec) sec.style.display = 'none';
    return;
  }

  const btnStart  = document.getElementById('btnFloodStart');
  const btnReset  = document.getElementById('btnFloodReset');
  const rateSlider = document.getElementById('floodRateSlider');
  const rateVal   = document.getElementById('floodRateValue');
  const blendSlider = document.getElementById('floodBlendSlider');
  const blendVal  = document.getElementById('floodBlendValue');
  const statusEl  = document.getElementById('floodStatus');

  const updateStatus = () => {
    if (!statusEl) return;
    statusEl.textContent = floodLayer.active
      ? `🌊 시뮬레이션 중 — 유입 ${floodLayer.inflowHeight.toFixed(1)} m`
      : '⏸ 대기 — ▶ 시작을 눌러 홍수 시작';
  };

  if (btnStart) {
    btnStart.addEventListener('click', () => {
      if (floodLayer.active) {
        floodLayer.pause();
        btnStart.textContent = '▶ 시작';
      } else {
        floodLayer.start();
        btnStart.textContent = '⏸ 일시정지';
      }
      updateStatus();
      sceneEditor?.refreshOverflow();
      viewer.scene.requestRender();
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      floodLayer.reset();
      if (btnStart) btnStart.textContent = '▶ 시작';
      updateStatus();
      sceneEditor?.refreshOverflow();
    });
  }

  if (rateSlider) {
    rateSlider.addEventListener('input', () => {
      const h = Number(rateSlider.value);
      floodLayer.setInflowHeight(h);
      if (rateVal) rateVal.textContent = `${h.toFixed(1)} m`;
      viewer.scene.requestRender();
    });
    // 초기값 표시
    if (rateVal) rateVal.textContent = `${Number(rateSlider.value).toFixed(1)} m`;
  }

  if (blendSlider) {
    blendSlider.addEventListener('input', () => {
      const b = Number(blendSlider.value);
      floodLayer.setBlend(b);
      if (blendVal) blendVal.textContent = b.toFixed(2);
      viewer.scene.requestRender();
    });
    if (blendVal) blendVal.textContent = Number(blendSlider.value).toFixed(2);
  }

  updateStatus();
}

async function boot() {
  log(0, 'boot start', { readyState: document.readyState });

  await waitForDom();
  log(1, 'DOM ready');

  const overlay = document.getElementById('overlay');
  setOverlay(overlay, 'DOM 준비됨 — Cesium 자산 확인 중…');

  const baseUrl = ensureCesiumBaseUrl();
  log(2, 'CESIUM_BASE_URL', baseUrl);

  const assetCheck = await verifyCesiumAssets(baseUrl);
  if (!assetCheck.ok) {
    setOverlay(
      overlay,
      `<b>Cesium 자산 로드 실패 (404)</b><br>` +
      `경로: <code>${baseUrl}</code><br>` +
      assetCheck.failures.map((f) => `<code>${f}</code>`).join('<br>') +
      `<br>dev 서버 재시작 후 Network 탭 확인`,
    );
    return;
  }

  try {
    setOverlay(overlay, 'Cesium 모듈 로드 중…');
    const { Cesium, GerstnerWaterPrimitive, FloatingEntity, WakeRegistry, ObstacleRegistry, useGpu, debugObstacles } =
      await loadCesiumRuntime(baseUrl);

    const container = document.getElementById('cesiumContainer');
    if (!container) {
      throw new Error('#cesiumContainer 요소가 없습니다. index.html을 확인하세요.');
    }
    log(3, 'container ready', {
      width: container.clientWidth,
      height: container.clientHeight,
    });

    setOverlay(overlay, 'Cesium Viewer 생성 중…');

    log(4, 'Ion token', (import.meta.env.CESIUM_ION_TOKEN || import.meta.env.VITE_CESIUM_ION_TOKEN)
      ? 'loaded from env'
      : 'placeholder — NaturalEarthII imagery 사용');

    const viewer = await createViewer(Cesium, baseUrl, container);
    runtime.viewer = viewer;
    runtime.useGpu = useGpu;
    log(5, 'Viewer created', {
      cesiumBase: Cesium.buildModuleUrl?.getCesiumBaseUrl?.()?.url,
      gpuOcean: useGpu,
    });

    setOverlay(overlay, 'Viewer 생성 완료 — 설정 로드 중…');

    log(7, 'loading configs');
    const config       = loadWavesConfig(wavesJson);
    const sceneCfg     = loadSceneConfig(sceneJson);
    const iCfg         = loadInteractionConfig(interactionJson);
    const obstaclesCfg = loadObstaclesConfig(obstaclesJson);
    const floodCfg     = loadFloodConfig(floodJson);
    log(7, 'configs loaded', {
      waves:     config.waves.length,
      scene:     sceneCfg.name,
      obstacles: obstaclesCfg.obstacles.length,
      floodGrid: `${Math.ceil(floodCfg.grid.widthM/floodCfg.grid.cellSizeM)}×${Math.ceil(floodCfg.grid.depthM/floodCfg.grid.cellSizeM)}`,
    });

    // Phase 4: ENU AABB 배열 사전 계산 (ocean primitive 생성 전에 필요)
    const enuBoxes = obstacleBodiesToBoxes(
      obstaclesCfg.obstacles,
      sceneCfg.anchor.lon,
      sceneCfg.anchor.lat,
    );
    log(7, 'obstacle ENU boxes', enuBoxes.map(b =>
      `${b.id}: E=${b.centerE.toFixed(0)} N=${b.centerN.toFixed(0)} halfE=${b.halfE.toFixed(0)} halfN=${b.halfN.toFixed(0)}`
    ));

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        sceneCfg.camera.lon,
        sceneCfg.camera.lat,
        sceneCfg.camera.heightM,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(sceneCfg.camera.headingDeg),
        pitch:   Cesium.Math.toRadians(sceneCfg.camera.pitchDeg),
        roll:    0,
      },
    });
    log(6, 'camera set', sceneCfg.camera);
    bindCameraPresets(viewer, Cesium, sceneCfg.camera);

    // World terrain 은 수면 primitive 를 가릴 수 있어 ellipsoid 유지

    setOverlay(overlay, 'Gerstner 수면 생성 중…');
    log(8, useGpu ? 'GerstnerWaterPrimitiveGPU' : 'GerstnerWaterPrimitive');
    const deepRgb    = sceneCfg.oceanColors?.deep    ?? [0.05, 0.13, 0.16, 0.58];
    const shallowRgb = sceneCfg.oceanColors?.shallow ?? [0.10, 0.28, 0.30, 0.52];

    const ocean = new GerstnerWaterPrimitive(viewer, config.waves, {
      lon0:       sceneCfg.anchor.lon,
      lat0:       sceneCfg.anchor.lat,
      alt0:       sceneCfg.anchor.altM,
      coastAlignment: sceneCfg.coast,
      resolution: sceneCfg.coast.resolution,
      deepColor:    new Cesium.Color(deepRgb[0], deepRgb[1], deepRgb[2], deepRgb[3]),
      shallowColor: new Cesium.Color(shallowRgb[0], shallowRgb[1], shallowRgb[2], shallowRgb[3]),
      buoyancyIterations: config.ocean.buoyancyIterations,
      obstacleBoxes:  enuBoxes,       // Phase 4: 장애물 GPU 마스크
      debugObstacles: debugObstacles, // Phase 4: ?debugObstacles=1 색상 오버레이
    });
    runtime.ocean = ocean;
    log(8, 'ocean primitive added', { obstacleCount: enuBoxes.length });

    // Phase 4: ObstacleRegistry — Cesium Entity 시각화
    setOverlay(overlay, '장애물·차수벽 Entity 생성 중…');
    log(9, 'ObstacleRegistry');
    const obstacleRegistry = new ObstacleRegistry(
      viewer,
      obstaclesCfg,
      sceneCfg.anchor.lon,
      sceneCfg.anchor.lat,
      sceneCfg.anchor.altM,
    );
    runtime.obstacleRegistry = obstacleRegistry;
    log(9, 'obstacles added', obstacleRegistry.obstacleCount);

    const baseAmplitudeM = sumWaveAmplitude(config.waves);
    const initialBarriers = enuBoxes.filter((b) => b.type === 'flood_barrier');

    /** @type {import('../../../adapters/cesium/SceneEditor.js').SceneEditor | null} */
    let sceneEditor = null;
    if (useGpu && typeof ocean.updateObstacleBoxes === 'function') {
      sceneEditor = new SceneEditor({
        viewer,
        Cesium,
        ocean,
        obstacleRegistry,
        sceneCfg,
        baseAmplitudeM,
        initialBarriers,
      });
      runtime.sceneEditor = sceneEditor;
      log(9, 'SceneEditor ready', { barriers: initialBarriers.length });
    } else {
      const editorEl = document.getElementById('sceneEditor');
      if (editorEl) {
        editorEl.innerHTML = '<header><h2>장면 설정</h2><p>GPU 2b 모드에서만 사용 가능 (?material=1 제거)</p></header>';
      }
    }

    setupWaveHeightSlider({ ocean, viewer, baseAmplitudeM, sceneEditor });

    // ── Phase 5: FloodLayer ────────────────────────────────────────────────
    let floodLayer = null;
    if (useGpu) {
      log('flood', 'creating FloodLayer');
      const { ObstacleField } = await import('../../../core/math/ObstacleField.js');
      const obstField = new ObstacleField(enuBoxes);
      floodLayer = new FloodLayer(viewer, floodCfg, obstField);

      // ocean.connectFlood: FloodLayer → 2D height field (a_floodH)
      if (typeof ocean.connectFlood === 'function') {
        ocean.connectFlood(floodLayer);
        log('flood', 'FloodLayer connected to ocean (2D height field)');
      }
      runtime.floodLayer = floodLayer;
      sceneEditor?.setFloodLayer(floodLayer);
    }

    setupFloodControls({ floodLayer, viewer, sceneEditor });

    log(9, 'WakeRegistry');
    const registry = new WakeRegistry(viewer, iCfg);
    registry.connectOcean(ocean);
    runtime.registry = registry;
    log(9, 'wake registry connected');

    setOverlay(overlay, '부유 Entity 바인딩 중…');
    log(10, 'FloatingEntity — ship');

    const shipEntity = viewer.entities.add({
      name: '선박',
      box: {
        dimensions: new Cesium.Cartesian3(30, 10, 60),
        material:   new Cesium.ColorMaterialProperty(new Cesium.Color(1.0, 0.4, 0.1, 1.0)),
      },
      label: {
        text:  '선박',
        font:  '14pt sans-serif',
        fillColor: Cesium.Color.WHITE,
        pixelOffset: new Cesium.Cartesian2(0, -50),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    const shipPos = sceneCfg.entities?.ship ?? {};
    const ship = new FloatingEntity(
      viewer, shipEntity, ocean.plane, ocean.gerstnerSolver,
      {
        lon: shipPos.lon ?? sceneCfg.anchor.lon - 0.038,
        lat: shipPos.lat ?? sceneCfg.anchor.lat - 0.005,
        offsetAlt: shipPos.offsetAlt ?? 5,
        tiltStrength: 0.10,
        wakeRegistry: registry,
        wakeStrength: 0.5,
        wakeRadiusM:  30,
      },
    );
    runtime.ship = ship;
    log(10, 'ship bound');

    log(11, 'FloatingEntity — buoy');
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

    const buoyPos = sceneCfg.entities?.buoy ?? {};
    const buoy = new FloatingEntity(
      viewer, buoyEntity, ocean.plane, ocean.gerstnerSolver,
      {
        lon: buoyPos.lon ?? sceneCfg.anchor.lon - 0.021,
        lat: buoyPos.lat ?? sceneCfg.anchor.lat - 0.013,
        offsetAlt: buoyPos.offsetAlt ?? 1.5,
        tiltStrength: 0.18,
      },
    );
    runtime.buoy = buoy;
    log(11, 'buoy bound');

    setOverlay(
      overlay,
      `<b>Gerstner Wave — Cesium</b><br>렌더 루프 대기 중…`,
    );

    let firstFrame = false;
    viewer.scene.postRender.addEventListener(() => {
      if (!firstFrame) {
        firstFrame = true;
        log(12, 'first frame rendered');
      }
    });

    let _lastFrameMs = performance.now();
    let _lastOverflowMs = 0;
    viewer.scene.preRender.addEventListener(() => {
      // ── FloodLayer tick ─────────────────────────────────────────────────
      const nowMs  = performance.now();
      const dtReal = Math.min((nowMs - _lastFrameMs) / 1000, 0.1);
      _lastFrameMs = nowMs;
      floodLayer?.tick(dtReal);

      if (floodLayer?.active && sceneEditor && nowMs - _lastOverflowMs > 1000) {
        _lastOverflowMs = nowMs;
        sceneEditor.refreshOverflow();
      }

      if (!overlay) return;
      try {
        const scale = Number(runtime.waveScale ?? ocean.amplitudeScale ?? 1);
        const heightM = Number(runtime.waveHeightM ?? baseAmplitudeM * scale);
        const surgeM = ocean.getSurgeLevelM?.() ?? ocean.baseWaterLevelM ?? 0;
        const overflowN = obstacleRegistry.getFloodBarriers?.()
          .filter((b) => (ocean.getSurgeAt?.(b.centerE, b.centerN) ?? surgeM) > b.heightM).length ?? 0;

        const floodStatus = floodLayer
          ? (floodLayer.active
              ? `🌊 유입 ${floodLayer.inflowHeight.toFixed(1)} m`
              : '⏸ 대기')
          : '';

        overlay.innerHTML =
          `<b>Gerstner Wave — Cesium</b><br>` +
          `장면 : ${sceneCfg.name}<br>` +
          `모드 : ${useGpu ? 'GPU 2b (3D)' : 'Material 2a (평면·<a href="?" style="color:#9cf">GPU로</a>)'}<br>` +
          `파고 : <b>${heightM.toFixed(1)} m</b> (${scale.toFixed(2)}×) · ` +
          `surge : <b>${surgeM.toFixed(1)} m</b><br>` +
          `차수벽 : ${obstacleRegistry.floodBarrierCount ?? 0}개 · ` +
          `<b style="color:${overflowN ? '#f66' : '#6f6'}">` +
          `${overflowN ? `⚠ ${overflowN}개 넘침` : '✓ 차단'}</b><br>` +
          (floodStatus ? `홍수 : <b style="color:#7ee8ff">${floodStatus}</b><br>` : '') +
          `시간 : ${ocean.currentTime.toFixed(1)} s · ` +
          `장애물 : ${obstacleRegistry.obstacleCount}개<br>` +
          `<small>우측 패널에서 범위·벽·홍수 설정</small>`;
      } catch (err) {
        console.error(`${TAG} preRender overlay error:`, err);
      }
    });
    log(12, 'preRender listener registered');

    viewer.scene.requestRender();
    log(13, 'init complete — requestRender() called');

    setTimeout(() => {
      if (!firstFrame) {
        log('WARN', 'no frame after 5s — Network 탭에서 /cesium/ 404 확인');
        setOverlay(
          overlay,
          `<b>렌더 루프 미시작</b><br>` +
          `Cesium Workers: <code>${baseUrl}</code><br>` +
          `F12 → Network → 필터 <code>cesium</code> → 404 확인`,
        );
      }
    }, 5000);

  } catch (err) {
    console.error(`${TAG} FATAL:`, err);
    setOverlay(
      overlay,
      `<b>초기화 오류</b><br>${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

log('import', 'entry module loaded — starting boot()');
boot();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    runtime.ship?.destroy?.();
    runtime.buoy?.destroy?.();
    runtime.registry?.destroy?.();
    runtime.sceneEditor?.destroy?.();
    runtime.obstacleRegistry?.destroy?.();
    runtime.floodLayer?.destroy?.();
    runtime.ocean?.destroy?.();
    runtime.viewer?.destroy?.();
  });
}
