# LLM WIKI — 索引

這份 wiki 的目的：**讓後續的 AI 協作不需要重新讀完整個 codebase 就能安全地改東西**。
每篇都短、可獨立閱讀，並且明確指出檔案路徑與行為契約。

| 檔案 | 什麼時候讀 |
|---|---|
| [01-architecture.md](01-architecture.md) | 想知道「這件事該發生在哪一層」、資料如何流動、GameState 長什麼樣 |
| [02-data-tables.md](02-data-tables.md) | 要調數值或新增字／武將／敵人／羈絆，需要知道每個欄位的意義與平衡基準 |
| [03-change-recipes.md](03-change-recipes.md) | **最常用**。「我想做 X」→ 改哪些檔案、附範例程式碼 |
| [04-invariants.md](04-invariants.md) | 動手前確認不會踩到架構約束；也記錄已知陷阱與尚未實作的項目 |
| [05-glossary.md](05-glossary.md) | 中文遊戲術語 ↔ 程式碼識別字對照（例如「字牌」= `glyph`） |

## 30 秒摘要

- 格狀塔防。玩家花「糧」征兵抽到隨機**字**，拖到棋盤空地。
- 同字同階可**疊合升階**（一階→五階，每階 ×1.55），品質會被武將繼承。
- 相鄰的字組成 `data/generals.ts` 裡的配方時 → 融合成**武將**（多格單位、更強、有主動技）。
- 湊齊特定武將組合 → 觸發**羈絆**全域加成與**組合技**。
- 敵人沿預先算好的路徑從「寨」走到「營」，抵達就扣生命。
- 6 關，其中 3 關**每局隨機生成地形**（由構造保證沒有死路，見 `sim/mapgen.ts`）。
- 全部視覺由 Canvas 2D 繪製，**零外部圖片／字型資產**；音效由 Web Audio 即時合成，**零音檔**。
- 抽卡有三層收斂：每局字池 → 熟悉度加權 → 玩家指定的心願單。
- 局外有圖鑑與兵書（聲望買永久升級）。

## 檔案地圖（只列關鍵）

```
src/
  data/        glyphs.ts  generals.ts  enemies.ts  bonds.ts  levels/index.ts
               upgrades.ts（兵書：局外養成）
  sim/         types.ts  state.ts  actions.ts  step.ts  events.ts（事件佇列）
               board.ts  combine.ts★  combat.ts  skills.ts  economy.ts  waves.ts
               bonds.ts  mapgen.ts（隨機地形）  pool.ts（每局字池）
  render/      renderer.ts  theme.ts  fx.ts（攻擊特效畫法）  particles.ts
  ui/          hud.ts  screens.ts（選關／圖鑑／兵書）  wish.ts（心願單）
  input/       pointer.ts
  core/        loop.ts  rng.ts  save.ts  audio.ts（Web Audio 合成音效）  pwa.ts（SW 註冊）
  app.ts       接線層（含圖鑑／通關進度的記錄）
  main.ts      啟動 + __dev 除錯掛載點
tools/
  autobalance.ts   npm run sim（在 Node 跑純模擬）
  make-icons.html  用瀏覽器開啟即可重新產生 PWA 圖示
public/
  manifest.webmanifest  PWA 資訊
  icons/                icon.svg（可縮放）+ icon-192.png（iOS 用）
vite.config.ts     含 pwaPlugin()：build 時產生 sw.js
```

★ `sim/combine.ts` 是本作的核心機制，改動前先讀 [01-architecture.md](01-architecture.md#組詞判定的合約)。
