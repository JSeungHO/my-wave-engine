import { defineConfig } from 'vite';
import glsl    from 'vite-plugin-glsl';
import cesium  from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [
    glsl(),     // .glsl 파일을 문자열로 import
    cesium(),   // Cesium 정적 에셋 자동 복사 + WASM 처리
  ],
  build: {
    rollupOptions: {
      input: {
        // Three.js 데모
        main:   'index.html',
        // Cesium 데모 (Task 2-4)
        cesium: 'cesium.html',
      },
    },
  },
  server: {
    open: true,
  },
  optimizeDeps: {
    // Cesium은 CJS → ESM 변환이 필요
    include: ['cesium'],
  },
});
