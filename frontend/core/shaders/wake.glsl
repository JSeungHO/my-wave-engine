/**
 * wake.glsl — GPU Wake(선박 尾迹) 변위 함수  (Task 2c-3)
 *
 * ## 역할
 *
 * GerstnerWaterPrimitiveGPU 의 버텍스 셰이더에서 `#include` 또는 인라인으로
 * Gerstner 변위 뒤에 추가되는 Wake disturbance 를 계산합니다.
 *
 * ## CPU 동등 구현
 *
 *   core/math/WakeField.js 와 동일한 물리 모델:
 *   - 확장하는 링 파도: ringR = speed × ageSec
 *   - Gaussian 진폭 엔벨로프
 *   - 방향성 V자 집중 (뒤쪽)
 *   - 지수 시간 감쇠
 *
 * ## uniform 레이아웃
 *
 *   u_wakeCount         int      활성 소스 수 (0 ~ MAX_WAKE_SOURCES)
 *   u_wakeData[N]       vec4[]   (x, z, vx, vz)    — 위치·속도 (ENU m, m/s)
 *   u_wakeParams[N]     vec4[]   (strength, radiusM, ageSec, _pad)
 *
 *   u_wakeDecayTimeSec  float    지수 감쇠 시간 상수 (초)
 *   u_wakeMinSpeedMs    float    최소 유효 속도 (m/s)
 *
 * ## 사용 예 (VS 인라인)
 *
 *   // Gerstner 변위 이후:
 *   float wakeH = wakeDisplacement(xz, u_wakeData, u_wakeParams, u_wakeCount,
 *                                  u_wakeDecayTimeSec, u_wakeMinSpeedMs);
 *   dispU += wakeH;
 *
 * @see core/math/WakeField.js           CPU 동등 구현 (동기화 유지)
 * @see adapters/cesium/GerstnerWaterPrimitiveGPU.js  (Task 2c-3) uniform 바인딩
 * @see adapters/cesium/WakeRegistry.js  WakeSource → uniform 패킹
 */

// ── 상수 ─────────────────────────────────────────────────────────────────────
#define MAX_WAKE_SOURCES 16

// ── 메인 함수 ────────────────────────────────────────────────────────────────
/**
 * 모든 활성 Wake 소스에 의한 수직 변위 합을 반환합니다.
 *
 * @param vec2 xz           ENU 로컬 위치 (East, North) m
 * @param vec4 wakeData[]   (x, z, vx, vz) per source
 * @param vec4 wakeParams[] (strength, radiusM, ageSec, _pad) per source
 * @param int  wakeCount    활성 소스 수
 * @param float decayTime   감쇠 시간 상수 (초)
 * @param float minSpeed    최소 유효 속도 (m/s)
 * @returns float           수직 변위 (m)
 */
float wakeDisplacement(
  vec2  xz,
  vec4  wakeData[MAX_WAKE_SOURCES],
  vec4  wakeParams[MAX_WAKE_SOURCES],
  int   wakeCount,
  float decayTime,
  float minSpeed
) {
  float total = 0.0;

  for (int i = 0; i < MAX_WAKE_SOURCES; i++) {
    if (i >= wakeCount) break;

    vec2  pos      = wakeData[i].xy;       // (x, z) ENU 로컬 m
    vec2  vel      = wakeData[i].zw;       // (vx, vz) m/s
    float strength = wakeParams[i].x;
    float radiusM  = wakeParams[i].y;
    float ageSec   = wakeParams[i].z;

    // 속도 크기
    float speed = length(vel);
    if (speed < minSpeed) continue;

    // 소스까지 상대 벡터
    vec2  d = xz - pos;
    float r = length(d) + 1e-4;

    // 방향성 가중치 (선박 뒤쪽 V자 집중)
    float dirDot = dot(d, vel) / (r * speed);  // -1 ~ +1
    float wakeDir = max(0.0, -dirDot);          // 뒤쪽만 > 0
    float dirW    = wakeDir * wakeDir;           // V자 첨두

    // 확장하는 링 파도
    float ringR  = speed * ageSec;
    float dr     = r - ringR;
    float sigma  = radiusM * 0.55;
    float env    = exp(-0.5 * (dr / sigma) * (dr / sigma));

    // 진동
    float k   = 6.28318530718 / (radiusM * 0.6);
    float osc = cos(k * dr);

    // 시간 감쇠
    float decay = exp(-ageSec / max(decayTime, 0.001));

    total += strength * env * osc * dirW * decay;
  }

  return total;
}
