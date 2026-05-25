/**
 * 해변 시점 Gerstner 파도 데모 — 파도멍(실사 해변) 느낌에 가깝게
 * Three.js GPU 버텍스 변위 + 거친 몽돌 해변
 *
 * Cesium Material 2a(평면)와 달리 메시가 실제로 위아래로 움직입니다.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import wavesJson from '../Configs/waves.json';
import { loadWavesConfig } from '../core/index.js';
import { createOceanMaterial, OceanMesh } from '../adapters/three/index.js';

const config = loadWavesConfig(wavesJson);

// 해변 시점 — waves.json 파고·위상 사용 (추가 배율 없음)
config.waves = config.waves.map((w) => ({
  ...w,
  steepness: Math.min((w.steepness ?? 0.4) * 0.95, 0.55),
}));

config.ocean.meshSizeX = 320;
config.ocean.meshSizeZ = 320;
config.ocean.meshResolutionX = 224;
config.ocean.meshResolutionZ = 224;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ec8e3);
scene.fog = new THREE.Fog(0x9fd4ef, 60, 380);

const camera = new THREE.PerspectiveCamera(
  52, window.innerWidth / window.innerHeight, 0.1, 800,
);
// 해변 낮은 시점 — 파도 crest 가 시야에 들어오도록
camera.position.set(0, 2.2, 28);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.2, -15);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 1.5;
controls.maxDistance = 120;
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 0.62));
const sun = new THREE.DirectionalLight(0xfff5e6, 1.1);
sun.position.set(80, 120, 60);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3d6b5a, 0.35));

const oceanMaterial = createOceanMaterial(config.waves);
oceanMaterial.uniforms.uDeepColor.value.set(0x005f73);
oceanMaterial.uniforms.uShallowColor.value.set(0x48cae4);
const ocean = new OceanMesh(config, oceanMaterial);
scene.add(ocean);

/** 거제 몽돌필뱅 느낌 — 해변 쪽(z 음수) 자갈 */
function addPebbleBeach() {
  const pebbleMat = new THREE.MeshStandardMaterial({
    color: 0x6b6b6b,
    roughness: 0.92,
    metalness: 0.05,
  });
  const geo = new THREE.SphereGeometry(1, 6, 5);
  const group = new THREE.Group();
  const rng = (seed) => {
    let s = seed;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  };
  const rand = rng(42);

  for (let i = 0; i < 2800; i++) {
    const mesh = new THREE.Mesh(geo, pebbleMat);
    const x = (rand() - 0.5) * 180;
    const z = -95 - rand() * 45;
    const sx = 0.15 + rand() * 0.55;
    const sy = 0.08 + rand() * 0.25;
    const sz = 0.15 + rand() * 0.5;
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, -0.05 + rand() * 0.08, z);
    mesh.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    group.add(mesh);
  }
  scene.add(group);
}
addPebbleBeach();

const overlay = document.getElementById('overlay');
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  ocean.update(t);
  oceanMaterial.uniforms.uCameraPosition.value.copy(camera.position);

  // 아주 약한 카메라 흔들림 — 파도 위에 서 있는 느낌
  camera.position.y = 2.2 + Math.sin(t * 1.3) * 0.12;

  const maxAmp = config.waves.reduce((s, w) => s + w.amplitude, 0).toFixed(1);

  controls.update();
  renderer.render(scene, camera);

  if (overlay) {
    overlay.innerHTML =
      `<b>해변 Gerstner 파도</b> (Three.js)<br>` +
      `시간 : ${t.toFixed(1)} s · 합산 파고 ~${maxAmp} m<br>` +
      `<small>마우스 드래그 · 휠 줌 · Cesium 지구뷰: /</small>`;
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
