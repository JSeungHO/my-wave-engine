#define MAX_WAVES 8

vec3 gerstnerDisplacement(
  vec2  worldXZ,
  float time,
  int   waveCount,
  vec2  directions[MAX_WAVES],
  float amplitudes[MAX_WAVES],
  float wavelengths[MAX_WAVES],
  float speeds[MAX_WAVES],
  float steepnesses[MAX_WAVES],
  float phases[MAX_WAVES]
) {
  vec3 disp = vec3(0.0);

  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= waveCount) break;

    float k     = 6.28318530718 / max(wavelengths[i], 0.001);
    float omega = speeds[i] * k;
    vec2  D     = directions[i];
    float phi   = k * dot(D, worldXZ) + omega * time + phases[i];
    float sinP  = sin(phi);
    float cosP  = cos(phi);

    disp.x += steepnesses[i] * amplitudes[i] * D.x * cosP;
    disp.z += steepnesses[i] * amplitudes[i] * D.y * cosP;
    disp.y += amplitudes[i] * sinP;
  }

  return disp;
}

// 비서로소 파장·위상 — 격자형 간섭 패턴 완화용 미세 chop
float oceanMicroChop(vec2 xz, float time) {
  float c1 = sin(xz.x * 0.127853 + xz.y * 0.091237 + time * 1.83) * 0.22;
  float c2 = sin(xz.x * 0.237641 - xz.y * 0.173529 + time * 2.41) * 0.15;
  float c3 = sin(xz.x * 0.319271 + xz.y * 0.271829 - time * 1.17) * 0.11;
  float c4 = sin(xz.x * 0.441029 - xz.y * 0.382117 + time * 3.07) * 0.08;
  vec2  np = xz * vec2(0.0317, 0.0273) + vec2(time * 0.09, time * 0.13);
  float n  = fract(sin(dot(floor(np), vec2(127.1, 311.7))) * 43758.5453);
  return c1 + c2 + c3 + c4 + (n - 0.5) * 0.45;
}

vec2 oceanMicroChopGrad(vec2 xz, float time) {
  const float eps = 0.55;
  float h0 = oceanMicroChop(xz, time);
  float hx = oceanMicroChop(xz + vec2(eps, 0.0), time) - h0;
  float hy = oceanMicroChop(xz + vec2(0.0, eps), time) - h0;
  return vec2(hx, hy) / eps;
}

vec3 gerstnerNormal(
  vec2  worldXZ,
  float time,
  int   waveCount,
  vec2  directions[MAX_WAVES],
  float amplitudes[MAX_WAVES],
  float wavelengths[MAX_WAVES],
  float speeds[MAX_WAVES],
  float steepnesses[MAX_WAVES],
  float phases[MAX_WAVES]
) {
  float sumNx = 0.0, sumNz = 0.0, sumNy = 0.0;

  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= waveCount) break;

    float k     = 6.28318530718 / max(wavelengths[i], 0.001);
    float omega = speeds[i] * k;
    vec2  D     = directions[i];
    float kA    = k * amplitudes[i];
    float phi   = k * dot(D, worldXZ) + omega * time + phases[i];
    float sinP  = sin(phi);
    float cosP  = cos(phi);

    sumNx += D.x * kA * cosP;
    sumNz += D.y * kA * cosP;
    sumNy += steepnesses[i] * kA * sinP;
  }

  return normalize(vec3(-sumNx, 1.0 - sumNy, -sumNz));
}
