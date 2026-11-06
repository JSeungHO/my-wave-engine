/**
 * tsunamiSwe.js — 쓰나미 얕은 물 방정식(Shallow Water Equations) GPU 셰이더 (GLSL ES 3.0)
 *
 * 상태 텍스처 (RGBA32F): r = h (수심), g = hu, b = hv (단위폭 유량), a = 0
 * 지형 텍스처 (RGBA32F): r = b (바닥·건물·벽 꼭대기 높이), g = ground, b = type, a = Manning n
 *
 * 수치 기법
 *   * 유한체적 1차 HLL 근사 리만 해법
 *   * 정수압 재구성 (Audusse et al. 2004) — 정지한 물이 계단 지형 위에서도 가만히 있고(well-balanced),
 *     수심이 음수가 되지 않으며(positivity), 젖음/마름 경계를 자연스럽게 처리
 *   * 벽·건물 = 높은 바닥. 물이 벽보다 낮으면 반사, 높으면 넘친다 → 규칙 판정이 아닌 계산 결과
 *   * Manning 마찰 (반암시적)
 *   * 앞바다 경계: 리만 불변량 기반 생성·흡수 경계 (들어오는 쓰나미는 넣고, 반사파는 내보냄)
 *   * 나머지 경계: 투과(transmissive)
 *
 * 실제 쓰나미 침수 계산 모델(GeoClaw, COMCOT, TUNAMI 등)과 같은 계열의 비선형 얕은 물 방정식이다.
 *
 * ## 설계 원칙
 * * `core/` 규칙 — 외부 라이브러리 import 금지. 문자열만 내보냄
 *
 * @module core/shaders/tsunamiSwe
 */

/** 앞바다 쓰나미 곡선 — core/math/TsunamiInflow.js etaIn() 과 같은 식 */
export const ETA_IN_GLSL = /* glsl */ `
uniform vec4 uTsu;      // amplitude, period, drawdown, secondWave
uniform float uTsuDelay;
float tsuGauss(float x, float c, float w){ float d = (x - c) / w; return exp(-d * d); }
float etaInAt(float t){
  float tau = t - uTsuDelay;
  if (tau <= 0.0) return 0.0;
  float T = uTsu.y;
  float ramp = smoothstep(0.0, 0.12 * T, tau);
  float down = -uTsu.z * tsuGauss(tau, 0.22 * T, 0.16 * T);
  float mainW = tsuGauss(tau, 0.72 * T, 0.2 * T);
  float second = uTsu.w * tsuGauss(tau, 1.75 * T, 0.24 * T);
  return uTsu.x * ramp * (down + mainW + second);
}
`;

/** 해안선 굴곡 — core/math/CoastTerrain.js shoreOffset() 와 같은 식 */
export const SHORE_OFFSET_GLSL = /* glsl */ `
float shoreOffset(float z){
  return 25.0 * sin(6.2831853 * z / 900.0) + 10.0 * sin(6.2831853 * z / 310.0 + 1.0);
}
/* 건물·벽 없는 땅 높이 — CoastTerrain.js groundHeight() 와 같은 식 (계산 영역 밖 배경용) */
float groundHeightXp(float xp){
  if (xp < 600.0) return -24.0 + 18.0 * (xp / 600.0);
  if (xp < 760.0) return -6.0 + 6.0 * ((xp - 600.0) / 160.0);
  if (xp < 815.0) return 2.6 * ((xp - 760.0) / 55.0);
  return 3.0 + 3.0 * clamp((xp - 815.0) / (1280.0 - 815.0), 0.0, 1.0);
}
`;

export const FULLSCREEN_VERT = /* glsl */ `
void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const COMMON = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
precision highp int;
precision highp sampler2D;
const float G = 9.81;
const float HEPS = 1e-3;
uniform ivec2 uSize;
uniform float uVmax;
vec2 velOf(vec4 s){
  if (s.x < HEPS) return vec2(0.0);
  vec2 u = s.yz / s.x;
  float m = length(u);
  if (m > uVmax) u *= uVmax / m;
  return u;
}
`;

/** 초기 상태: 평균 해수면(0 m) 아래만 물 */
export const SWE_INIT_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uTerrain;
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 tr = texelFetch(uTerrain, c, 0);
  float h = (tr.b > 6.5 && tr.b < 7.5) ? 0.0 : max(0.0, -tr.r);
  gl_FragColor = vec4(h, 0.0, 0.0, 0.0);
}
`;

/** 한 시간 단계 (forward Euler, CFL ≤ 0.3) */
export const SWE_STEP_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uState;
uniform sampler2D uTerrain;
uniform float uDt;
uniform float uDx;
uniform float uEtaIn;   // 이번 단계의 앞바다 수위

vec4 S(ivec2 c){ return texelFetch(uState, c, 0); }
float Bt(ivec2 c){ return texelFetch(uTerrain, c, 0).r; }

/* 이웃 셀 (경계면 유령 셀 포함) */
void neighbor(ivec2 c, ivec2 o, vec4 sc, float bc, out vec4 sn, out float bn){
  ivec2 n = c + o;
  if (n.x < 0) {
    // 생성·흡수 경계: 들어오는 리만 불변량 R+ 는 쓰나미 곡선으로, 나가는 R- 는 내부에서
    float H0 = max(-bc, 0.5);
    float hIn = max(H0 + uEtaIn, 0.01);
    float uIn = 2.0 * (sqrt(G * hIn) - sqrt(G * H0));
    float Rp = uIn + 2.0 * sqrt(G * hIn);
    vec2 u0 = velOf(sc);
    float Rm = u0.x - 2.0 * sqrt(G * max(sc.x, 0.0));
    float cg = max((Rp - Rm) * 0.25, 0.0);
    float ug = (Rp + Rm) * 0.5;
    float hg = cg * cg / G;
    sn = vec4(hg, hg * ug, hg * u0.y, 0.0);
    bn = bc;
    return;
  }
  if (n.x >= uSize.x || n.y < 0 || n.y >= uSize.y) { sn = sc; bn = bc; return; }
  sn = S(n);
  bn = Bt(n);
}

/* HLL 플럭스 (경계면 법선 좌표계): (질량, 법선 운동량, 접선 운동량) */
vec3 hll(float hL, float uL, float vL, float hR, float uR, float vR){
  if (hL < HEPS && hR < HEPS) return vec3(0.0);
  float cL = sqrt(G * hL), cR = sqrt(G * hR);
  float sL, sR;
  if (hL < HEPS)      { sL = uR - 2.0 * cR; sR = uR + cR; }
  else if (hR < HEPS) { sL = uL - cL;       sR = uL + 2.0 * cL; }
  else                { sL = min(uL - cL, uR - cR); sR = max(uL + cL, uR + cR); }
  vec3 FL = vec3(hL * uL, hL * uL * uL + 0.5 * G * hL * hL, hL * uL * vL);
  vec3 FR = vec3(hR * uR, hR * uR * uR + 0.5 * G * hR * hR, hR * uR * vR);
  if (sL >= 0.0) return FL;
  if (sR <= 0.0) return FR;
  vec3 UL = vec3(hL, hL * uL, hL * vL);
  vec3 UR = vec3(hR, hR * uR, hR * vR);
  return (sR * FL - sL * FR + sL * sR * (UR - UL)) / (sR - sL);
}

/* 셀에서 바깥 법선 nrm 방향 경계면으로 나가는 플럭스 (정수압 재구성 포함) */
vec3 faceFlux(vec4 sc, float bc, vec4 sn, float bn, vec2 nrm){
  float bf = max(bc, bn);
  float hc = max(0.0, sc.x + bc - bf);
  float hn = max(0.0, sn.x + bn - bf);
  vec2 uc = velOf(sc), un = velOf(sn);
  vec2 t = vec2(-nrm.y, nrm.x);
  vec3 F = hll(hc, dot(uc, nrm), dot(uc, t), hn, dot(un, nrm), dot(un, t));
  F.y += 0.5 * G * (sc.x * sc.x - hc * hc);
  vec2 mom = F.y * nrm + F.z * t;
  return vec3(F.x, mom);
}

void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 sc = S(c);
  vec4 tr = texelFetch(uTerrain, c, 0);
  if (tr.b > 6.5 && tr.b < 7.5) { gl_FragColor = vec4(0.0); return; } // 건물 내부
  float bc = tr.r;

  vec3 sum = vec3(0.0);
  vec4 sn; float bn;
  neighbor(c, ivec2( 1, 0), sc, bc, sn, bn); sum += faceFlux(sc, bc, sn, bn, vec2( 1.0, 0.0));
  neighbor(c, ivec2(-1, 0), sc, bc, sn, bn); sum += faceFlux(sc, bc, sn, bn, vec2(-1.0, 0.0));
  neighbor(c, ivec2( 0, 1), sc, bc, sn, bn); sum += faceFlux(sc, bc, sn, bn, vec2( 0.0, 1.0));
  neighbor(c, ivec2( 0,-1), sc, bc, sn, bn); sum += faceFlux(sc, bc, sn, bn, vec2( 0.0,-1.0));

  vec3 U = sc.xyz - (uDt / uDx) * sum;
  float h = max(U.x, 0.0);
  vec2 q = U.yz;
  if (h < 1e-4) {
    q = vec2(0.0);
  } else {
    float hf = max(h, 0.05);
    float sp = length(q) / hf;
    float cf = G * tr.a * tr.a / pow(hf, 1.0 / 3.0);
    q /= (1.0 + uDt * cf * sp / hf);
    float m = length(q) / hf;
    if (m > uVmax) q *= uVmax / m;
  }
  gl_FragColor = vec4(h, q, 0.0);
}
`;

/**
 * 거품·물보라·최대 침수 필드 (프레임마다 1회)
 * 출력 RGBA16F: r = 거품량 (이류·감쇠), g = 순간 물보라 세기, b = 최대 침수 깊이(육지), a = 최고 수위
 */
export const FOAM_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uState;
uniform sampler2D uTerrain;
uniform sampler2D uFoam;
uniform float uDtF;     // 이번 프레임 시뮬레이션 시간 (s)
uniform float uDx;
uniform float uReset;

vec4 Sx(ivec2 c){ c = clamp(c, ivec2(0), uSize - 1); return texelFetch(uState, c, 0); }
vec4 Tx(ivec2 c){ c = clamp(c, ivec2(0), uSize - 1); return texelFetch(uTerrain, c, 0); }
float etaOf(ivec2 c, float fallback){
  vec4 s = Sx(c); vec4 t = Tx(c);
  return s.x > 0.02 ? s.x + t.r : fallback;
}

void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 s = Sx(c); vec4 tr = Tx(c);
  float h = s.x;
  vec2 u = velOf(s);
  vec2 uv = (vec2(c) + 0.5) / vec2(uSize);
  vec4 prevHere = texelFetch(uFoam, c, 0);
  if (uReset > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, -100.0); return; }

  // 반라그랑주 이류: 물을 따라 거품이 흘러감
  vec2 back = uv - u * uDtF / uDx / vec2(uSize);
  float foamOld = texture(uFoam, back).r;

  // 수렴(파도 앞면), 수면 기울기, 유속
  vec2 uE = velOf(Sx(c + ivec2(1, 0))), uW = velOf(Sx(c - ivec2(1, 0)));
  vec2 uN = velOf(Sx(c + ivec2(0, 1))), uS = velOf(Sx(c - ivec2(0, 1)));
  float div = ((uE.x - uW.x) + (uN.y - uS.y)) / (2.0 * uDx);
  float eta = h + tr.r;
  float gx = (etaOf(c + ivec2(1, 0), eta) - etaOf(c - ivec2(1, 0), eta)) / (2.0 * uDx);
  float gz = (etaOf(c + ivec2(0, 1), eta) - etaOf(c - ivec2(0, 1), eta)) / (2.0 * uDx);
  float steep = length(vec2(gx, gz));
  float speed = length(u);

  // 지형 기울기 → 벽·건물에 부딪히는 세기
  float bE = Tx(c + ivec2(1, 0)).r, bW = Tx(c - ivec2(1, 0)).r;
  float bN = Tx(c + ivec2(0, 1)).r, bS = Tx(c - ivec2(0, 1)).r;
  vec2 gb = vec2(bE - bW, bN - bS) / (2.0 * uDx);
  float gbl = length(gb);
  float impact = gbl > 0.25 ? h * max(0.0, dot(u, gb / gbl)) * speed : 0.0;

  float src = 0.0;
  if (h > 0.03) {
    // 깊은 바다의 완만한 쓰나미는 거품이 없고, 앞면이 부서지는 곳·충돌·급류에서만 생김
    src = 0.55 * max(0.0, -div - 0.05) * min(h, 4.0)
        + 0.9 * max(0.0, steep - 0.12) * speed
        + 0.03 * max(0.0, speed - 6.0) * min(h, 3.0)
        + 0.03 * impact;
  }
  float foam = foamOld * exp(-uDtF / 4.5) + src * uDtF;
  if (h < 0.02) foam *= exp(-uDtF / 0.8);
  foam = min(foam, 2.5);

  float splash = impact + 0.35 * max(0.0, -div) * min(h, 5.0) * speed;

  bool land = tr.g > 0.5 && !(tr.b > 6.5 && tr.b < 7.5);
  float maxDepth = prevHere.b;
  if (land && h > 0.05) maxDepth = max(maxDepth, h);
  float maxEta = h > 0.05 ? max(prevHere.a, eta) : prevHere.a;

  gl_FragColor = vec4(foam, splash, maxDepth, maxEta);
}
`;

/**
 * CPU 읽기용 축소 (블록 BxB → 1 픽셀)
 * r = 블록 최대 물보라, g = 블록 침수 비율(육지), b = 블록 최대 침수 깊이(누적), a = 블록 최고 현재 수위
 */
export const REDUCE_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uState;
uniform sampler2D uTerrain;
uniform sampler2D uFoam;
uniform int uBlock;
void main(){
  ivec2 o = ivec2(gl_FragCoord.xy) * uBlock;
  float sp = 0.0, wet = 0.0, landCells = 0.0, md = 0.0, eta = -100.0;
  for (int y = 0; y < 8; y++) {
    if (y >= uBlock) break;
    for (int x = 0; x < 8; x++) {
      if (x >= uBlock) break;
      ivec2 c = min(o + ivec2(x, y), uSize - 1);
      vec4 s = texelFetch(uState, c, 0);
      vec4 t = texelFetch(uTerrain, c, 0);
      vec4 f = texelFetch(uFoam, c, 0);
      sp = max(sp, f.g);
      bool land = t.g > 0.5 && !(t.b > 6.5 && t.b < 7.5);
      if (land) { landCells += 1.0; if (s.x > 0.1) wet += 1.0; md = max(md, f.b); }
      if (s.x > 0.05) eta = max(eta, s.x + t.r);
    }
  }
  gl_FragColor = vec4(sp, landCells > 0.0 ? wet / landCells : 0.0, md, eta);
}
`;
