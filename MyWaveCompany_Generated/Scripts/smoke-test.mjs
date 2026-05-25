import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5188/';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const logs = [];
const errors = [];

page.on('console', (msg) => {
  logs.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', (err) => {
  errors.push(`PAGE: ${err.message}\n${err.stack ?? ''}`);
});

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(8000);

  const overlay = await page.locator('#overlay').innerText().catch(() => '(no overlay)');
  const canvasCount = await page.locator('canvas').count();
  const cesiumWidget = await page.locator('.cesium-viewer').count();

  console.log('=== URL ===', url);
  console.log('=== OVERLAY ===');
  console.log(overlay);
  console.log('=== CANVAS COUNT ===', canvasCount);
  console.log('=== CESIUM VIEWER ===', cesiumWidget);
  console.log('=== CONSOLE ERRORS ===');
  errors.forEach((e) => console.log(e));
  console.log('=== RELEVANT LOGS ===');
  logs
    .filter((l) => /cesium-main|renderError|FATAL|404|Error/i.test(l))
    .slice(0, 40)
    .forEach((l) => console.log(l));
} finally {
  await browser.close();
}
