uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uCameraPosition;

varying vec3  vWorldPos;
varying vec3  vNormal;
varying float vWaveHeight;

void main() {
  vec3  N       = normalize(vNormal);
  vec3  V       = normalize(uCameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float crest   = smoothstep(0.2, 0.9, vWaveHeight + 0.3);

  vec3 waterColor = mix(uDeepColor, uShallowColor, fresnel * 0.6 + crest * 0.2);
  gl_FragColor = vec4(waterColor, 0.92);
}
