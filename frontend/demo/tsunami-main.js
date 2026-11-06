/**
 * tsunami-main.js — 쓰나미 실시간 시뮬레이션 데모 (/tsunami.html)
 *
 * URL 옵션: ?dx=4 (거친 격자, 느린 PC용) · ?cam=street|beach|side|aerial|orbit
 * 테스트용 전역: window.__tsunami (start, advance, setCamera, stats)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { buildCoastTerrain, applyWallHeight, COAST_LAYOUT, shoreOffset } from '../core/math/CoastTerrain.js';
import { DEFAULT_TSUNAMI } from '../core/math/TsunamiInflow.js';
import { SweSolverGPU } from '../adapters/three/tsunami/SweSolverGPU.js';
import { CoastScene } from '../adapters/three/tsunami/CoastScene.js';
import { WaterSurface } from '../adapters/three/tsunami/WaterSurface.js';
import { SprayParticles } from '../adapters/three/tsunami/SprayParticles.js';
import { TsunamiTimeline } from './tsunami-timeline.js';

const params = new URLSearchParams(location.search);
// 기본 2 m 격자 (640×320). 휴대폰 등 작은 화면은 4 m (320×160)
const DX = Number(params.get('dx')) || (window.matchMedia('(max-width: 720px)').matches ? 4 : 2);
const L = COAST_LAYOUT;
const $ = (id) => document.getElementById(id);

/* ───────── 렌더러 · 카메라 ───────── */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') });
// 고해상도 화면에서 픽셀 수가 너무 많으면 프레임이 떨어져 계산도 느려짐 → 1.5 로 제한
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

/* ───────── 오류 표시 (셰이더·GPU 기능) ───────── */
function showError(msg) {
  const el = $('err');
  el.textContent = msg;
  el.style.display = 'block';
}
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const log = (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || '') + (gl.getProgramInfoLog(program) || '');
  showError(`그래픽 셰이더 오류 — 이 화면을 캡처해서 알려주세요\n${log.slice(0, 600)}`);
};
if (!renderer.capabilities.isWebGL2) showError('이 브라우저는 WebGL2 를 지원하지 않아 쓰나미 계산을 할 수 없습니다. 최신 Chrome/Edge 를 사용하세요.');
else if (!renderer.extensions.has('EXT_color_buffer_float')) showError('이 GPU/브라우저는 float 렌더링(EXT_color_buffer_float)을 지원하지 않아 계산이 동작하지 않습니다.');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 30000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 20;
controls.maxDistance = 5000;

/* ───────── 하늘 · 해 ───────── */
const sunDir = new THREE.Vector3(-0.55, 0.42, 0.5).normalize();
const sky = new Sky();
sky.scale.setScalar(20000);
const su = sky.material.uniforms;
su.turbidity.value = 2.5;
su.rayleigh.value = 1.4;
su.mieCoefficient.value = 0.004;
su.mieDirectionalG.value = 0.8;
su.sunPosition.value.copy(sunDir);
scene.add(sky);

const shared = {
  uSunDir: { value: sunDir },
  uFogColor: { value: new THREE.Color(0.50, 0.60, 0.70) },
  uFogDensity: { value: 1 / 3600 },
};

/* ───────── 계산 · 장면 ───────── */
const state = {
  wallHeight: 4,
  wallGaps: true,
  tsunami: { ...DEFAULT_TSUNAMI, startDelay: 1e9 },
  speed: 2,
  playing: true,
  started: false,
  peakFront: -Infinity,
  orbit: false,
  ff: false,          // 충돌 직전으로 건너뛰는 중
};
const START_DELAY = 1;

let terrain = buildCoastTerrain({ dx: DX, wallHeight: state.wallHeight, wallGaps: state.wallGaps });
let solver = new SweSolverGPU(renderer, terrain, state.tsunami);
let coast = new CoastScene(terrain, solver, shared);
let water = new WaterSurface(terrain, solver, shared);
const spray = new SprayParticles(shared);
const timeline = new TsunamiTimeline($('tlCanvas'));
scene.add(coast.group, water.group, spray.points);

function rebuildTerrain() {
  scene.remove(coast.group, water.group);
  solver.dispose();
  terrain = buildCoastTerrain({ dx: DX, wallHeight: state.wallHeight, wallGaps: state.wallGaps });
  solver = new SweSolverGPU(renderer, terrain, state.tsunami);
  coast = new CoastScene(terrain, solver, shared);
  water = new WaterSurface(terrain, solver, shared);
  scene.add(coast.group, water.group);
  spray.clear();
}

/* ───────── 카메라 프리셋 ───────── */
const CAMS = {
  street: { pos: [878, 92, 18], tgt: [735, 2, 380] },
  beach:  { pos: [868, 24, 150], tgt: [700, 4, 330] },
  side:   { pos: [880, 36, -70], tgt: [745, 4, 300] },
  aerial: { pos: [210, 560, -330], tgt: [780, 0, 320] },
};
let camTween = null;
function setCamera(name, instant = false) {
  state.orbit = name === 'orbit';
  document.querySelectorAll('#cams button').forEach((b) => b.classList.toggle('on', b.dataset.c === name));
  if (state.orbit) { controls.target.set(820, 10, 320); return; }
  const c = CAMS[name];
  if (!c) return;
  const to = { pos: new THREE.Vector3(...c.pos), tgt: new THREE.Vector3(...c.tgt) };
  if (instant) { camera.position.copy(to.pos); controls.target.copy(to.tgt); controls.update(); return; }
  camTween = { from: { pos: camera.position.clone(), tgt: controls.target.clone() }, to, t: 0 };
}

/* ───────── UI ───────── */
function bindSlider(id, out, fmt, onInput) {
  const el = $(id);
  const show = () => { $(out).textContent = fmt(Number(el.value)); };
  el.addEventListener('input', () => { show(); onInput(Number(el.value)); });
  show();
  return el;
}
bindSlider('amp', 'vAmp', (v) => `${v.toFixed(1)} m`, (v) => { state.tsunami.amplitude = v; if (!state.started) solver.setTsunami({ amplitude: v }); });
bindSlider('per', 'vPer', (v) => `${v} s`, (v) => { state.tsunami.period = v; if (!state.started) solver.setTsunami({ period: v }); });
bindSlider('wall', 'vWall', (v) => (v === 0 ? '없음' : `${v.toFixed(1)} m`), (v) => {
  state.wallHeight = v;
  applyWallHeight(terrain, v);
  solver.uploadTerrain();
  coast.setWallHeight(v);
});
/* ───────── 시나리오 ─────────
 * 앞바다(수심 24 m) 파고·주기만 정한다. 해안 높이는 얕아지며 커진 계산 결과 (HUD '해안 최고 수위')
 * 비교 기준: 해안에서 관측된 높이 — 1983 동해 임원항 약 4 m, 2011 동일본 다수 지역 10~20 m · 최대 약 40 m */
const SCENARIOS = {
  east:   { amp: 1.5, per: 120, desc: '1983년 동해 지진해일(임원항 약 4 m)과 비슷한 규모 · 해안 수 m' },
  large:  { amp: 6,   per: 90,  desc: '해안 10 m 이상 · 일반적인 차수벽을 넘는 대형 쓰나미' },
  tohoku: { amp: 9,   per: 150, desc: '2011 동일본 대지진 큰 피해 지역 수준 · 해안 약 20 m' },
  max:    { amp: 16,  per: 180, desc: '관측 사상 최대급 · 해안 30~40 m (동일본 최대 지점 수준)' },
};
let scenarioKey = 'large';
function showScenario(key) {
  scenarioKey = key;
  document.querySelectorAll('#scen button').forEach((b) => b.classList.toggle('on', b.dataset.k === key));
  $('scenDesc').textContent = key ? `${SCENARIOS[key].desc}. 실제 결과는 HUD 의 ‘해안 최고 수위’` : '직접 설정한 값';
}
function setSlider(id, v) {
  $(id).value = v;
  $(id).dispatchEvent(new Event('input'));
}
document.querySelectorAll('#scen button').forEach((b) => b.addEventListener('click', () => {
  const sc = SCENARIOS[b.dataset.k];
  setSlider('amp', sc.amp);
  setSlider('per', sc.per);
  showScenario(b.dataset.k);
  startTsunami();
}));
// 슬라이더를 직접 움직이면 시나리오 선택 해제
['amp', 'per'].forEach((id) => $(id).addEventListener('input', (e) => { if (e.isTrusted) showScenario(null); }));
showScenario('large');

$('gaps').addEventListener('change', (e) => { state.wallGaps = e.target.checked; rebuildTerrain(); resetSim(); });

function startTsunami() {
  resetSim();
  state.tsunami.startDelay = START_DELAY;
  solver.setTsunami({ ...state.tsunami });
  state.started = true;
  timeline.start(solver.time, state.tsunami);
  state.playing = true;
  $('pause').textContent = '일시정지';
}
function resetSim() {
  state.tsunami.startDelay = 1e9;
  solver.setTsunami({ ...state.tsunami });
  solver.reset();
  spray.clear();
  state.started = false;
  state.peakFront = -Infinity;
  state.ff = false;
  lastStats = null;
  timeline.reset();
  timeline.params = null;
}
$('start').addEventListener('click', startTsunami);
$('reset').addEventListener('click', () => { resetSim(); state.playing = true; $('pause').textContent = '일시정지'; });
$('pause').addEventListener('click', () => { state.playing = !state.playing; $('pause').textContent = state.playing ? '일시정지' : '계속'; });
document.querySelectorAll('#speed button').forEach((b) => b.addEventListener('click', () => {
  state.speed = Number(b.dataset.s);
  document.querySelectorAll('#speed button').forEach((x) => x.classList.toggle('on', x === b));
}));
document.querySelectorAll('#cams button').forEach((b) => b.addEventListener('click', () => setCamera(b.dataset.c)));
$('tlSkip').addEventListener('click', () => {
  if (!timeline.canSkip) return;
  state.ff = true;
  state.playing = true;
  $('pause').textContent = '일시정지';
});

/* ───────── 통계 (축소 텍스처) ───────── */
let lastStats = null;
function computeStats(buf) {
  const rw = solver.rw, rh = solver.rh, cs = solver.block * DX;
  let front = -Infinity, area = 0, depth = 0;
  for (let bj = 0; bj < rh; bj++) {
    const z = (bj + 0.5) * cs;
    const off = shoreOffset(z);
    for (let bi = 0; bi < rw; bi++) {
      const k = (bj * rw + bi) * 4;
      const xp = (bi + 0.5) * cs - off;
      if (xp > L.shoreline - 140 && xp < L.wallStart - 2) front = Math.max(front, buf[k + 3]);
      if (xp > L.wallEnd + 3) {
        area += buf[k + 1] * cs * cs;
        depth = Math.max(depth, buf[k + 2]);
      }
    }
  }
  if (front > -50) state.peakFront = Math.max(state.peakFront, front);
  return { front, areaHa: area / 10000, maxDepth: depth };
}

function updateHud() {
  const wallTop = L.groundAtWall + state.wallHeight;
  const tShow = Math.max(0, solver.time - START_DELAY);
  $('hTime').textContent = state.started ? `${tShow.toFixed(0)} s` : '-';
  $('hEta').textContent = `${solver.etaInNow >= 0 ? '+' : ''}${solver.etaInNow.toFixed(1)} m`;
  $('hWall').textContent = state.wallHeight > 0 ? `해발 ${wallTop.toFixed(1)} m` : '벽 없음';
  const st = $('status');
  if (lastStats) {
    $('hFront').textContent = state.peakFront > -50 ? `해발 ${state.peakFront.toFixed(1)} m` : '-';
    $('hArea').textContent = `${lastStats.areaHa.toFixed(2)} ha`;
    $('hDepth').textContent = `${lastStats.maxDepth.toFixed(1)} m`;
  }
  const ph = timeline.phaseInfo;
  st.textContent = state.ff ? '건너뛰는 중…' : ph.label;
  st.style.color = ph.color;
  $('tlPhase').textContent = st.textContent;
  $('tlPhase').style.color = ph.color;
  $('tlTime').textContent = state.started ? `t = ${tShow.toFixed(0)} s` : '';
  $('tlHint').textContent = state.ff ? '파도가 해안에 닿기 직전까지 빠르게 계산하는 중' : timeline.hint(solver.time);
  $('tlSkip').disabled = !timeline.canSkip || state.ff;
  $('hPerf').textContent = perf.text;
  $('hPerf').style.color = perf.slow ? 'var(--warn)' : '';
  timeline.draw(solver.time, state.started);
}

/* ───────── 루프 ───────── */
let last = performance.now();
let frame = 0;
let simSinceEmit = 0;
let realTime = 0;
const perf = { fps: 60, ratio: 0, text: '-', slow: false, simAcc: 0, realAcc: 0 };
function tick(now) {
  // 프레임이 늦어도 0.1 s 까지는 계산이 따라잡음 (그 이상은 탭 전환 등으로 보고 버림)
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  let simDt = 0;
  if (state.ff) {
    // 충돌 직전으로 건너뛰기: 프레임당 최대 3 s 씩 계산, 해안 수위가 오르기 시작하면 잘게
    const near = lastStats && lastStats.front > -0.2;
    simDt = solver.advance(near ? 0.4 : 3.0, 2000);
    realTime += simDt;
    const buf = solver.readReduced();
    lastStats = computeStats(buf);
    timeline.update(solver.time, lastStats, solver.etaInNow);
    if (!timeline.canSkip || solver.time > START_DELAY + 4 * state.tsunami.period + 200) state.ff = false;
    updateHud();
  } else if (state.playing) {
    simDt = solver.advance(dtReal * state.speed, 900);
    realTime += simDt;
  }
  simSinceEmit += state.ff ? 0 : simDt;
  frame++;
  if (!state.ff && frame % 3 === 0) {
    const buf = solver.readReduced();
    lastStats = computeStats(buf);
    timeline.update(solver.time, lastStats, solver.etaInNow);
    spray.emitFromField(buf, solver.rw, solver.rh, solver.block * DX, simSinceEmit);
    simSinceEmit = 0;
    if (frame % 6 === 0) updateHud();
  }
  if (!state.ff) spray.update(simDt);

  // 실제 진행 속도 (1초 평균)
  perf.fps = perf.fps * 0.95 + (dtReal > 0 ? 1 / dtReal : 60) * 0.05;
  perf.simAcc += state.ff ? 0 : simDt;
  perf.realAcc += dtReal;
  if (perf.realAcc >= 1) {
    perf.ratio = perf.simAcc / perf.realAcc;
    const want = state.playing && !state.ff ? state.speed : 0;
    perf.slow = want > 0 && perf.ratio < want * 0.75;
    perf.text = state.playing && !state.ff ? `${perf.ratio.toFixed(1)}× · ${perf.fps.toFixed(0)} fps` : `${perf.fps.toFixed(0)} fps`;
    perf.simAcc = 0; perf.realAcc = 0;
  }

  if (camTween) {
    camTween.t = Math.min(1, camTween.t + dtReal / 1.6);
    const e = camTween.t < 0.5 ? 4 * camTween.t ** 3 : 1 - (-2 * camTween.t + 2) ** 3 / 2;
    camera.position.lerpVectors(camTween.from.pos, camTween.to.pos, e);
    controls.target.lerpVectors(camTween.from.tgt, camTween.to.tgt, e);
    if (camTween.t >= 1) camTween = null;
  }
  if (state.orbit) {
    const ang = now * 0.00006;
    camera.position.set(820 + Math.cos(ang) * 620, 160 + Math.sin(ang * 1.7) * 40, 320 + Math.sin(ang) * 620);
  }
  controls.update();

  coast.update();
  water.update(realTime);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  spray.setViewport(window.innerHeight * renderer.getPixelRatio(), camera.fov);
}
window.addEventListener('resize', resize);
resize();
setCamera(params.get('cam') || 'street', true);
$('loading').remove();
updateHud();
requestAnimationFrame(tick);

/* ───────── 테스트용 ───────── */
window.__tsunami = {
  start: startTsunami,
  reset: resetSim,
  /** 렌더링 없이 시뮬레이션만 seconds 만큼 진행 */
  advance(seconds) {
    let left = seconds;
    while (left > 1e-6) {
      // 마지막 4초는 잘게 나눠 물보라도 함께 계산 (스크린샷용)
      const step = Math.min(left, left > 4 ? 0.5 : 1 / 30);
      const adv = solver.advance(step, 100000);
      realTime += adv;
      left -= step;
      const b = solver.readReduced();
      if (left <= 4) {
        spray.emitFromField(b, solver.rw, solver.rh, solver.block * DX, adv);
        spray.update(adv);
      }
      timeline.update(solver.time, computeStats(b), solver.etaInNow);
    }
    const buf = solver.readReduced();
    lastStats = computeStats(buf);
    timeline.update(solver.time, lastStats, solver.etaInNow);
    updateHud();
    return { time: solver.time, phase: timeline.phaseInfo.label, ...lastStats };
  },
  skip() { $('tlSkip').click(); },
  get phase() { return timeline.phaseInfo.label; },
  get ff() { return state.ff; },
  pause() { state.playing = false; },
  play() { state.playing = true; },
  setCamera: (n) => setCamera(n, true),
  setWall(v) { $('wall').value = v; $('wall').dispatchEvent(new Event('input')); },
  setAmp(v) { $('amp').value = v; $('amp').dispatchEvent(new Event('input')); },
  scenario(k) { document.querySelector(`#scen button[data-k="${k}"]`).click(); },
  get time() { return solver.time; },
  get spray() { return spray.count; },
  get stats() { return lastStats; },
  get dt() { return solver.dt; },
  splashStats() {
    const b = solver.readReduced(); const v = [];
    for (let k = 0; k < b.length; k += 4) if (b[k] > 0.5) v.push(b[k]);
    v.sort((a, c) => c - a);
    return { n: v.length, top: v.slice(0, 5).map((x) => +x.toFixed(1)), p50: v[Math.floor(v.length / 2)] };
  },
};
