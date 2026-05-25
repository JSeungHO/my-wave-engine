export { MAX_WAVES, loadWavesConfig }                              from './types/WaveTypes.js';
export { loadSceneConfig, coastalBoundsToDegrees, bearingToEnu } from './types/SceneTypes.js';
export { GerstnerWave }                                            from './math/GerstnerWave.js';

// Phase 2c — Wake 상호작용
export { MAX_WAKE_SOURCES, KNOTS_TO_MS,
         createWakeSource, packWakeSources,
         createCollisionBody,
         loadInteractionConfig }                                    from './types/InteractionTypes.js';
export { WakeField }                                               from './math/WakeField.js';

// Phase 4 — 장애물·차수벽
export { lonLatToEnu, enuToLonLat,
         obstacleFootprintToEnuBox, obstacleBodiesToBoxes,
         enuRectToFootprint, obstacleBoxToBody, makeFloodBarrierBox,
         loadObstaclesConfig }                                      from './types/ObstacleTypes.js';
export { MAX_OBSTACLES, ObstacleField }                            from './math/ObstacleField.js';

// Phase 5 — 2D 홍수 시뮬레이션
export { loadFloodConfig }                                         from './types/FloodTypes.js';
export { ShallowWater }                                            from './math/ShallowWater.js';
