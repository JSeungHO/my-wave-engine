/**
 * glslUtil.js — 쓰나미 장면 셰이더 공용 조각 (노이즈, 하늘색, 안개)
 * @module adapters/three/tsunami/glslUtil
 */

/** GLSL3 출력 선언 (three r169 는 GLSL3 에서 gl_FragColor 를 정의하지 않음) */
export const FRAG_OUT = /* glsl */ `
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
`;

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
/* 노이즈 높이의 기울기 (상세 법선용) */
vec2 fbmGrad(vec2 p){
  float e = 0.35;
  return vec2(fbm(p + vec2(e, 0.0)) - fbm(p - vec2(e, 0.0)), fbm(p + vec2(0.0, e)) - fbm(p - vec2(0.0, e))) / (2.0 * e);
}
`;

/** 하늘 반사색 (Three Sky 와 비슷한 톤, 선형 색공간) */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
vec3 skyColor(vec3 r){
  float y = max(r.y, 0.0);
  vec3 horizon = vec3(0.62, 0.70, 0.78);
  vec3 zenith  = vec3(0.12, 0.28, 0.58);
  vec3 c = mix(horizon, zenith, pow(y, 0.45));
  float s = max(dot(r, uSunDir), 0.0);
  c += vec3(1.0, 0.85, 0.6) * (pow(s, 8.0) * 0.35 + pow(s, 64.0) * 0.6);
  return c;
}
`;

export const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
vec3 applyFog(vec3 col, vec3 world){
  float d = length(world - cameraPosition);
  float f = 1.0 - exp(-pow(d * uFogDensity, 1.6));
  return mix(col, uFogColor, clamp(f, 0.0, 1.0));
}
`;

/** 선형 → 화면 (톤매핑 + sRGB). three 의 렌더러 설정을 따른다 */
export const OUTPUT_GLSL = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;
