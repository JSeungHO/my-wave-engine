#define MAX_WAVES 8

vec3 gerstnerDisplacement(
  vec2  worldXZ,
  float time,
  int   waveCount,
  vec2  directions[MAX_WAVES],
  float amplitudes[MAX_WAVES],
  float wavelengths[MAX_WAVES],
  float speeds[MAX_WAVES],
  float steepnesses[MAX_WAVES]
) {
  vec3 disp = vec3(0.0);

  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= waveCount) break;

    float k     = 6.28318530718 / max(wavelengths[i], 0.001);
    float omega = speeds[i] * k;
    vec2  D     = directions[i];
    float phi   = k * dot(D, worldXZ) + omega * time;
    float sinP  = sin(phi);
    float cosP  = cos(phi);

    disp.x += steepnesses[i] * amplitudes[i] * D.x * cosP;
    disp.z += steepnesses[i] * amplitudes[i] * D.y * cosP;
    disp.y += amplitudes[i] * sinP;
  }

  return disp;
}

vec3 gerstnerNormal(
  vec2  worldXZ,
  float time,
  int   waveCount,
  vec2  directions[MAX_WAVES],
  float amplitudes[MAX_WAVES],
  float wavelengths[MAX_WAVES],
  float speeds[MAX_WAVES],
  float steepnesses[MAX_WAVES]
) {
  float sumNx = 0.0, sumNz = 0.0, sumNy = 0.0;

  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= waveCount) break;

    float k     = 6.28318530718 / max(wavelengths[i], 0.001);
    float omega = speeds[i] * k;
    vec2  D     = directions[i];
    float kA    = k * amplitudes[i];
    float phi   = k * dot(D, worldXZ) + omega * time;
    float sinP  = sin(phi);
    float cosP  = cos(phi);

    sumNx += D.x * kA * cosP;
    sumNz += D.y * kA * cosP;
    sumNy += steepnesses[i] * kA * sinP;
  }

  return normalize(vec3(-sumNx, 1.0 - sumNy, -sumNz));
}
