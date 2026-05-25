/**
 * gen_wake.glsl  — 자동화 엔진 템플릿
 *
 * 대상: core/shaders/wake.glsl
 * 접두사: gen_ → Program.cs 가 생성, 직접 수정 금지
 *
 * Phase 3 에서 Program.cs 가 이 파일을 읽어
 *   interaction.json → {{maxWakeSources}} 등 변수 치환
 *   → core/shaders/wake.glsl 로 출력
 *
 * 템플릿 변수:
 *   {{maxWakeSources}}  interaction.json → wake.maxSources  (기본 16)
 *
 * 현재(Phase 2c) 는 core/shaders/wake.glsl 을 수동으로 유지합니다.
 *
 * @see 기획서.md §Templates/ 호환 구조
 * @see core/shaders/wake.glsl  실제 구현
 */

// TODO: Phase 3 — Program.cs 가 {{maxWakeSources}} 를 치환한 wake.glsl 을 생성합니다.

#define MAX_WAKE_SOURCES {{maxWakeSources}}

float wakeDisplacement(
  vec2  xz,
  vec4  wakeData[MAX_WAKE_SOURCES],
  vec4  wakeParams[MAX_WAKE_SOURCES],
  int   wakeCount,
  float decayTime,
  float minSpeed
) {
  // TODO: Phase 3 — core/math/WakeField.js 의 CPU 로직을 GLSL 로 변환
  return 0.0;
}
