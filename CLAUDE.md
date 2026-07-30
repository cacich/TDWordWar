# TDWordWar《字戰三國》— 給 AI 協作者的專案手冊

文字塔防。每個「字」是一座塔，相鄰的字組成詞（武將名／兵種名）時融合成更強的單位。
規格書：[docs/game-design.md](docs/game-design.md)　深入細節：[docs/llm-wiki/](docs/llm-wiki/00-index.md)

**接到任務時的最短路徑**：先看 [docs/llm-wiki/00-index.md](docs/llm-wiki/00-index.md) 的
「任務 → 該讀哪一頁」路由表，它會直接指到單一頁面。九成的需求只需要改 `src/data/` 底下一個檔案。
每個程式子系統都有一份對應的深入說明在 [docs/llm-wiki/modules/](docs/llm-wiki/modules/)。

**⚠ 改完之後**：依 [07-wiki-maintenance.md](docs/llm-wiki/07-wiki-maintenance.md) 的
「改了程式碼 → 要回寫哪裡」對照表更新文件。這份 wiki 是靠每次改動回寫維持有效的——
一旦跟程式碼脫節就會從資產變成負債。

## 指令

```bash
npm run dev             # 開發伺服器（http://localhost:5188）
npm test                # 250 個單元測試，改完務必跑
npm run typecheck       # tsc --noEmit
npm run sim             # 難度儀表板：傻 AI 跑 30 局，印陣亡波次中位數與「目標的偏差」
npm run econ            # 經濟儀表板：逐波印收入拆解與征兵次數（設計目標 1～2 次/波）
npm run sim 16 guandu   # 指定局數與關卡（無盡變體：npm run sim 20 endless_guandu）
npm run ai              # AI 代管成績：強 AI 跑主線九關，印通關率與陣亡波次中位數
npm run ai 8 guandu     # 指定局數與關卡
npm run build           # typecheck + 靜態打包到 dist/（含 PWA 的 sw.js）
npm run preview         # 用正式版模式預覽（測 PWA／離線只能用這個，dev 模式不註冊 SW）
```

`npm run sim` 是本專案的難度儀表板。改任何數值後跑一次。
**難度目標：傻 AI 的陣亡中位數 ≈ 該關 `maxWave` 的一半**（±20% 內算達標，工具會直接印偏差）。
現況：黃巾 6／12・董卓 9／18・巨鹿 15／30・官渡 12／24・赤壁 14／30・五丈原 20／40・
襄陽 17／32・漢中 15／32・洛陽 19／40。
**無盡變體**（`endless_<key>`，`maxWave: Infinity`）沒有總波數，目標改成 `WAVE_REF/2 = 20`：黃巾 22・巨鹿 21・洛陽 19。
這件事能對每一關同時成立，是因為血量的指數吃「相對進度」而不是絕對波次（`sim/waves.ts` 的 `WAVE_REF`），
所以 **`maxWave` 同時是關卡長度與難度弧的陡度**——改短一關等於把同一條弧壓得更陡。

`npm run econ` 是經濟儀表板。**經濟目標：一波只夠征兵 1～2 次**（現況 1.20～2.00）。
收入佔比：擊殺賞金 ≈65%／每波固定收入 ≈30%／場上產糧 ≈5%，主力旋鈕是 `data/enemies.ts` 的 `bounty`。

## 分層與依賴方向

```
data/  ← 純資料表（字、武將、敵人、羈絆、關卡）
  ↑
sim/   ← 純邏輯（棋盤、組詞、戰鬥、經濟、波次）★ 不得碰 DOM
  ↑
render/ ui/ input/  ← 呈現與操作
  ↑
app.ts ← 唯一同時認識上面全部四層的檔案
```

**鐵則：`src/sim/` 與 `src/data/` 不可 import 任何 render / ui / input / DOM 相關模組。**
這條規則讓整個遊戲邏輯能在 Node 裡跑（`npm run sim` 與所有單元測試都依賴它），是本專案最重要的架構約束。

## 七條不可違反的規則

1. **禁用 `Math.random()`** — 一律用 `state.rng`（`core/rng.ts` 的 mulberry32）。同種子必須產出同一場對局。
2. **改動 `state.units` 或 `state.hand` 後必須呼叫 `recalcUnits(state)`** — 武將屬性、羈絆倍率、光環與組詞提示都在那裡重算。
3. **玩家操作一律經由 `sim/actions.ts`** — action 只改 state，不碰 DOM、不播音效、不回傳 JSX。
4. **`Unit.cells` 必須依「正讀順序」**（橫向左→右、縱向上→下）— 組詞判定與武將渲染都依賴這個順序。
5. **模擬固定 1/60 步長** — `sim/` 內不可讀 `performance.now()`／`Date.now()`。
6. **一格可能有多個 unit** — 武將是疊在字牌上的一層，且一個字可同時屬於兩個武將。
   取用請用 `glyphAt()` / `formsAt()`，並記得武將成員字牌不重複計算攻擊／光環／產糧。
   詳見 [01-architecture.md](docs/llm-wiki/01-architecture.md) 的「字牌與武將的關係」。
7. **音效與粒子只能透過 `state.events` 觸發** — `sim/` 用 `emit()` 推純資料事件，
   app 層每幀 drain 成音效與粒子。不要在 `sim/` 直接呼叫 Audio 或 canvas。

完整清單與陷阱：[docs/llm-wiki/04-invariants.md](docs/llm-wiki/04-invariants.md)

## 除錯

瀏覽器 console 有兩個掛載點（定義在 `src/main.ts`）：

```js
__game.state                  // 目前 GameState
__game.togglePause()          // 暫停
__dev.give('張', '飛')        // 塞字進手牌
__dev.put('張', 0, 1)         // 直接放到 (col=0, row=1)，會自動判定組詞
__dev.put('刀', 2, 1, 3)      // 第四個參數是字牌等級
```

## 程式風格

- 註解用繁體中文，寫「為什麼」而不是「做什麼」；資料表的每個區塊都要有一行平衡基準說明
- 型別集中在 `src/sim/types.ts`，不要在各檔重複定義
- `tsconfig` 開了 `noUnusedLocals`，多餘的 import 會讓 build 失敗
- 新增資料時沿用既有的 helper（例如武將用 `generals.ts` 裡的 `g()` 與 `TIER_MUL`，不要手寫倍率）

## 目前進度

M0 骨架 ✅　M1 可玩核心 ✅　M2 組詞與經濟 ✅　M3 技能與深度 ✅　M4 內容 ✅　M5 打磨 ✅
M6 PWA ✅（可安裝、離線可玩，Service Worker 由 `vite.config.ts` 的 pwaPlugin() 產生）

內容量：**71 字／69 武將（26 姓名配方＋43 字組合）／13 羈絆／33 個主動技／5 個組合技／22 種敵人（10 一般＋12 BOSS）／9 關**
（3 關固定地圖 + 6 關隨機地形，每關通關後另開放一個**無盡變體**）。每關宣告 `bias`（偏好的敵人特徵），加權該類敵人與 BOSS 的出現率，
並自動推導出選單上的「建議帶」標籤——見 `data/enemies.ts` 的 `TRAIT_COUNTERS`。
**每個非姓名字都有 2～13 種組合**（車→車騎／車兵／雷車／輜重、陣→風陣／計陣／陣令／雷陣…），
所以不必等姓名字也能經營構築；謀略組合大多**不宣告 `onHit`**，靠 `mergeOnHit` 自動繼承成員效果。
局外：圖鑑（字／武將／敵人三頁）、兵書（4 種永久升級 + 聲望）、商城（16 種聲望購買的被動道具，每種最高 3 級，見 `data/shop.ts`）、
編隊（從已解鎖的字／武將手動挑選字池內容，見 `data/loadout.ts`）、心願單、
成就（24 個，達成即發聲望共 2130，見 `data/achievements.ts`）、
每日挑戰（日期即種子，全世界同一局，見 `data/daily.ts`；⚠ 一律用中性 meta，否則無法重現）、
無盡模式（9 關各一個推導變體，`maxWave: Infinity`，見 `data/levels/index.ts` 末段；
⚠ 難度弧退回 `WAVE_REF`，與原關波數無關；成績記在 `meta.endless` 而非 `meta.best`）、
局內續玩存檔（見 `sim/persist.ts`）。音效與粒子皆由 sim 事件佇列驅動。
開發密技面板（選單標題連點 7 下）供測試用，見 `core/devtools.ts`。
**AI 代管**（局內頂列「代管」鈕）：開啟後電腦自動征兵／組將／疊高／佈陣／許願，見 `sim/autoplay.ts`
（純 sim 層，與 `npm run ai` 跑同一份程式碼）。它是估值驅動的貪婪策略，打得比難度量尺（`tools/dumb-ai.ts`）
深得多，但**不保證通關**——末段指數難度需要人類級的長線規劃，逐拍貪婪跨不過（旋鈕與誠實說明見檔頭 `TUNE`）。
⚠ 這份是**強** AI，`tools/dumb-ai.ts` 是**難度量尺**，兩者刻意分開，不可互相取代。
節奏是「**想得少、一次做完**」：`THINK_INTERVAL`（1.2 模擬秒）是手機發熱的主旋鈕，而一輪決策**沒有動作數上限**——
`runActions` 會一直做到沒有值得做的事。想省電就把間隔往上加，不要去限制每輪的動作數（那只會讓擺陣落後於敵人）。
⚠ 間隔吃模擬時間，所以 3× 速時實際思考頻率也是 3 倍。

未實作項目與已知陷阱列在 [docs/llm-wiki/04-invariants.md](docs/llm-wiki/04-invariants.md)。
新增技能／控場狀態的步驟在 [03-change-recipes.md](docs/llm-wiki/03-change-recipes.md) §10、§10b。
