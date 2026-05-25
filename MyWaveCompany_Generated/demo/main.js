import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import wavesJson from '../Configs/waves.json';
import { loadWavesConfig, GerstnerWave }         from '../core/index.js';
import { createOceanMaterial, OceanMesh }        from '../adapters/three/index.js';
import { FloatingObject }                        from './FloatingObject.js';

const config = loadWavesConfig(wavesJson);
const solver = new GerstnerWave(config.waves, {
  buoyancyIterations: config.ocean.buoyancyIterations,
});

// ── Scene ───────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 80, 400);

// ── Camera ──────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(
  55, window.innerWidth / window.innerHeight, 0.1, 1000,
);
camera.position.set(30, 18, 50);

// ── Renderer ─────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// ── Controls ─────────────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.target.set(0, 0, 0);
controls.maxPolarAngle  = Math.PI * 0.48;
controls.update();

// ── Lights ───────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(60, 80, 40);
scene.add(sun);

// ── Ocean ────────────────────────────────────────────────────────────────────
const oceanMaterial = createOceanMaterial(config.waves);
const ocean = new OceanMesh(config, oceanMaterial);
scene.add(ocean);

// ── Boat ─────────────────────────────────────────────────────────────────────
const boat = new THREE.Mesh(
  new THREE.BoxGeometry(3, 1.2, 6),
  new THREE.MeshStandardMaterial({ color: 0xff6622, roughness: 0.6 }),
);
boat.position.set(15, 0, 10);
scene.add(boat);
const floater = new FloatingObject(solver, boat, { offsetY: 0.6 });

// ── Buoy ─────────────────────────────────────────────────────────────────────
const buoy = new THREE.Mesh(
  new THREE.SphereGeometry(0.8, 16, 16),
  new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.4 }),
);
buoy.position.set(-20, 0, -15);
scene.add(buoy);
const buoyFloater = new FloatingObject(solver, buoy, { offsetY: 0.8 });

// ── Animate ───────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  ocean.update(t);
  floater.update(t);
  buoyFloater.update(t);
  oceanMaterial.uniforms.uCameraPosition.value.copy(camera.position);

  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
