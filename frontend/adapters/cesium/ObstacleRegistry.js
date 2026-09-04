/**
 * ObstacleRegistry.js — Phase 4 Cesium 장애물 시각화 + ENU 박스 관리
 *
 * 건물(building)은 JSON 고정, flood_barrier 는 SceneEditor 로 동적 추가·편집.
 *
 * @module adapters/cesium/ObstacleRegistry
 */

import * as Cesium from 'cesium';
import {
  obstacleFootprintToEnuBox,
  enuToLonLat,
} from '../../core/types/ObstacleTypes.js';

const OBSTACLE_COLORS = {
  // 차수벽은 불투명 — 반투명 Gerstner 수면(큰 파고) 뒤에 있어도 안 묻히도록
  flood_barrier:      new Cesium.Color(0.85, 0.60, 0.08, 1.0),
  flood_barrier_over: new Cesium.Color(0.95, 0.15, 0.12, 1.0),
  building:           new Cesium.Color(0.60, 0.62, 0.68, 0.90),
  custom:             new Cesium.Color(0.90, 0.28, 0.28, 0.82),
};

const OUTLINE_COLOR = Cesium.Color.WHITE.withAlpha(0.55);
const OUTLINE_OVER  = Cesium.Color.RED.withAlpha(0.85);

export class ObstacleRegistry {
  /**
   * @param {import('cesium').Viewer} viewer
   * @param {{ obstacles: import('../../core/types/ObstacleTypes.js').ObstacleBody[] }} obstaclesConfig
   * @param {number} anchorLon
   * @param {number} anchorLat
   * @param {number} [anchorAltM=0]
   */
  constructor(viewer, obstaclesConfig, anchorLon, anchorLat, anchorAltM = 0) {
    this._viewer     = viewer;
    this._anchorLon  = anchorLon;
    this._anchorLat  = anchorLat;
    this._anchorAltM = anchorAltM;

    /** @type {import('cesium').Entity[]} */
    this._buildingEntities = [];
    /** @type {import('cesium').Entity[]} */
    this._barrierEntities  = [];
    /** @type {import('../../core/types/ObstacleTypes.js').ObstacleBox[]} */
    this._buildingBoxes = [];
    /** @type {import('../../core/types/ObstacleTypes.js').ObstacleBox[]} */
    this._barrierBoxes  = [];
    /** @type {Set<string>} */
    this._overflowIds = new Set();

    const obstacles = obstaclesConfig?.obstacles ?? [];
    for (const obs of obstacles) {
      if (!obs.footprint || obs.footprint.length < 3) continue;
      const box = this._bodyToBox(obs);
      if (obs.type === 'flood_barrier') {
        this._barrierBoxes.push(box);
      } else {
        this._buildingBoxes.push(box);
        this._buildingEntities.push(this._createEntity(box));
      }
    }

    this._syncBarrierEntities();
  }

  /** @param {import('../../core/types/ObstacleTypes.js').ObstacleBody} obs */
  _bodyToBox(obs) {
    const aabb = obstacleFootprintToEnuBox(obs.footprint, this._anchorLon, this._anchorLat);
    return {
      id:      obs.id,
      type:    /** @type {'flood_barrier'|'building'|'custom'} */ (obs.type),
      heightM: obs.heightM,
      ...aabb,
    };
  }

  /** @param {import('../../core/types/ObstacleTypes.js').ObstacleBox} box */
  _createEntity(box, overflow = false) {
    const { lon: lonC, lat: latC } = enuToLonLat(
      box.centerE, box.centerN, this._anchorLon, this._anchorLat,
    );
    const centerAlt = this._anchorAltM + box.heightM * 0.5;
    const isBarrier = box.type === 'flood_barrier';
    const color = isBarrier && overflow
      ? OBSTACLE_COLORS.flood_barrier_over
      : (OBSTACLE_COLORS[box.type] ?? OBSTACLE_COLORS.custom);

    const numMatch = box.id.match(/(\d+)$/);
    const numLabel = numMatch ? `#${numMatch[1]}` : box.id;

    return this._viewer.entities.add({
      name: box.id,
      position: Cesium.Cartesian3.fromDegrees(lonC, latC, centerAlt),
      box: {
        dimensions: new Cesium.Cartesian3(box.halfE * 2, box.halfN * 2, box.heightM),
        material:     new Cesium.ColorMaterialProperty(color),
        outline:      true,
        outlineColor: new Cesium.ConstantProperty(overflow ? OUTLINE_OVER : OUTLINE_COLOR),
        outlineWidth: overflow ? 2.5 : 1.0,
      },
      label: {
        text: isBarrier ? `${numLabel} 차수벽\n${box.heightM.toFixed(1)}m` : `${box.id}\n(${box.type})`,
        font: '11pt sans-serif',
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        fillColor: overflow ? Cesium.Color.RED : Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -(box.heightM * 0.5 + 6)),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: isBarrier || box.type === 'flood_barrier',
      },
    });
  }

  _syncBarrierEntities() {
    for (const e of this._barrierEntities) {
      this._viewer.entities.remove(e);
    }
    this._barrierEntities = this._barrierBoxes.map((box) =>
      this._createEntity(box, this._overflowIds.has(box.id)),
    );
  }

  /**
   * 차수벽 목록을 교체하고 Entity·GPU 박스를 갱신합니다.
   * @param {import('../../core/types/ObstacleTypes.js').ObstacleBox[]} barriers
   */
  setFloodBarriers(barriers) {
    this._barrierBoxes = barriers.map((b) => ({ ...b, type: 'flood_barrier' }));
    this._syncBarrierEntities();
  }

  /** @returns {import('../../core/types/ObstacleTypes.js').ObstacleBox[]} */
  getFloodBarriers() {
    return this._barrierBoxes.map((b) => ({ ...b }));
  }

  /**
   * @param {Set<string>|string[]} overflowIds  넘침 상태인 차수벽 id
   */
  setOverflowState(overflowIds) {
    this._overflowIds = new Set(overflowIds);
    this._syncBarrierEntities();
  }

  /** GPU / CPU — 건물 + 차수벽 전체 */
  getEnuBoxes() {
    return [...this._buildingBoxes, ...this._barrierBoxes];
  }

  get obstacleCount() {
    return this._buildingBoxes.length + this._barrierBoxes.length;
  }

  get floodBarrierCount() {
    return this._barrierBoxes.length;
  }

  setVisible(visible) {
    for (const e of [...this._buildingEntities, ...this._barrierEntities]) {
      e.show = visible;
    }
  }

  destroy() {
    for (const e of [...this._buildingEntities, ...this._barrierEntities]) {
      this._viewer.entities.remove(e);
    }
    this._buildingEntities = [];
    this._barrierEntities  = [];
    this._buildingBoxes    = [];
    this._barrierBoxes     = [];
    this._overflowIds.clear();
  }
}
