/**
 * SceneEditor.js — 물 범위·차수벽 배치·overflow 확인 UI
 *
 * @module adapters/cesium/SceneEditor
 */

import {
  lonLatToEnu,
  makeFloodBarrierBox,
  obstacleBoxToBody,
} from '../../core/types/ObstacleTypes.js';
import { MAX_OBSTACLES } from '../../core/math/ObstacleField.js';

const DEFAULT_BARRIER = {
  halfE:   120,
  halfN:   30,
  heightM: 3.5,
};

/**
 * @param {import('../../core/types/ObstacleTypes.js').ObstacleBox[]} initialBarriers
 */
function cloneBarriers(initialBarriers) {
  return initialBarriers.map((b, i) => ({
    ...b,
    id: b.id || `barrier-${i + 1}`,
    type: 'flood_barrier',
  }));
}

export class SceneEditor {
  /**
   * @param {{
   *   viewer: import('cesium').Viewer,
   *   Cesium: typeof import('cesium'),
   *   ocean: import('./GerstnerWaterPrimitiveGPU.js').GerstnerWaterPrimitiveGPU,
   *   obstacleRegistry: import('./ObstacleRegistry.js').ObstacleRegistry,
   *   sceneCfg: import('../../core/types/SceneTypes.js').SceneConfig,
   *   baseAmplitudeM: number,
   *   initialBarriers?: import('../../core/types/ObstacleTypes.js').ObstacleBox[],
   * }} ctx
   */
  constructor(ctx) {
    this._viewer            = ctx.viewer;
    this._Cesium            = ctx.Cesium;
    this._ocean             = ctx.ocean;
    this._registry          = ctx.obstacleRegistry;
    this._sceneCfg          = ctx.sceneCfg;
    this._baseAmplitudeM    = ctx.baseAmplitudeM;
    this._anchorLon         = ctx.sceneCfg.anchor.lon;
    this._anchorLat         = ctx.sceneCfg.anchor.lat;

    /** @type {import('../../core/types/ObstacleTypes.js').ObstacleBox[]} */
    this._barriers = cloneBarriers(ctx.initialBarriers ?? []);
    this._nextNum  = this._barriers.reduce((m, b) => {
      const n = Number(String(b.id).replace(/\D/g, '')) || 0;
      return Math.max(m, n);
    }, 0) + 1;

    this._placing = false;
    this._coast   = { ...ctx.sceneCfg.coast };

    this._bindDom();
    this._setupClickHandler();
    this._syncAll();
  }

  _bindDom() {
    this._els = {
      placeBtn:      /** @type {HTMLButtonElement} */ (document.getElementById('btnPlaceBarrier')),
      cancelPlace:   /** @type {HTMLButtonElement} */ (document.getElementById('btnCancelPlace')),
      barrierList:   document.getElementById('barrierList'),
      overflowPanel: document.getElementById('overflowStatus'),
      offshore:      /** @type {HTMLInputElement} */ (document.getElementById('coastOffshore')),
      landward:      /** @type {HTMLInputElement} */ (document.getElementById('coastLandward')),
      along:         /** @type {HTMLInputElement} */ (document.getElementById('coastAlong')),
      waveScale:     /** @type {HTMLInputElement} */ (document.getElementById('waveScaleSlider')),
      waveValue:     document.getElementById('waveScaleValue'),
      waveSub:       document.getElementById('waveScaleSub'),
      baseLevel:     /** @type {HTMLInputElement} */ (document.getElementById('baseWaterLevel')),
      baseLevelVal:  document.getElementById('baseWaterLevelValue'),
      exportBtn:     /** @type {HTMLButtonElement} */ (document.getElementById('btnExportConfig')),
      placeHint:     document.getElementById('placeHint'),
    };

    if (this._els.offshore) {
      this._els.offshore.value = String(this._coast.offshoreM);
      this._els.landward.value = String(this._coast.landwardM);
      this._els.along.value    = String(this._coast.alongCoastM);
      this._bindCoastInput(this._els.offshore, 'offshoreM', 100, 8000);
      this._bindCoastInput(this._els.landward, 'landwardM', 20, 800);
      this._bindCoastInput(this._els.along, 'alongCoastM', 400, 10000);
    }

    this._els.placeBtn?.addEventListener('click', () => this._setPlacing(true));
    this._els.cancelPlace?.addEventListener('click', () => this._setPlacing(false));
    this._els.exportBtn?.addEventListener('click', () => this._exportConfig());

    if (this._els.baseLevel) {
      this._els.baseLevel.addEventListener('input', () => {
        const v = Number(this._els.baseLevel.value);
        if (this._els.baseLevelVal) {
          this._els.baseLevelVal.textContent = `${v.toFixed(1)} m`;
        }
        this._ocean.setBaseWaterLevel?.(v);
        this._updateOverflow();
        this._viewer.scene.requestRender();
      });
    }
  }

  /**
   * @param {HTMLInputElement} el
   * @param {'offshoreM'|'landwardM'|'alongCoastM'} key
   * @param {number} min
   * @param {number} max
   */
  _bindCoastInput(el, key, min, max) {
    const label = el.closest('.field')?.querySelector('.field-val');
    const apply = () => {
      const v = Math.max(min, Math.min(max, Number(el.value)));
      el.value = String(v);
      this._coast[key] = v;
      if (label) label.textContent = `${v} m`;
      this._ocean.updateCoastAlignment?.({
        ...this._coast,
        alongCoastBearingDeg: this._sceneCfg.coast.alongCoastBearingDeg,
        offshoreBearingDeg:   this._sceneCfg.coast.offshoreBearingDeg,
        resolution:           this._sceneCfg.coast.resolution,
      });
      this._updateOverflow();
    };
    el.addEventListener('input', apply);
    apply();
  }

  _setupClickHandler() {
    this._handler = new this._Cesium.ScreenSpaceEventHandler(this._viewer.scene.canvas);
    this._handler.setInputAction((click) => {
      if (!this._placing) return;
      const cart = this._pickLonLat(click.position);
      if (!cart) return;
      this._addBarrierAt(cart.lon, cart.lat);
      this._setPlacing(false);
    }, this._Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  /**
   * @param {import('cesium').Cartesian2} screenPos
   * @returns {{ lon: number, lat: number } | null}
   */
  _pickLonLat(screenPos) {
    const ray = this._viewer.camera.getPickRay(screenPos);
    if (!ray) return null;
    const pos = this._viewer.scene.globe.pick(ray, this._viewer.scene);
    if (!pos) return null;
    const carto = this._Cesium.Cartographic.fromCartesian(pos);
    return {
      lon: this._Cesium.Math.toDegrees(carto.longitude),
      lat: this._Cesium.Math.toDegrees(carto.latitude),
    };
  }

  /**
   * @param {number} lon
   * @param {number} lat
   */
  _addBarrierAt(lon, lat) {
    if (this._barriers.length >= MAX_OBSTACLES) {
      alert(`차수벽은 최대 ${MAX_OBSTACLES}개까지 배치할 수 있습니다.`);
      return;
    }
    const { eastM, northM } = lonLatToEnu(lon, lat, this._anchorLon, this._anchorLat);
    const id = `barrier-${this._nextNum++}`;
    this._barriers.push(makeFloodBarrierBox(
      id,
      DEFAULT_BARRIER.heightM,
      eastM,
      northM,
      DEFAULT_BARRIER.halfE,
      DEFAULT_BARRIER.halfN,
    ));
    this._syncAll();
  }

  _setPlacing(on) {
    this._placing = on;
    if (this._els.placeBtn) {
      this._els.placeBtn.classList.toggle('active', on);
      this._els.placeBtn.textContent = on ? '지도를 클릭하세요…' : '+ 클릭 위치에 차수벽';
    }
    if (this._els.cancelPlace) {
      this._els.cancelPlace.hidden = !on;
    }
    if (this._els.placeHint) {
      this._els.placeHint.hidden = !on;
    }
    this._viewer.scene.canvas.style.cursor = on ? 'crosshair' : '';
  }

  _syncAll() {
    this._registry.setFloodBarriers(this._barriers);
    this._ocean.updateObstacleBoxes?.(this._registry.getEnuBoxes());
    this._renderBarrierList();
    this._updateOverflow();
    this._viewer.scene.requestRender();
  }

  _renderBarrierList() {
    const list = this._els.barrierList;
    if (!list) return;
    list.innerHTML = '';

    if (this._barriers.length === 0) {
      list.innerHTML = '<p class="empty">차수벽 없음 — 위 버튼으로 배치</p>';
      return;
    }

    this._barriers.forEach((barrier, idx) => {
      const num = idx + 1;
      const card = document.createElement('div');
      card.className = 'barrier-card';
      card.dataset.id = barrier.id;

      card.innerHTML = `
        <div class="barrier-head">
          <strong>차수벽 #${num}</strong>
          <button type="button" class="btn-del" title="삭제">×</button>
        </div>
        <div class="grid2">
          <label>동(E) m<input type="number" step="5" data-k="centerE" value="${barrier.centerE.toFixed(0)}" /></label>
          <label>북(N) m<input type="number" step="5" data-k="centerN" value="${barrier.centerN.toFixed(0)}" /></label>
          <label>길이(E) m <small>(벽만 · 물 범위와 별개)</small><input type="number" step="10" min="20" data-k="halfE" value="${(barrier.halfE * 2).toFixed(0)}" /></label>
          <label>두께(N) m<input type="number" step="5" min="10" data-k="halfN" value="${(barrier.halfN * 2).toFixed(0)}" /></label>
          <label class="span2">높이 m<input type="number" step="0.5" min="0.5" data-k="heightM" value="${barrier.heightM.toFixed(1)}" /></label>
        </div>
      `;

      card.querySelector('.btn-del')?.addEventListener('click', () => {
        this._barriers = this._barriers.filter((b) => b.id !== barrier.id);
        this._syncAll();
      });

      for (const input of card.querySelectorAll('input')) {
        input.addEventListener('change', () => {
          const k = input.dataset.k;
          let v = Number(input.value);
          if (!k || !Number.isFinite(v)) return;
          if (k === 'halfE' || k === 'halfN') v *= 0.5;
          /** @type {Record<string, number>} */ (barrier)[k] = v;
          this._syncAll();
        });
      }

      list.appendChild(card);
    });
  }

  _applyWaveHeight() {
    const scale = Number(this._els.waveScale?.value ?? 1);
    this._ocean.setAmplitudeScale(scale);
    const heightM = this._baseAmplitudeM * scale;
    if (this._els.waveValue) this._els.waveValue.textContent = `${heightM.toFixed(1)} m`;
    if (this._els.waveSub) this._els.waveSub.textContent = `배율 ${scale.toFixed(2)}×`;
    this._updateOverflow();
    this._viewer.scene.requestRender();
  }

  _updateOverflow() {
    const panel = this._els.overflowPanel;
    if (!panel) return;

    const waterM = this._ocean.getEffectiveWaterHeightM?.()
      ?? (this._baseAmplitudeM * (this._ocean.amplitudeScale ?? 1));

    const overflowIds = [];
    const coastAlong = this._coast.alongCoastM ?? 6500;
    const lines = this._barriers.map((b, i) => {
      const over = waterM > b.heightM;
      if (over) overflowIds.push(b.id);
      const margin = waterM - b.heightM;
      const protectedM = b.halfE * 2;
      const gapM = Math.max(0, coastAlong - protectedM);
      const cls = over ? 'over' : 'safe';
      const icon = over ? '⚠ 넘침' : '✓ 차단';
      const gapNote = gapM > 20
        ? ` · 양끝 미보호 ${(gapM * 0.5).toFixed(0)}m×2`
        : '';
      return `<div class="overflow-row ${cls}">
        <span>#${i + 1} (${b.heightM.toFixed(1)}m 벽 · 보호폭 ${protectedM.toFixed(0)}m)</span>
        <span>${icon} · 수면 ${waterM.toFixed(1)}m (${margin >= 0 ? '+' : ''}${margin.toFixed(1)}m)${gapNote}</span>
      </div>`;
    });

    this._registry.setOverflowState(overflowIds);

    panel.innerHTML = lines.length
      ? `<div class="overflow-summary ${overflowIds.length ? 'over' : 'safe'}">
           수면 ${waterM.toFixed(1)} m — ${overflowIds.length ? `${overflowIds.length}개 벽 넘침` : '모든 벽 차단'}
         </div>${lines.join('')}`
      : '<p class="empty">차수벽을 배치하면 넘침 여부가 표시됩니다.</p>';
  }

  _exportConfig() {
    const coast = {
      ...this._sceneCfg.coast,
      offshoreM:   this._coast.offshoreM,
      landwardM:   this._coast.landwardM,
      alongCoastM: this._coast.alongCoastM,
    };
    const obstacles = this._barriers.map((b) =>
      obstacleBoxToBody(b, this._anchorLon, this._anchorLat),
    );
    const payload = {
      scene: { coast },
      obstacles: { obstacles },
      runtime: {
        waveScale: Number(this._els.waveScale?.value ?? 1),
        baseWaterLevelM: Number(this._els.baseLevel?.value ?? 0),
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scene-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** 외부에서 파고 슬라이더 초기화 후 호출 */
  refreshOverflow() {
    this._updateOverflow();
  }

  destroy() {
    this._handler?.destroy();
    this._setPlacing(false);
  }
}
