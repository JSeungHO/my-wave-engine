# MyWaveCompany — WebGL Ocean

Cesium + Three.js Gerstner·홍수 데모. **루트 [README.md](../README.md)** 를 먼저 보세요.

## 실행

```bash
# 레포 루트에서
dotnet run -- serve

# 또는 이 폴더에서
npm install && npm run dev
```

## 진입점

| 경로 | 설명 |
|------|------|
| `/` | Cesium — `src/adapters/cesium/cesium-main.js` |
| `/shore.html` | Three.js 해변 |

## 설정

`Configs/` — [CONFIG.md](./docs/CONFIG.md), [SCENE_LAYOUT.md](../docs/SCENE_LAYOUT.md)

## 스모크 테스트

```bash
node scripts/smoke-test.mjs http://localhost:5173/
```

*(Playwright 필요 — devDependencies에 없으면 `npx playwright install chromium`)*
