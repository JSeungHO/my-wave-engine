import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5191/';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  const t1 = await page.locator('#overlay').innerText();
  await page.waitForTimeout(2000);
  const t2 = await page.locator('#overlay').innerText();

  console.log('=== T0 ===');
  console.log(t1);
  console.log('=== T+2s ===');
  console.log(t2);

  const timeMatch1 = t1.match(/시간\s*:\s*([\d.]+)/);
  const timeMatch2 = t2.match(/시간\s*:\s*([\d.]+)/);
  if (timeMatch1 && timeMatch2) {
    const dt = parseFloat(timeMatch2[1]) - parseFloat(timeMatch1[1]);
    console.log('=== TIME DELTA ===', dt.toFixed(2), 's');
    console.log(dt > 1.5 ? 'ANIMATION OK' : 'ANIMATION STUCK');
  }

  if (/렌더링 오류|초기화 오류/.test(t2)) {
    console.log('=== ERROR DETECTED ===');
  }
} finally {
  await browser.close();
}
