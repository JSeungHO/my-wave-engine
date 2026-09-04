import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cesium Assets/Workers/Widgets/ThirdParty 는 Scripts/copy-cesium-assets.mjs 가
// public/cesium/ 로 복사 (postinstall·predev·prebuild). Vite 가 public/ 을
// dev·build 모두 그대로 서빙 → 별도 플러그인 불필요.

export default defineConfig({
  test: {
    environment: 'node',
  },
  plugins: [
    glsl(),
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
