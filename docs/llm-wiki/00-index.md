# LLM WIKI — 路由索引

**這份 wiki 是寫給要改這個專案的 LLM agent 讀的。**
目標：讓任何一次改動**只需要讀 1～2 頁**，不必重新掃過整個 codebase。

**用法**：先在下面的「任務 → 該讀哪一頁」找到你的任務類型，直接跳到那一頁。
不要從頭讀完這份 wiki。

---

## 任務 → 該讀哪一頁

### 我要加內容（最常見）

| 任務 | 讀這頁 |
|---|---|
| 加一個**字** | [03-change-recipes.md](03-change-recipes.md) §1 |
| 加一名**武將**／改配方 | [03-change-recipes.md](03-change-recipes.md) §2 → 若要加技能再看 [modules/04](modules/04-combat-and-skills.md) |
| 加一個**羈絆**／組合技 | [modules/04](modules/04-combat-and-skills.md)。⚠ 有一條門檻不能超過編隊上限的硬約束 |
| 加一個**敵人**／**BOSS** | [modules/05](modules/05-economy-and-waves.md)。⚠ `traits` 必填；分裂圖不可有環 |
| 加一**關卡**／改關卡偏好 | [modules/03](modules/03-board-and-mapgen.md)（含可直接複製的完整範例） |
| 加一個**商城道具**／兵書升級 | [modules/06](modules/06-meta-progression.md)。⚠ Perks 中性值不變量 |
| 加一個**成就** | [modules/06](modules/06-meta-progression.md)。⚠ 只有 `progress()`＋`goal`，沒有布林條件 |
| 加一個**主動技／控場狀態** | [modules/04](modules/04-combat-and-skills.md) |

### 我要調數值

| 任務 | 讀這頁 |
|---|---|
| 難度太難／太簡單 | [03-change-recipes.md](03-change-recipes.md) 的難度旋鈕表 → **改完必跑 `npm run sim`**（目標＝該關波數的一半） |
| **糧太多／太少** | [modules/05](modules/05-economy-and-waves.md) 的經濟節 → **改完必跑 `npm run econ`**（目標＝一波征兵 1～2 次） |
| 波次血量／數量成長 | [modules/05](modules/05-economy-and-waves.md)（`HP_GROWTH` 是最敏感的旋鈕） |
| 經濟（徵兵花費、收入、退款） | [modules/05](modules/05-economy-and-waves.md) |
| 射程／傷害／相剋 | [modules/04](modules/04-combat-and-skills.md)。⚠ 資料表的 `range` 不是實戰值 |
| 抽卡機率 | [modules/05](modules/05-economy-and-waves.md)（注意 rarity 4 是死欄位） |

### 我要改行為／加功能

| 任務 | 讀這頁 |
|---|---|
| 新增一個**玩家操作** | [modules/02](modules/02-actions-and-combine.md)。⚠ 組詞要用複數版 `findCombinations` |
| 改**組詞判定** | [modules/02](modules/02-actions-and-combine.md) |
| 改**單位屬性怎麼算** | [modules/01](modules/01-state-and-units.md)。⚠ 改 `recomputeForm` 不是 `makeGeneralUnit` |
| 改**棋盤／路徑／地形生成** | [modules/03](modules/03-board-and-mapgen.md) |
| 改**局外進度／存檔** | [modules/06](modules/06-meta-progression.md) |
| 改**每日挑戰／續玩存檔** | [modules/06](modules/06-meta-progression.md)。⚠ 每日挑戰必須用中性 meta，否則無法重現 |
| 改**無盡模式** | [modules/03](modules/03-board-and-mapgen.md) 的「無盡變體」（關卡側）＋ [modules/06](modules/06-meta-progression.md) 的「獨立的高分榜」（局外側）。⚠ 無盡的難度弧與原關波數無關 |
| 改 **UI／畫面／渲染／音效** | [modules/07](modules/07-presentation.md) |
| 加**音效或粒子**觸發 | [modules/07](modules/07-presentation.md) 的事件佇列機制 |
| 改 **PWA／離線** | [03-change-recipes.md](03-change-recipes.md) §10g |

### 其他

| 任務 | 讀這頁 |
|---|---|
| **動手前**確認不會違反架構約束 | [04-invariants.md](04-invariants.md) ← **第一次改這個專案請務必先讀** |
| 想知道「這件事該發生在哪一層」 | [01-architecture.md](01-architecture.md) |
| 想知道某個資料表欄位的意義 | [02-data-tables.md](02-data-tables.md) |
| 中文術語 ↔ 程式碼識別字對照 | [05-glossary.md](05-glossary.md) |
| **接下來可以做什麼**（待辦清單） | [06-roadmap.md](06-roadmap.md) |
| 我改完了，要回寫哪些文件 | [07-wiki-maintenance.md](07-wiki-maintenance.md) ← **改完務必看** |
| 除錯手法（console 掛載點、密技面板） | [03-change-recipes.md](03-change-recipes.md) §11 |

---

## 頁面總覽

| 頁面 | 內容 |
|---|---|
| [01-architecture.md](01-architecture.md) | 四層分層、依賴方向、資料流、GameState 概觀 |
| [02-data-tables.md](02-data-tables.md) | 各資料表的欄位意義、平衡基準、公式常數 |
| [03-change-recipes.md](03-change-recipes.md) | 「我想做 X」→ 動哪些檔案，附範例程式碼 |
| [04-invariants.md](04-invariants.md) | 不可違反的架構約束、已知陷阱、測試涵蓋範圍 |
| [05-glossary.md](05-glossary.md) | 術語對照表 |
| [06-roadmap.md](06-roadmap.md) | 可擴充方向與實作切入點 |
| [07-wiki-maintenance.md](07-wiki-maintenance.md) | 回寫規則、模組頁模板、歷史文件錯誤 |
| **`modules/`** | **每個程式子系統一頁的深入說明（見下）** |

### 模組頁（依子系統切分）

| 頁面 | 負責的原始碼 |
|---|---|
| [modules/01-state-and-units.md](modules/01-state-and-units.md) | `sim/types.ts` `sim/state.ts` — 單位模型、`recalcUnits` 契約 |
| [modules/02-actions-and-combine.md](modules/02-actions-and-combine.md) | `sim/actions.ts` `sim/combine.ts` — 玩家操作、組詞判定 |
| [modules/03-board-and-mapgen.md](modules/03-board-and-mapgen.md) | `sim/board.ts` `sim/mapgen.ts` `data/levels/` — 棋盤、路徑、關卡 |
| [modules/04-combat-and-skills.md](modules/04-combat-and-skills.md) | `sim/combat.ts` `sim/skills.ts` `sim/bonds.ts` `data/bonds.ts` — 戰鬥、技能、羈絆 |
| [modules/05-economy-and-waves.md](modules/05-economy-and-waves.md) | `sim/economy.ts` `waves.ts` `pool.ts` `step.ts` `data/enemies.ts` — 經濟、波次、字池、tick |
| [modules/06-meta-progression.md](modules/06-meta-progression.md) | `core/save.ts` `data/shop.ts` `upgrades.ts` `loadout.ts` `achievements.ts` `core/devtools.ts` — 局外進度 |
| [modules/07-presentation.md](modules/07-presentation.md) | `app.ts` `render/` `ui/` `input/` `core/loop.ts` `audio.ts` — 呈現與操作 |

---

## 30 秒摘要

- 格狀塔防。玩家花「糧」征兵抽到隨機**字**，拖到棋盤空地。
- 同字同階可**疊合升階**（一階→五階，每階 ×1.55），品質會被武將繼承。
- 相鄰的字組成 `data/generals.ts` 裡的配方時 → 疊上一層**武將**（多格單位、更強、有主動技）。
  **字牌不會消失**，武將是疊在字牌上的一層。
- 湊齊特定武將組合 → 觸發**羈絆**全域加成與**組合技**。
- 敵人沿預先算好的單一路徑從「寨」走到「營」，抵達就扣生命。
- 9 關，其中 6 關**每局隨機生成地形**（由構造保證沒有死路，見 `sim/mapgen.ts`）。
- 每關通關後開放**無盡變體**（`endless_<key>`）：`maxWave = Infinity`，血量照 40 波的參考弧一路長上去。
- 每關宣告 `bias`（偏好的敵人特徵），加權該類敵人與 BOSS 的出現率，並自動推導出選單的「建議帶」標籤。
- 全部視覺由 Canvas 2D 繪製，**零外部圖片／字型資產**；音效由 Web Audio 即時合成，**零音檔**。
- 抽卡有四層收斂：**編隊**（玩家手動指定）→ 每局字池 → 熟悉度加權 → 心願單。
- 局外系統：圖鑑（字／武將／敵人三頁）、兵書（4 種數值升級）、商城（16 種可升級被動道具）、編隊、心願單、
  成就（24 個，共 2130 聲望）、每日挑戰（日期即種子）、無盡模式（獨立高分榜）、局內續玩存檔。共用「聲望」貨幣。
- 內容量：**71 字／69 武將（26 姓名配方＋43 字組合）／13 羈絆／33 主動技／5 組合技／22 種敵人（10 一般＋12 BOSS）／9 關**。

---

## 檔案地圖

```
src/
  data/        glyphs.ts      字表（71）
               generals.ts    武將配方（69：26 姓名＋43 字組合）
               bonds.ts       羈絆（13）
               enemies.ts     敵表（22：10 一般 + 12 BOSS）+ 特徵對照表
               levels/index.ts 關卡（9，各帶 bias 敵人偏好）
               upgrades.ts    兵書：4 種數值養成
               shop.ts        商城：16 種可升級被動道具 → Perks
               loadout.ts     編隊：手動挑選字池內容
               daily.ts       每日挑戰：日期 → 關卡與種子（純函式）
               levels/index.ts 末段  無盡變體（由 9 關推導，maxWave: Infinity）
               achievements.ts 成就：24 個「計數器 >= 門檻」+ 一次性聲望
  sim/         types.ts       全部型別（含 GameState / Unit / Perks）
               state.ts       createGame / recalcUnits / 單位建立
               actions.ts     ★ 玩家操作的唯一入口
               combine.ts     ★ 組詞判定（本作核心機制）
               step.ts        每 tick 推進（固定 1/60）
               combat.ts      索敵／傷害／控場／射程
               skills.ts      主動技 + 羈絆組合技
               bonds.ts       羈絆計算
               economy.ts     花費／收入／抽字權重
               waves.ts       波次生成（HP_GROWTH 難度旋鈕）
               pool.ts        每局字池（含編隊模式）
               board.ts       棋盤解析與路徑
               mapgen.ts      隨機地形生成
               events.ts      事件佇列（sim → app 的唯一出口）
               persist.ts     局內存檔的快照與還原（續玩）
  render/      renderer.ts  theme.ts  fx.ts（攻擊特效畫法）  particles.ts
  ui/          hud.ts  screens.ts（九個全螢幕畫面）  wish.ts（心願單）
  input/       pointer.ts
  core/        loop.ts（固定步長）  rng.ts（mulberry32）  save.ts（localStorage）
               audio.ts（Web Audio 合成）  pwa.ts（SW 註冊）  devtools.ts（開發密技）
  app.ts       ★ 唯一同時認識四層的檔案
  main.ts      啟動 + __dev 除錯掛載點
tools/
  dumb-ai.ts       傻 AI 的固定策略（sim 與 econ 共用，改它等於改難度量尺）
  autobalance.ts   npm run sim（難度儀表板：陣亡中位數 vs 該關波數的一半）
  econ-report.ts   npm run econ（經濟儀表板：逐波收入拆解與征兵次數）
  make-icons.html  用瀏覽器開啟即可重新產生 PWA 圖示
public/
  manifest.webmanifest  PWA 資訊
  icons/                icon.svg（可縮放）+ icon-192.png（iOS 用）
vite.config.ts     含 pwaPlugin()：build 時產生 sw.js
```
