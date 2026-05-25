uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uCameraPosition;

varying vec3  vWorldPos;
varying vec3  vNormal;
varying float vWaveHeight;

void main() {
  vec3  N       = normalize(vNormal);
  vec3  V       = normalize(uCameraPosition - vWorldPos);

  float n1 = fract(sin(dot(vWorldPos.xz * 0.11, vec2(12.9898, 78.233))) * 43758.5453);
  float n2 = fract(sin(dot(vWorldPos.xz * 0.17 + 3.7, vec2(39.3468, 11.1355))) * 43758.5453);
  N.x += (n1 - 0.5) * 0.50;
  N.z += (n2 - 0.5) * 0.50;
  N = normalize(N);

  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float irregular = 0.65 + 0.35 * (n1 * 0.55 + n2 * 0.45);

  float crest   = smoothstep(0.0, 1.3, vWaveHeight * irregular + 0.08);
  float foam    = smoothstep(0.55, 1.65, vWaveHeight * irregular + 0.14);

  vec3 waterColor = mix(uDeepColor, uShallowColor, fresnel * 0.62 + crest * 0.22);
  waterColor = mix(waterColor, vec3(0.93, 0.97, 1.0), foam * 0.55 * irregular);

  vec3 sunDir = normalize(vec3(0.35, 0.85, 0.4));
  vec3 H      = normalize(V + sunDir);
  float spec  = pow(max(dot(N, H), 0.0), 22.0) * irregular;
  waterColor += spec * 0.12;

  gl_FragColor = vec4(waterColor, mix(0.88, 0.98, foam));
}
