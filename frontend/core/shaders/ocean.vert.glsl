#include "./gerstner.glsl"

uniform float uTime;
uniform int   uWaveCount;
uniform vec2  uWaveDirection[MAX_WAVES];
uniform float uWaveAmplitude[MAX_WAVES];
uniform float uWaveWavelength[MAX_WAVES];
uniform float uWaveSpeed[MAX_WAVES];
uniform float uWaveSteepness[MAX_WAVES];
uniform float uWavePhase[MAX_WAVES];

varying vec3  vWorldPos;
varying vec3  vNormal;
varying float vWaveHeight;

void main() {
  vec4 world   = modelMatrix * vec4(position, 1.0);
  vec2 worldXZ = world.xz;

  vec3 disp = gerstnerDisplacement(
    worldXZ, uTime, uWaveCount,
    uWaveDirection, uWaveAmplitude, uWaveWavelength,
    uWaveSpeed, uWaveSteepness, uWavePhase
  );

  float chop   = oceanMicroChop(worldXZ, uTime);
  vec2  chopG  = oceanMicroChopGrad(worldXZ, uTime);
  vec3 worldPos = world.xyz + disp + vec3(0.0, chop, 0.0);
  vWorldPos     = worldPos;
  vNormal       = gerstnerNormal(
    worldXZ, uTime, uWaveCount,
    uWaveDirection, uWaveAmplitude, uWaveWavelength,
    uWaveSpeed, uWaveSteepness, uWavePhase
  );
  vNormal = normalize(vNormal + vec3(-chopG.x * 2.8, 0.0, -chopG.y * 2.8));
  vWaveHeight = disp.y + chop;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
