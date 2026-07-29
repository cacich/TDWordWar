# 06. 可擴充方向（實作待辦）

這一頁是**給未來要動手實作的人／agent 的清單**，不是願景文件。
每一項都寫了「為什麼值得做、成本、從哪個檔案切入、有什麼陷阱」，
目的是**不必重新分析就能直接開工**。

做完任何一項後：請把該項移到本頁最後的「已完成」區，並依
[07-wiki-maintenance.md](07-wiki-maintenance.md) 的規則回寫相關模組頁。

---

## 內容量現況

```
玩家側：71 字 · 43 武將 · 13 羈絆 · 30 主動技 · 16 商城道具 · 編隊 · 24 成就
敵人側：22 種敵人（10 一般 + 12 BOSS）· 9 關各有偏好特徵
```

兩側已經平衡（2026-07-29 完成敵種擴充，見本頁最後的「已完成」）。
下一個瓶頸是**關卡結構**：9 關的差異只在敵人偏好與地形形狀，
戰術結構仍然都是「單一路徑 S→C」——見下面第 5、7 項。

---

## 第一梯：高價值、低成本、貼合現有架構

### 1. 波次預覽（佈陣階段看下一波組成）

**為什麼**：策略深度提升明顯，UI 成本極小——佈陣階段本來就有 12 秒的決策時間，但玩家現在是盲目佈陣。

**切入點**：`sim/waves.ts` + `ui/hud.ts` 的佈陣列

**⚠ 關鍵陷阱（一定要看）**
`buildWave(wave, rng, hpMul)` 會**消耗 `state.rng`**（[`waves.ts`](../../src/sim/waves.ts) 的 `buildWave` 內部呼叫 `rng()`）。
直接呼叫它來預覽，會讓整條亂數流位移，**破壞「同種子 → 同一場對局」這條鐵則，
並讓 `npm run sim` 的難度基準失準**。

正確做法（二選一）：
1. **建議**：在 `createGame` 時就把整局所有波次預先算好存進 `GameState`，預覽變成純查表（順帶讓預覽完全免費）
2. 用獨立的亂數流，例如 `mulberry32(seed ^ wave)`，不碰 `state.rng`

---

## 第二梯：高價值、中成本

### 2. 每日挑戰

**為什麼**：**架構上是完美契合**——本專案已經保證「同種子 → 同一場對局」（`core/rng.ts` 的 mulberry32），
用日期當種子就能讓所有玩家玩到同一局，這是多數遊戲要額外做很多工才有的性質。

**切入點**
- 種子在 **app 層**算（`sim/` 禁用 `Date.now()`）——現有的 `app.ts` 的 `newSeed()` 就是這個模式，照抄即可
- `MetaProgress` 加每日成績記錄（建議存日期字串 → 波次）
- 公平性：建議**固定不套用編隊與商城道具**，否則養成程度不同無法比較

**陷阱**：切換編隊會讓亂數流位移（見 [modules/05](modules/05-economy-and-waves.md)），
所以「每日挑戰不套用編隊」除了公平考量，也是重現性的必要條件。

---

### 3. 局內續玩存檔

**為什麼**：對 PWA／手機來說這是目前最大的體驗缺口——一局 30 波很長，中斷就全沒了。

**⚠ 成本比舊文件說的低得多**
[04-invariants.md](04-invariants.md) 曾說這需要「存 `{seed, rngCallCount}` 並在載入時重播」。
但 `mulberry32` 的內部狀態其實只是**單一個 uint32 `a`**（[`core/rng.ts`](../../src/core/rng.ts)）：

```ts
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0        // ← 全部狀態就是這一個數字
  return function () { ... }
}
```

只要讓它暴露／可還原這個 state（例如加一個 `mulberry32From(a)` 工廠，或改回傳
`{ next(), get state() }`），續玩就從「重播整局」變成「存一個數字」。

**切入點**：`core/rng.ts` 先開放 state → `core/save.ts` 加局內存檔 → `app.ts` 接載入流程。

**陷阱**：`GameState` 其餘欄位都是可序列化的純資料，但要注意 `board` 可從
`(levelKey, seed)` 重建、不必存；`units` 的 `formIds`／`memberIds` 交叉引用要一起還原。

---

### 4. 主動技手動施放

**為什麼**：30 個技能目前**全部自動施放**（`sim/skills.ts` 的 `stepSkills`），
玩家在戰鬥階段其實沒有操作。這是清單裡對「每分鐘參與感」影響最大的一項。

**切入點**
- 在 [`sim/actions.ts`](../../src/sim/actions.ts) 新增一個 action（例如 `castSkill(state, unitId)`），
  維持「玩家操作一律經由 actions.ts」這條鐵則
- `stepSkills` 改成只自動放「非手動」的技能
- HUD 需要一個可點的技能列（`ui/hud.ts`）

**建議做法**：不要全部改手動（30 個太多），只把**傳說／神話級**改成手動點放並附帶傷害加成，
其餘維持自動——既提升參與感又不增加操作負擔。

---

## 第三梯：結構性擴充

### 5. 關卡修飾符（modifiers）

**為什麼**：用很低的成本為既有 6 關加上重玩價值。例如「禁用弓系」「敵人 +30% 移速」「1 命但收入 ×2」。

**切入點**：`LevelDef` 加 `modifiers?`，並**沿用 `Perks` 已驗證的「中性預設值」模式**
（見 [modules/06](modules/06-meta-progression.md) 的 Perks 中性值不變量）——這個模式已經證明能讓
`sim/` 不需要知道上層系統的存在。

---

### 6. 無盡模式

**切入點**：`maxWave → Infinity` + `hpMul` 隨波次遞增，沿用 `meta.best[]` 當高分榜。
與已完成的成就系統互補（`meta.totals` 已經在累積跨局戰績，無盡模式的高分可以沿用同一套）。

**陷阱**：`checkWaveEnd`（`sim/step.ts`）目前用 `wave >= maxWave` 判定勝利，要處理 `Infinity` 的情況。

---

### 7. 多路徑／雙出生點

**為什麼**：目前 6 關的地圖差異只有形狀，戰術結構完全相同（單一路徑 S→C）。

**成本高——建議獨立成一個里程碑**。`Board` 目前只有單一 `path` 與單一 `camp`，
要改成 `paths[]` 並讓 `Enemy` 帶 `pathIndex`。受影響範圍請見
[modules/03-board-and-mapgen.md](modules/03-board-and-mapgen.md) 的「多路徑改造阻礙點」清單。

---

## 已知落差（不是新功能，但值得收拾）

| 項目 | 說明 | 位置 |
|---|---|---|
| `rarity: 4` 是死欄位 | `RARITY_TABLE` 有第 4 欄，但沒有任何字是 rarity 4，索引 3 永遠不會被讀到。要嘛加「傳說級單字」用掉它，要嘛移除 | [`sim/economy.ts`](../../src/sim/economy.ts) |
| 規格書仍有落後 | `docs/game-design.md` §4/§5 的 `range` 數字與實戰差 1.6～2.5 倍；§5.4 技能表只列 13 個（實際 30）；§10.2 檔案樹大半失效；§7.3 說 4 種索敵（實際 3）。商城與敵種已補上 | `docs/game-design.md` |
| 「成員字牌不重複計算」散落三處 | `combat.ts` 的 `stepCombat`、`economy.ts` 的 `unitIncome`、`state.ts` 的光環各自實作，沒有共用 helper。**第四個逐單位聚合會靜默重複計算** | 見 [modules/05](modules/05-economy-and-waves.md) |
| 編隊不防「沒有攻擊單位」 | 只選經濟／光環字會開出打不動任何敵人的一局。**這是刻意的設計決定**（編隊沒有安全網），但若要改成給提示，切入點在 `sim/pool.ts` 的 `buildLoadoutPool` | [`sim/pool.ts`](../../src/sim/pool.ts) |
| Perks 的兩種 RNG 慣例 | 爆擊用短路（中性時不抽亂數），漏怪防護與精兵符無論如何都抽。新增 perk 時要意識到這會影響同種子的亂數流對齊 | `combat.ts` / `step.ts` / `actions.ts` |

---

## 動任何數值後的必要驗證

```bash
npm test         # 224 個單元測試
npm run typecheck
npm run sim      # 難度儀表板：陣亡波次中位數 vs 該關波數的一半
npm run econ     # 經濟儀表板：逐波收入拆解與征兵次數（設計目標 1～2 次/波）
npm run sim 24 luoyang   # 指定局數與關卡
```

各關傻 AI 陣亡中位數基準（**目標 = 該關波數的一半**，±20% 內算達標）：
黃巾 6／12・董卓 9／18・巨鹿 16／30・官渡 13／24・赤壁 15／30・五丈原 20／40・
襄陽 17／32・漢中 16／32・洛陽 20／40。

---

## 已完成

（完成的項目請從上面移到這裡，附上完成日期與 commit）

- 2026-07-29 編隊系統（手動挑選字池內容）
- 2026-07-29 商城 16 種可升級被動道具（Perks 機制）
- 2026-07-29 內容擴充至 71 字／43 武將／13 羈絆
- 2026-07-29 **成就系統**：24 個成就（戰陣 7／布陣 8／圖鑑 4／征途 5），達成即發聲望共 2130
  （夾在兵書 1230 與商城 13590 之間）。每個成就都是「`progress()` >= `goal`」的計數器，
  判定與 UI 進度條共用同一份數字。新增 `data/achievements.ts`、
  `MetaProgress.achievements`（key → 解鎖序號）與 `MetaProgress.totals`（`RunTotals` 跨局統計）、
  「戰功」畫面。新增 `achievements.test.ts`（23 個測試）。
- 2026-07-29 **敵種擴充**：5 → 22 種敵人（10 一般 + 12 BOSS）。
  新機制：回血光環（`healAura`）、自我再生（`regen`）、死亡分裂（`splitInto`）、
  護衛（`escort`）、灼燒／減速免疫。BOSS 波改為從合格 BOSS 中依關卡偏好隨機挑選。
  新增 `EnemyTrait` 特徵系統：關卡宣告 `bias` 加權敵種出現率，並自動推導選單的「建議帶」標籤。
  關卡 6 → 9（新增襄陽／漢中／洛陽），`HP_GROWTH` 1.25 → 1.23 抵掉新機制的難度上升。
