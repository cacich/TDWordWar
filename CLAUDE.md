# TDWordWar《字戰三國》— 給 AI 協作者的專案手冊

文字塔防。每個「字」是一座塔，相鄰的字組成詞（武將名／兵種名）時融合成更強的單位。
規格書：[docs/game-design.md](docs/game-design.md)　深入細節：[docs/llm-wiki/](docs/llm-wiki/00-index.md)

**接到任務時的最短路徑**：先看 [docs/llm-wiki/03-change-recipes.md](docs/llm-wiki/03-change-recipes.md)，
裡面列出「我想改 X → 動哪個檔案」。九成的需求只需要改 `src/data/` 底下一個檔案。

## 指令

```bash
npm run dev             # 開發伺服器（http://localhost:5188）
npm test                # 135 個單元測試，改完務必跑
npm run typecheck       # tsc --noEmit
npm run sim             # 自動平衡：傻 AI 跑 30 局，印出陣亡波次分佈
npm run sim 16 guandu   # 指定局數與關卡
npm run build           # typecheck + 靜態打包到 dist/（含 PWA 的 sw.js）
npm run preview         # 用正式版模式預覽（測 PWA／離線只能用這個，dev 模式不註冊 SW）
```

`npm run sim` 是本專案的難度儀表板。改任何數值後跑一次。
目前各關的傻 AI 中位數：黃巾 12（滿關）／董卓 18（滿關）／巨鹿 20／官渡 18／赤壁 18／五丈原 20。
前兩關是教學弧，傻 AI 打得完是刻意的。

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

內容量：**53 字／28 武將／8 羈絆／19 個主動技／4 個組合技／6 關**（3 關固定地圖 + 3 關隨機地形）
局外：圖鑑、兵書（4 種永久升級 + 聲望）、商城（16 種聲望購買的被動道具，每種最高 3 級，見 `data/shop.ts`）、心願單。音效與粒子皆由 sim 事件佇列驅動。開發密技面板（選單標題連點 7 下）供測試用，見 `core/devtools.ts`。

未實作項目與已知陷阱列在 [docs/llm-wiki/04-invariants.md](docs/llm-wiki/04-invariants.md)。
新增技能／控場狀態的步驟在 [03-change-recipes.md](docs/llm-wiki/03-change-recipes.md) §10、§10b。
