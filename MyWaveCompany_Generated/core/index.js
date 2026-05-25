export { MAX_WAVES, loadWavesConfig }                              from './types/WaveTypes.js';
export { GerstnerWave }                                            from './math/GerstnerWave.js';

// Phase 2c — Wake 상호작용
export { MAX_WAKE_SOURCES, KNOTS_TO_MS,
         createWakeSource, packWakeSources,
         createCollisionBody,
         loadInteractionConfig }                                    from './types/InteractionTypes.js';
export { WakeField }                                               from './math/WakeField.js';
