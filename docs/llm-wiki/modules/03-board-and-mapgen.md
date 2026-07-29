# 棋盤、路徑與隨機地形

> **負責檔案**
>
> | 檔案 | 規模 | 職責 |
> |---|---|---|
> | `src/sim/board.ts` | 107 行 | 地圖字串 → `Board`；BFS 算出 `path`；cell ↔ (col,row) 座標換算 |
> | `src/sim/mapgen.ts` | 109 行 | `generateMap()`：由構造保證合法的蛇形走廊隨機地圖 |
> | `src/data/levels/index.ts` | 147 行 | `LevelDef` 型別 + 6 個關卡的難度旋鈕 + `LEVEL_ORDER` |
>
> **上游依賴**：`sim/types.ts`（`Board` / `TileKind`，types.ts:6-16）、`core/rng.ts`（`randInt`，mapgen.ts:20）。
> `board.ts` 與 `levels/index.ts` **零依賴**（levels 是純資料，board 只 import 型別）。
>
> **下游使用者**：`sim/state.ts:103-104`（開局組裝）、`sim/combat.ts:49-94`（射程與敵人座標）、
> `sim/step.ts:115-139`（敵人前進與漏怪）、`sim/combine.ts:33-56`（相鄰判定）、
> `sim/actions.ts:137,189`（落點合法性）、`input/pointer.ts:243`、`render/renderer.ts:82-175`、
> `ui/screens.ts:330-353`（選關卡片）、`tools/autobalance.ts:22-34`。

## 這個模組解決什麼問題

1. 把人類可讀的地圖字串轉成執行期資料結構，**並在轉換時就強制驗證**（列長、字元合法、S→C 連通）。
2. 把「敵人怎麼走」壓縮成一維：`board.path` 是 cell 索引陣列，敵人只有一個純量 `Enemy.dist`
   （types.ts:205-206，單位＝路徑段數，float）。執行期**不做任何尋路**，效能可預測、可重現。
3. 提供「每局地形都不同」的關卡，且**不可能生出死路**——因為路徑是先畫出來的，不是事後檢查的。

## 核心概念

### 地圖字元（唯一定義處：board.ts:7-13）

| 字元 | `TileKind` | 可放字牌？ | 敵人可走？ | 備註 |
|---|---|---|---|---|
| `S` | `spawn` | ✗ | ✓ | 出兵口（渲染為「寨」），**必須恰好一個** |
| `C` | `camp` | ✗ | ✓ | 大營（渲染為「營」），**必須恰好一個** |
| `#` | `path` | ✗ | ✓ | 路 |
| `P` | `plot` | ✓ | ✗ | 空地——`isPlot()` 是**唯一**的落點合法性來源 |
| `.` | `block` | ✗ | ✗ | 障礙（山石），純粹佔位浪費空間 |

未列出的字元 → `parseMap` 直接拋 `未知地形字元`（board.ts:33）。

### `Board`（types.ts:8-16）

```ts
{ cols, rows, tiles: TileKind[] /* 長度 cols*rows，索引 = r*cols+c */,
  path: number[] /* spawn→camp 的 cell 序列 */, spawn: number, camp: number }
```

`path` 只在 `parseMap()` 內算一次（board.ts:43），**之後永不重算**。
放塔不會改變路徑——本作沒有 maze building，字牌不是障礙物。

### 座標系統（board.ts:88-103）

- `cellIndex(board, col, row) = row * cols + col`
- `cellCol = idx % cols`、`cellRow = Math.floor(idx / cols)`
- `cellCenter(idx) = { x: col + 0.5, y: row + 0.5 }` —— 單位是「格」，**回傳格中心**，
  給射程（combat.ts:53,76）、敵人插值座標（combat.ts:91-93）、粒子特效用。整數座標是格的左上角。
- `inBounds(board, col, row)` 收的是 **col/row 不是 idx**；`cellCol/cellRow` 完全不檢查邊界。
  畫布 px → cell 的轉換在 `renderer.ts:93-99`，越界回傳 `-1`，呼叫端必須自己擋（pointer.ts:243）。
- `neighbors4()`（board.ts:76-86）目前只被 `findPath` 用；留給未來的洪水填充。

### 路徑是「BFS 找出的單一路徑」

`findPath()`（board.ts:49-74）從 `spawn` 做 4 向 BFS，`WALKABLE = ['path','spawn','camp']`（board.ts:47），
回溯 `prev` 得到一條最短路。走不到 `camp` → 拋 `出兵口無法抵達大營`。

**所有敵人共用這條 `path`，包含飛行單位。** `Enemy.flying` 只影響「能不能被打到」
（`canHit()`，combat.ts:96-101，需 `baseRange >= ANTI_AIR_RANGE`），**完全不影響移動路線**。
⚠ `docs/game-design.md:357` 寫「飛賊直線飛越障礙」——**那是過時的規格文字，程式沒有這個行為**，
不要照著它改。

## 主要流程

### 開局（state.ts:102-108）

```
mulberry32(seed) ─┬─→ generateMap(rng, level.gen)   ← 只有 gen 關卡會走
                  │        ↓ string[]
                  ├─→ parseMap(map, level.key) → Board（含 path）
                  └─→ buildGlyphPool(rng, level, loadout)   ← 吃同一顆 rng 的後續數列
```

固定地圖關卡跳過 `generateMap`，所以 **`rng` 在進入 `buildGlyphPool` 時的位置不同**。
→ 陷阱：任何改動 `generateMap` 抽 rng 的**次數**，都會連帶改掉隨機關卡的字池結果（見下）。

### `generateMap` 的兩階段（mapgen.ts:35-109）

**階段 1 `carve()`（mapgen.ts:54-87）—— 蛇形骨架**

1. 起點：最上列的隨機一欄；方向朝「離自己較遠的那一側」，路才長（mapgen.ts:58-60）。
2. 迴圈：橫走 → 轉向 → 往下掉 `gap` 列（65% 取 2、否則 3，mapgen.ts:77）。
   橫走剩餘空間 `room < MIN_RUN(4)` 就跳過這段橫走（mapgen.ts:65-66）；
   否則走 `fullRunChance` 機率走滿、不然走 `randInt(MIN_RUN, room)` 步。
3. 收尾：垂直落到最下列（mapgen.ts:84），該格即為大營。

外層重試最多 `MAX_ATTEMPTS = 24` 次，每次把 `fullRunChance` 加 0.02，越後面越傾向走滿整列；
取第一個達到 `minPathLen` 的結果，否則**保留最長的那個並照樣回傳**（mapgen.ts:37-47）。
→ `generateMap` **永不拋錯**；`minPathLen` 設得太貪心不會爆，只會安靜地產出短路（由測試抓）。

**階段 2 `paint()`（mapgen.ts:90-109）**
全部填 `P` → 路徑塗 `#` → 首格 `S`、末格 `C` → 剩下的 `P` 以 `blockRate`（預設 0.07）翻成 `.`。

### ★ 走廊不變量：可走格數 == 路徑長度

mapgen.ts:8-13 的註解解釋了幾何條件（橫向段至少隔 2 列，垂直段只在端點接觸橫向段
→ induced path，任兩個非相鄰走廊格不會貼邊）。測試把關在
**`src/sim/__tests__/mapgen.test.ts:25-35`**：`map` 裡 `#/S/C` 的總數必須等於 `board.path.length`。

為什麼這條性質是命脈：

- 若走廊有分岔或兩段貼邊，BFS 會找到**比設計者畫出的更短的捷徑**，敵人的實際行走路線
  就不再是 `carve()` 畫的那條 → 關卡長度與 `minPathLen` 全部失效。
- `Enemy.dist` 是沿 `path` 的一維進度；貼邊的走廊會讓「路徑上距離很遠、實際格子相鄰」
  同時成立，`pierce`（combat.ts:302-311）與 `lineStrike`（skills.ts:101-128）以 `dist` 做的
  範圍判定會出現視覺與判定不符。
- 走廊兩側必然留有 `P`，塔的射程規劃（`RANGE_MUL`、`GENERAL_RANGE_BONUS`）才有意義；
  另有測試要求 `P` 至少 30 格（mapgen.test.ts:46-53）。

不要改成「隨機 DFS 亂挖再檢查」——mapgen.ts:15-18 記錄了已經試過並失敗的原因
（9×14 常只挖到 38 格，達不到 44，幾乎每次退回保險版型，反而失去隨機性）。

### 障礙不阻擋射線（設計決定 #2）

combat.ts:2-3 明文：索敵只算歐氏距離，不做視線判定。`.` 只是「不能放東西的格子」，
不會遮擋攻擊，也不會讓敵人繞路（`block` 不在 `WALKABLE` 內，敵人本來就不會走上去）。
提高 `blockRate` 的實際效果是**壓縮玩家的落點選擇**，不是增加掩體。

## 契約與陷阱

1. **每一列長度必須等於 `cols`**（= `map[0].length`，board.ts:21,28-30）。
   少一個字元就拋 `地圖 X 第 N 列長度…`。測試：`core.test.ts:25-33` 解析所有固定地圖。
   注意 `cols` 取自第 0 列，所以第 0 列打錯會導致「其他每一列都報錯」。
2. **`LevelDef.pool` 是必填欄位**（levels/index.ts:26）。舊版文件的範例漏了它，
   照抄會直接 TS 編譯失敗（`tsconfig` 嚴格 + `noUnusedLocals`）。
3. **多個 `S` 或多個 `C` 不會報錯**：board.ts:36-37 是無條件覆寫，**最後出現的那個生效**，
   前面的變成無主的可走格 → 立刻破壞「可走格數 == 路徑長度」。手寫地圖時自己數。
4. **禁用 `Math.random()`**：`generateMap` 必須吃傳入的 `rng`（mapgen.ts:35）。
   `randInt(rng, min, max)` 是**兩端閉區間**（rng.ts:27-29）。
5. **不要改動 `generateMap` 消耗 rng 的次數**，除非你接受隨機關卡的字池結果一起變動
   （state.ts:102-108 共用同一個 rng 實例）。純粹調 `blockRate` 這種「抽的次數不變」的改動是安全的。
6. **`gen.cols` 至少要 5**：`MIN_RUN = 4`，`room = cols-1-col`，`cols <= 4` 時橫走永遠不成立，
   路會退化成一條直落的垂直線。
7. **新增 `gen` 關卡會自動被 60 個種子 × 4 條斷言掃過**（mapgen.test.ts:11-23 掃所有
   `LEVELS[k].gen` 的關卡）。`minPathLen` 訂太高 → 測試紅字，不是執行期錯誤。
   現行比例可當基準：9×14 → 44、9×15 → 48、9×16 → 52（約 `rows × 3.2`）。
8. **`isPlot()` 是唯一落點閘門**（actions.ts:137,189；pointer.ts:243）。若將來要允許在路上放東西，
   改的是這三處呼叫端，不是 `board.ts`。
9. `board.path`／`board.tiles` 在開局後視為 **immutable**。沒有任何程式碼支援中途改地形。
10. `sim/` 與 `data/` 不得 import render/ui/input（CLAUDE.md 鐵則）。`levels/index.ts` 目前零 import，
    請保持這樣——`ui/screens.ts` 是單向依賴它。

## 6 個關卡一覽（levels/index.ts:31-144）

| 順序 | key | 名稱 | 地形 | 尺寸 | startFood | lives | maxWave | hpMul | pool (support/generals) | `npm run sim` 中位數 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `huangjin` | 黃巾之亂 | 固定 `map` | 9×11 | 26 | 4 | 12 | 0.85 | 2 / 3 | 12（滿關） |
| 2 | `dongzhuo` | 討伐董卓 | 固定 `map`（S 在右上、含 `.`） | 9×13 | 24 | 3 | 18 | 1.00 | 3 / 4 | 18（滿關） |
| 3 | `julu` | 巨鹿 | 固定 `map` | 9×14 | 22 | 3 | 30 | 1.15 | 4 / 6 | 20 |
| 4 | `guandu` | 官渡 | `gen` minPathLen 44 | 9×14 | 24 | 3 | 24 | 1.10 | 5 / 6 | 18 |
| 5 | `chibi` | 赤壁 | `gen` minPathLen 48, blockRate 0.13 | 9×15 | 26 | 3 | 30 | 1.20 | 6 / 7 | 18 |
| 6 | `wuzhang` | 五丈原 | `gen` minPathLen 52 | 9×16 | 28 | 2 | 40 | 1.30 | 7 / 9 | 20 |

中位數取自 CLAUDE.md 的「難度儀表板」段落（傻 AI 陣亡波次中位數）。前兩關是教學弧，
傻 AI 打得完是刻意的。**改任何數值後跑 `npm run sim 30 <key>` 對照這張表。**

`JULU = LEVELS.julu`（levels/index.ts:146）是測試與 `createGame()` 的預設關卡（state.ts:97）。

### 固定 `map` vs 隨機 `gen`：怎麼選

| | 固定 `map` | 隨機 `gen` |
|---|---|---|
| 適用 | 教學關、要教特定技巧、要保證某個地形梗（如 S 在右上） | 重玩性、後段關卡、要玩家臨場判斷落點 |
| 可控性 | 完全可控，可以精算路徑長度與塔位 | 只能控長度下限與障礙密度 |
| 風險 | 手寫容易列長對不齊 | 每次改生成器都要重跑 60 種子測試 |

兩者互斥且至少要有一個：`core.test.ts:35-41` 斷言 `Boolean(map) || Boolean(gen)`。
`state.ts:103` 用 `level.map ?? generateMap(rng, level.gen!)`——`map` 優先，兩個都給 `gen` 會被忽略。
`ui/screens.ts:338` 用 `level.gen` 決定選關卡片是否加上 `random` 樣式（顯示「★ 隨機地形」）。

## 我想改 X → 動哪裡

| 想改什麼 | 動哪裡 | 注意 |
|---|---|---|
| 關卡難度（波數／血量倍率／初始糧／命） | `data/levels/index.ts` 對應關卡的 `maxWave`/`hpMul`/`startFood`/`lives` | 改完跑 `npm run sim 30 <key>`，對照上表中位數 |
| 本局字池大小 | 同檔 `pool: { support, generals }` | `generals` 是「幾組姓名配方」不是幾個字（pool.ts:63-66）；數字大＝變化多但難疊高 |
| 隨機地形的路長／破碎度 | 同檔 `gen.minPathLen` / `gen.blockRate` | `minPathLen` 上限見〈契約與陷阱〉7；`blockRate` 只影響落點多寡，不影響射線 |
| 手改固定地圖 | 同檔 `map` 陣列 | 每列等長；恰好一個 `S`、一個 `C`；改完 `npm test` 會驗連通性 |
| 新增一關 | `data/levels/index.ts`（`LEVELS` + `LEVEL_ORDER`） | `LEVEL_ORDER` 決定解鎖鏈（screens.ts:334）與過關後的下一關（app.ts:375-376）；插在中間會改變既有玩家的解鎖順序 |
| 新的地形種類 | `TileKind`（types.ts:6）→ `CHAR_TO_KIND`（board.ts:7-13）→ `WALKABLE`（board.ts:47）→ `drawTiles`（renderer.ts:127-175）→ 若可放置再改 `isPlot` | 四處都要改，漏一處會是「解析成功但畫不出來」或「敵人穿牆」 |
| 生成演算法（走廊形狀） | `sim/mapgen.ts` 的 `carve()` | 必須維持 induced path 性質，否則 mapgen.test.ts:25-35 紅字；別忘了 rng 消耗次數（陷阱 5） |
| 讓障礙阻擋射線 | `sim/combat.ts` 的 `pickTarget`／`effectiveRange` | 這是刻意的設計決定 #2，改動等於改遊戲手感，先確認需求 |

### 新增關卡：可直接複製且能編譯的範本

```ts
// src/data/levels/index.ts —— 加進 LEVELS，並把 key 加到 LEVEL_ORDER
  hefei: {
    key: 'hefei',              // 必須與物件的 key 一致（state.ts 用它回填 state.levelKey）
    name: '合肥',
    subtitle: '★ 隨機地形。窄路久攻',
    startFood: 25,
    lives: 3,
    maxWave: 26,
    hpMul: 1.15,
    pool: { support: 5, generals: 6 },   // ← 必填，漏了會 TS 編譯失敗
    gen: { cols: 9, rows: 14, minPathLen: 44 },  // 二選一：gen 或 map
  },
```

固定地圖版本把 `gen:` 那一行整個換成 `map:`（`cols`/`rows` 由陣列本身決定，每列長度必須一致）：

```ts
    map: [
      'S########',
      'PPPPPPPP#',
      'PPPPPPPP#',
      '#########',
      '#PPPPPPPP',
      '#PPPPPPPP',
      '#########',
      'PPPPPPPPC',
    ],
```

同時要改：

```ts
export const LEVEL_ORDER = ['huangjin', 'dongzhuo', 'julu', 'guandu', 'chibi', 'wuzhang', 'hefei'] as const
```

`LEVELS` 是 `Record<string, LevelDef>`，忘記加進 `LEVEL_ORDER` 不會有型別錯誤——關卡只是不會出現在選關畫面。
反之只加 `LEVEL_ORDER` 不加 `LEVELS` 會被 `core.test.ts:35-41` 抓到。

## 未來擴充：多路徑／雙出生點的阻礙點

目前架構在**多處**硬編碼了「單一 `path` + 單一 `spawn` + 單一 `camp`」。
`Enemy.dist` 是沿唯一 path 的一維純量，這是最深的假設。要改成多路徑，至少要動：

| 位置 | 假設內容 |
|---|---|
| `src/sim/types.ts:12-15` | `Board.path: number[]`（單一陣列）、`spawn: number`、`camp: number`（單值） |
| `src/sim/types.ts:205-206` | `Enemy.dist` 是「沿 path 的段數」，沒有 pathId 欄位 |
| `src/sim/board.ts:23-24,36-37,40` | 掃描時只記一個 spawn／camp，重複的 `S`/`C` 被靜默覆寫 |
| `src/sim/board.ts:42-43,49-74` | `parseMap` 只算一條 BFS 路徑並塞進 `board.path` |
| `src/sim/mapgen.ts:99-100` | `paint()` 只寫一個 `S`、一個 `C` |
| `src/sim/step.ts:87` | 敵人生成時 `dist: 0`，沒有「屬於哪條路」的欄位 |
| `src/sim/step.ts:116,123-125` | `goal = state.board.path.length - 1`，漏怪判定綁單一路徑長度 |
| `src/sim/combat.ts:85-94` | `enemyPos()` 直接索引 `board.path` |
| `src/sim/combat.ts:140` | targeting `'first'` 用 `e.dist` 跨敵人比大小——不同路徑的 dist 不可比 |
| `src/sim/combat.ts:302-311` | `pierce` 用 `|e.dist - target.dist| <= 1.3` 判定同一直線 |
| `src/sim/skills.ts:101-128` | `lineStrike` 以 `dist` 區間取範圍 |
| `src/sim/skills.ts:130-145` | `charge` 用 `dist` 排序取「最前方」 |
| `src/sim/step.ts:50-58` | `stepMeteor` 先用 `dist` 挑最前方敵人（之後才轉歐氏距離） |
| `src/app.ts:216-217,223-225` | `combo`／`leak` 粒子座標直接用 `board.camp` 當發生地點 |
| `tools/autobalance.ts:22-34` | 傻 AI 的落點評分只算「到 `b.path` 的最近距離」 |
| `src/sim/__tests__/mapgen.test.ts:25-35` | 「可走格數 == path 長度」的不變量在多路徑下必須改寫 |

最小可行改法建議：`Board.paths: number[][]` + `Enemy.pathId`，並把
`enemyPos()` 改成 `board.paths[e.pathId]`；所有用 `e.dist` 做跨敵人比較的地方
（combat.ts:140,307；skills.ts:106-108,135）都要先過濾同 `pathId`。

## 相關頁面

- [modules/01-state-and-units.md](01-state-and-units.md) — `GameState`／`Unit` 結構、`recalcUnits`、開局組裝的其餘部分
- [modules/02-actions-and-combine.md](02-actions-and-combine.md) — 落點判定的呼叫端（`isPlot` 的使用者）與組詞相鄰邏輯
- [01-architecture.md](../01-architecture.md) — 分層、「一格可能有多個 unit」與組詞契約
- [02-data-tables.md](../02-data-tables.md) — 字／武將／敵人／羈絆資料表的欄位與平衡基準
- [03-change-recipes.md](../03-change-recipes.md) — 「我想改 X」的全域索引
- [04-invariants.md](../04-invariants.md) — 七條鐵則、已知陷阱、未實作項目
- [05-glossary.md](../05-glossary.md) — 「字牌／武將／空地／大營」↔ 程式碼識別字
- [06-roadmap.md](../06-roadmap.md) — 多路徑等尚未實作的擴充方向
- `docs/llm-wiki/modules/05-meta.md` — 局外養成與編隊字池（`level.pool` 在編隊模式下會被整個取代，pool.ts:58-93）
