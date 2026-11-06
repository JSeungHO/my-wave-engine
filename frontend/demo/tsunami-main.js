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
import { DEFAULT_TSUNAMI, etaIn, inflowDuration } from '../core/math/TsunamiInflow.js';
import { SweSolverGPU } from '../adapters/three/tsunami/SweSolverGPU.js';
import { CoastScene } from '../adapters/three/tsunami/CoastScene.js';
import { WaterSurface } from '../adapters/three/tsunami/WaterSurface.js';
import { SprayParticles } from '../adapters/three/tsunami/SprayParticles.js';

const params = new URLSearchParams(location.search);
// 기본 2 m 격자 (640×320). 휴대폰 등 작은 화면은 4 m (320×160)
const DX = Number(params.get('dx')) || (window.matchMedia('(max-width: 720px)').matches ? 4 : 2);
const L = COAST_LAYOUT;
const $ = (id) => document.getElementById(id);

/* ───────── 렌더러 · 카메라 ───────── */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

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
};

let terrain = buildCoastTerrain({ dx: DX, wallHeight: state.wallHeight, wallGaps: state.wallGaps });
let solver = new SweSolverGPU(renderer, terrain, state.tsunami);
let coast = new CoastScene(terrain, solver, shared);
let water = new WaterSurface(terrain, solver, shared);
const spray = new SprayParticles(shared);
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
$('gaps').addEventListener('change', (e) => { state.wallGaps = e.target.checked; rebuildTerrain(); resetSim(); });

function startTsunami() {
  resetSim();
  state.tsunami.startDelay = 3;
  solver.setTsunami({ ...state.tsunami });
  state.started = true;
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
  lastStats = null;
}
$('start').addEventListener('click', startTsunami);
$('reset').addEventListener('click', () => { resetSim(); state.playing = true; $('pause').textContent = '일시정지'; });
$('pause').addEventListener('click', () => { state.playing = !state.playing; $('pause').textContent = state.playing ? '일시정지' : '계속'; });
document.querySelectorAll('#speed button').forEach((b) => b.addEventListener('click', () => {
  state.speed = Number(b.dataset.s);
  document.querySelectorAll('#speed button').forEach((x) => x.classList.toggle('on', x === b));
}));
document.querySelectorAll('#cams button').forEach((b) => b.addEventListener('click', () => setCamera(b.dataset.c)));

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
  return { front, areaHa: area / 10000, maxDepth: depth };
}

/* ───────── 그래프: 앞바다 수위 곡선 ───────── */
const chart = $('chart');
function drawChart() {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = chart.clientWidth, h = chart.clientHeight;
  if (chart.width !== w * dpr) { chart.width = w * dpr; chart.height = h * dpr; }
  const ctx = chart.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const p = { ...state.tsunami, startDelay: 3 };
  const T = inflowDuration(p);
  const A = Math.max(1, p.amplitude);
  const y = (e) => h * 0.55 - (e / A) * h * 0.42;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(w, y(0)); ctx.stroke();
  ctx.strokeStyle = '#4fd1c5'; ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i <= w; i++) {
    const e = etaIn((i / w) * T, p);
    i === 0 ? ctx.moveTo(i, y(e)) : ctx.lineTo(i, y(e));
  }
  ctx.stroke();
  if (state.started) {
    const x = Math.min(w, (solver.time / T) * w);
    ctx.fillStyle = '#ff6b4a';
    ctx.beginPath(); ctx.arc(x, y(solver.etaInNow), 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,107,74,0.4)'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '10px sans-serif';
  ctx.fillText('앞바다 수위 곡선', 2, 10);
}

function updateHud() {
  const wallTop = L.groundAtWall + state.wallHeight;
  $('hTime').textContent = state.started ? `${Math.max(0, solver.time - 3).toFixed(0)} s` : '-';
  $('hEta').textContent = `${solver.etaInNow >= 0 ? '+' : ''}${solver.etaInNow.toFixed(1)} m`;
  $('hWall').textContent = state.wallHeight > 0 ? `해발 ${wallTop.toFixed(1)} m` : '벽 없음';
  const st = $('status');
  if (lastStats) {
    if (lastStats.front > -50) state.peakFront = Math.max(state.peakFront, lastStats.front);
    $('hFront').textContent = state.peakFront > -50 ? `해발 ${state.peakFront.toFixed(1)} m` : '-';
    $('hArea').textContent = `${lastStats.areaHa.toFixed(2)} ha`;
    $('hDepth').textContent = `${lastStats.maxDepth.toFixed(1)} m`;
  }
  if (!state.started) { st.textContent = '대기 중'; st.className = 'idle'; }
  else if (lastStats && lastStats.areaHa > 0.05) { st.textContent = '월파 · 도시 침수'; st.className = 'warn'; }
  else if (solver.time < state.tsunami.startDelay + state.tsunami.period * 0.5) { st.textContent = '물이 빠지는 중'; st.className = 'idle'; }
  else { st.textContent = '차수벽이 막는 중'; st.className = 'ok'; }
  drawChart();
}

/* ───────── 루프 ───────── */
let last = performance.now();
let frame = 0;
let simSinceEmit = 0;
let realTime = 0;
function tick(now) {
  const dtReal = Math.min(0.05, (now - last) / 1000);
  last = now;
  let simDt = 0;
  if (state.playing) {
    simDt = solver.advance(dtReal * state.speed, 900);
    realTime += simDt;
  }
  simSinceEmit += simDt;
  frame++;
  if (frame % 3 === 0) {
    const buf = solver.readReduced();
    lastStats = computeStats(buf);
    spray.emitFromField(buf, solver.rw, solver.rh, solver.block * DX, simSinceEmit);
    simSinceEmit = 0;
    if (frame % 6 === 0) updateHud();
  }
  spray.update(simDt);

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
      if (left <= 4) {
        const b = solver.readReduced();
        spray.emitFromField(b, solver.rw, solver.rh, solver.block * DX, adv);
        spray.update(adv);
      }
    }
    const buf = solver.readReduced();
    lastStats = computeStats(buf);
    updateHud();
    return { time: solver.time, ...lastStats };
  },
  pause() { state.playing = false; },
  play() { state.playing = true; },
  setCamera: (n) => setCamera(n, true),
  setWall(v) { $('wall').value = v; $('wall').dispatchEvent(new Event('input')); },
  setAmp(v) { $('amp').value = v; $('amp').dispatchEvent(new Event('input')); },
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
