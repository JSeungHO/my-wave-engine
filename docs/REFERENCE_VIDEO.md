# 참조 영상 타겟 — [YouTube pKvdDQYj6J0](https://youtu.be/pKvdDQYj6J0?si=2FuyHG8oKv3EGCGv)

> **목적:** 사용자가 원하는 **「영상 느낌」** 을 제품 목표로 번역한다.  
> **상태:** 📋 기획 — 영상 본문 자동 분석 불가, **유사 레퍼런스 + 현재 갭** 기준 초안  
> **관련:** [기획서.md](../기획서.md) · [ROADMAP.md](./ROADMAP.md) · [SCENE_LAYOUT.md](./SCENE_LAYOUT.md)

---

## 1. 이 문서를 쓰는 이유

[참조 영상](https://youtu.be/pKvdDQYj6J0?si=2FuyHG8oKv3EGCGv)의 제목·장면을 자동으로 가져오지 못했다.  
대신 **Cesium·도시 침수·차수벽** 계열에서 흔히 기대하는 **「영상 느낌」** 을 정리하고,  
**지금 데모(해운대 Gerstner + 차수벽 에디터)** 와 **갭** 을 적는다.

> 영상에서 특히 끌린 장면(예: 「물이 올라간다」, 「골목으로 샌다」, 「건물 잠긴다」)을 알려주면 §3 우선순위를 조정한다.

---

## 2. 「영상 느낌」 — 보통 이런 것들 (레퍼런스 유형)

아래는 Web/Cesium 계열 **도시 홍수·재난 시각화** 데모에서 반복되는 패턴이다.

| # | 사용자가 느끼는 것 | 대표 레퍼런스 |
|---|------------------|---------------|
| V1 | **수위가 시간에 따라 올라간다** (재생/일시정지/리셋) | [cesiumStage Disaster MVP](https://3wa.tw/demo/htm/map/3D/waterfloor/) — 「播放升水」 |
| V2 | **지형·도로·건물 높이에 맞춰** 물이 차오른다 (평면 X) | [ArcGIS Flood + FlowRenderer](https://www.esri.com/arcgis-blog/products/arcgis-online/3d-gis/arcgis-flowrenderer-flood-simulation-visualization) |
| V3 | **건물·도로·CCTV** 등 피해 오브젝트가 강조된다 | cesiumStage — 영향 건물/도로 카운트 |
| V4 | **물이 장애물에서 갈라지거나**, 벽 뒤는 말다 | Phase 5 Shallow Water (기획) |
| V5 | **위성/3D 도시** 위에서 시네마틱 카메라 | Cesium 3D Tiles + flythrough |
| V6 | **침수 깊이** 색 (얕음→깊음), 비·안개 분위기 | ArcGIS / Unreal Flood 레이어 |
| V7 | **역사·시나리오** (「○○년 홍수 수위 재현」) | [Bethlehem Steel Flood (Cesium Unreal)](https://cesium.com/blog/2021/05/25/bethlehem-steel-flood-simulation-with-cesium-for-unreal) |

### 2.1 Bethlehem Steel형 (Unreal) vs 우리 (Web Cesium)

| | 영상/블로그 느낌 (Unreal) | 우리 목표 (Web) |
|---|---------------------------|-----------------|
| 지형 | Cesium World Terrain + 정확 고도 | Ion terrain + (Phase 6) DEM |
| 물 | Unreal Water **고정 수위면**을 crest 높이에 배치 | 2D h 격자 + Gerstner 합성 |
| 장면 | 실제 산업 단지·강변 | 해운대 + 차수벽 에디터 |
| 런타임 | VR/고사양 PC | 브라우저 WebGL |

**Web에서 Bethlehem 느낌을 내려면:** 「파도」보다 **「수위면이 서서히 상승」** + **지형 아래는 안 잠김** 이 핵심.

### 2.2 cesiumStage형 (브라우저, 가장 가까운 UX)

```
[ 시나리오 초기화 ] → [ 모의 수위 슬라이더 ] → [ ▶ 재생升水 ] → [ 영향 통계 ]
        ↓                      ↓                    ↓
   DEM·건물·CCTV          0 → H max m          도로/CCTV/건물 하이라이트
```

우리 **SceneEditor** 는 이미 **수위·범위·차수벽·넘침** 슬라이더가 있으나,  
**「재생升水」** 과 **지형 기반 침수** 가 없어 **영상과의 간격** 이 큼.

---

## 3. 현재 데모 vs 영상 느낌 — 갭表

| 영상에서 기대 | 현재 (2026-05) | 갭 |
|---------------|----------------|-----|
| 수위 **시간 재생** (물이 차오름) | 파고·정수위 **슬라이더만** | △ 재생/타임라인 없음 |
| **지형 따라** 침수 (낮은 곳 먼저) | **직사각형** 수면 메시 | ✗ terrain clip |
| **3D 건물** 발밑부터 잠김 | 박스 장애물 2~3개 | △ Tiles 미연동 |
| **골목·도로** 로 물이 **퍼짐** | 2D flow 없음 | ✗ Phase 5 |
| 차수벽 **막힘/양끝 넘침** | ✅ 마스크 + side overflow | ○ PoC 수준 |
| **피해 통계** (N개 건물) | 없음 | ✗ |
| **분위기** (비, 어두운 하늘, 깊이색) | Gerstner 바다색 | △ |
| **카메라 연출** | 고정 초기 뷰 | △ flythrough 없음 |
| 클릭 **차수벽 배치** | ✅ SceneEditor | ○ |

**한 줄:** 지금은 **「바다 파도 + 벽 에디터」** 에 가깝고, 영상 느낌은 **「도시에 물이 차오르는 재난 시뮬」** 에 가깝다.

---

## 4. 목표 UX (영상 느낌을 우리 제품으로)

### 4.1 North Star 시퀀스 (30초 데모)

```
1. 해운대 위성 뷰 (dry)
2. [▶ 홍수 재생] — 수위 0 → 4 m (30초)
3. 바다 쪽에서 물이 밀려와 해안가 저지대부터 파란/청록으로 덮임
4. 차수벽 #1 앞: 거품·막힘 / 양끝: 주황 넘침
5. 차수벽 뒤(E 범위 내): 상대적으로 dry
6. 패널: 「수위 3.2m · 넘침 1 · 영향 구역 12 ha」(후순위)
7. 카메라가 벽을 따라 슬라이드 (선택)
```

### 4.2 필수 vs 선택

| 우선 | 기능 | Phase |
|------|------|-------|
| **P0** | **▶ 수위 상승 재생** (0→H, pause/reset) | 5a |
| **P0** | **수위면 = 정수위 + flood.h** (Gerstner는 ripple만) | 5 |
| **P0** | 차수벽 막힘/넘침 (현재 에디터 유지·강화) | 4 ✅ |
| **P1** | **지형 고도** 아래 픽셀은 침수 안 됨 (terrain sample) | 6 |
| **P1** | 침수 **깊이 색** (얕은 청록 → 깊은 남색) | 5 |
| **P1** | 3D Tiles **건물 footprint** 장애물 | 6 |
| **P2** | 2D SWE — 골목 **갈라짐** | 5 |
| **P2** | 피해 카운트·CCTV/도로 (cesiumStage형) | 7 |
| **P2** | 비 particle·post-process | 7 |
| **P3** | Unreal급 Fluid Flux / CFD | ✗ 범위 외 |

---

## 5. 기술 로드맵 재정렬 (영상 지향)

기존 ROADMAP에 **「영상 데모」** 마일스톤을 끼워 넣는다.

### Phase 5a — 「升水 재생」 (영상 P0, 2~3주)

**목표:** 슬라이더만이 아니라 **물이 올라가는 장면**을 재생한다.

| 작업 | 산출 |
|------|------|
| `flood.json` — `maxWaterLevelM`, `riseDurationSec`, `inflowBearingDeg` | Config |
| `FloodTimeline.js` — t → waterLevelM | core |
| SceneEditor **▶ 재생 / ⏸ / ↺** 버튼 | UI |
| GPU: `totalHeight = floodLevel + gerstner * blend` | shader |
| 넘침 판정: `waterLevelM > barrier.heightM` (crest 아닌 **수위면**) | overflow UX |

**DoD:** 30초 클릭 한 번으로 「물이 차오르고 벽 넘침」이 보인다.

### Phase 5b — 2D Shallow Water (영상 P2)

기존 [ROADMAP § Phase 5](./ROADMAP.md) — 골목 분기, 벽 no-flow.

### Phase 6 — 지형·Tiles (영상 P1)

- Cesium terrain sampling → 침수 마스크  
- 3D Tiles 건물 → `obstacles` 자동/반자동  
- 해안 polygon clip (직사각형 탈피)

### Phase 7 — 연출·통계 (cesiumStage / ArcGIS형)

- 피해 집계, 하이라이트 레이어  
- FlowRenderer 유사 **표면 흐름** (선택, JS SDK)  
- 카메라 프리셋·flythrough

---

## 6. `flood.json` 초안 (영상 재생용)

```json
{
  "scenario": {
    "name": "해운대 storm surge",
    "maxWaterLevelM": 4.0,
    "riseDurationSec": 45,
    "holdAtPeakSec": 10,
    "drainDurationSec": 0
  },
  "inflow": {
    "bearingDeg": 180,
    "edge": "offshore"
  },
  "gerstnerBlend": 0.25,
  "depthColors": {
    "shallowM": 0.5,
    "deepM": 3.0
  }
}
```

---

## 7. 영상과 1:1 맞추기 — 확인 질문

아래 중 **참조 영상에 해당하는 것**을 알려주면 §4 우선순위를 확정한다.

1. **물이 서서히 차오르는** 타임랩스/재생이 핵심인가?  
2. **도로·골목**을 따라 물이 **흐르는** 장면인가?  
3. **실제 3D 건물**이 발부터 잠기는가?  
4. **차수벽/둑** 실험이 핵심인가?  
5. **Unreal/고품질** 렌더인가, **웹 브라우저** 데모인가?

---

## 8. 지금 당장 체감을 올리는 Quick Win (코드 없이)

| 조작 | 효과 |
|------|------|
| `?debugObstacles=1` | dry/넘침/물 색 분리 |
| 파고 2× + 정수위 2m | 넘침 연출 강화 |
| 차수벽 길이 **짧게** + 해안선 길이 **길게** | 양끝 넘침 (§SCENE_LAYOUT) |
| 카메라 **15m** + 벽 정면 | 막힘/넘침 가독성 |

---

## 9. 참고 링크

| 자료 | URL |
|------|-----|
| **참조 영상** | https://youtu.be/pKvdDQYj6J0 |
| cesiumStage 침수 MVP | https://3wa.tw/demo/htm/map/3D/waterfloor/ |
| ArcGIS Flood + FlowRenderer | https://www.esri.com/arcgis-blog/products/arcgis-online/3d-gis/arcgis-flowrenderer-flood-simulation-visualization |
| Bethlehem Steel (Cesium Unreal) | https://cesium.com/blog/2021/05/25/bethlehem-steel-flood-simulation-with-cesium-for-unreal |

---

*영상 장면 확인 후 §7 답변 → Phase 5a 착수 여부 결정. 구현 시 [FLOOD.md](../MyWaveCompany_Generated/docs/FLOOD.md) §2와 동기화.*
