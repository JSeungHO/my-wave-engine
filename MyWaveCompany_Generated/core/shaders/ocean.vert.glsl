#include "./gerstner.glsl"

uniform float uTime;
uniform int   uWaveCount;
uniform vec2  uWaveDirection[MAX_WAVES];
uniform float uWaveAmplitude[MAX_WAVES];
uniform float uWaveWavelength[MAX_WAVES];
uniform float uWaveSpeed[MAX_WAVES];
uniform float uWaveSteepness[MAX_WAVES];

varying vec3  vWorldPos;
varying vec3  vNormal;
varying float vWaveHeight;

void main() {
  vec4 world   = modelMatrix * vec4(position, 1.0);
  vec2 worldXZ = world.xz;

  vec3 disp = gerstnerDisplacement(
    worldXZ, uTime, uWaveCount,
    uWaveDirection, uWaveAmplitude, uWaveWavelength,
    uWaveSpeed, uWaveSteepness
  );

  vec3 worldPos = world.xyz + disp;
  vWorldPos     = worldPos;
  vNormal       = gerstnerNormal(
    worldXZ, uTime, uWaveCount,
    uWaveDirection, uWaveAmplitude, uWaveWavelength,
    uWaveSpeed, uWaveSteepness
  );
  vWaveHeight = disp.y;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
