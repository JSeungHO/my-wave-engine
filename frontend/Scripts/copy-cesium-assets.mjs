// Cesium 정적 자산(Assets/Workers/Widgets/ThirdParty)을 public/cesium/ 로 복사.
// Vite 는 public/ 를 dev·build 모두에서 그대로 서빙하므로 플러그인/미들웨어 불필요.
// CESIUM_BASE_URL('/cesium/') 과 경로 일치. postinstall·predev·prebuild 에서 실행.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules/cesium/Build/Cesium');
const dest = resolve(root, 'public/cesium');

if (!existsSync(src)) {
  console.error(`[copy-cesium] cesium 빌드 없음: ${src}\n  → npm install 후 다시 실행`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
for (const dir of ['Assets', 'Workers', 'Widgets', 'ThirdParty']) {
  cpSync(resolve(src, dir), resolve(dest, dir), { recursive: true });
}
console.log(`[copy-cesium] → ${dest}`);
