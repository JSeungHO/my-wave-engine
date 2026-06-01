import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, normalizePath } from 'vite';
import glsl from 'vite-plugin-glsl';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cesiumBuild = normalizePath(
  path.resolve(__dirname, 'node_modules/cesium/Build/Cesium'),
);

/** @type {import('vite-plugin-static-copy').Target[]} */
const cesiumCopyTargets = [
  { src: `${cesiumBuild}/Assets`,    dest: 'cesium/Assets' },
  { src: `${cesiumBuild}/Workers`,   dest: 'cesium/Workers' },
  { src: `${cesiumBuild}/Widgets`,   dest: 'cesium/Widgets' },
  { src: `${cesiumBuild}/ThirdParty`, dest: 'cesium/ThirdParty' },
];

export default defineConfig({
  test: {
    environment: 'node',
  },
  plugins: [
    glsl(),
    viteStaticCopy({
      targets: cesiumCopyTargets,
      silent: false,
    }),
  ],
  // ESM 번들에서 import.meta.url 대신 /cesium/ 사용 (Workers·Assets 경로)
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium/'),
  },
  envDir: path.resolve(__dirname, '..'),
  envPrefix: ['VITE_', 'CESIUM_'],
  build: {
    rollupOptions: {
      input: {
        main:   'index.html',
        cesium: 'cesium.html',
        shore:  'shore.html',
      },
    },
  },
  server: {
    open: true,
  },
  optimizeDeps: {
    include: [
      'cesium',
      '@cesium/engine',
      'mersenne-twister',
    ],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
