# 棋盤、路徑與隨機地形

> **負責檔案**
>
> | 檔案 | 規模 | 職責 |
> |---|---|---|
> | `src/sim/board.ts` | 106 行 | 地圖字串 → `Board`；BFS 算出 `path`；cell ↔ (col,row) 座標換算 |
> | `src/sim/mapgen.ts` | 109 行 | `generateMap()`：由構造保證合法的蛇形走廊隨機地圖 |
> | `src/data/levels/index.ts` | 413 行 | `LevelDef` 型別 + 12 個關卡的難度旋鈕／`bias`／`mods` + `modTags()` + `LEVEL_ORDER` + 12 個無盡變體（`ENDLESS_ORDER`） |
>
> **上游依賴**：`sim/types.ts`（`Board` / `TileKind`，types.ts:20-30；`EnemyTrait`，types.ts:203）、
> `core/rng.ts`（`randInt`，mapgen.ts:20）。
> `board.ts` **零依賴**（只 import 型別）；`levels/index.ts` 只 `import type { EnemyTrait }`（levels/index.ts:27），仍是純資料。
>
> **下游使用者**：`sim/state.ts:147-148`（開局組裝）、`sim/state.ts:160`（`bias` 帶進 `GameState`）、
> `sim/combat.ts:49-94`（射程與敵人座標）、
> `sim/step.ts:227-281`（敵人前進與漏怪）、`sim/combine.ts:33-56`（相鄰判定）、
> `sim/actions.ts:137,189`（落點合法性）、`sim/actions.ts:307`（`bias`／`mods` → `buildWave`）、
> `input/pointer.ts:246`、`render/renderer.ts:82-175`、
> `ui/screens.ts:564-592`（選關卡片，含「建議帶」標籤）、`tools/autobalance.ts:22-34`。

## 這個模組解決什麼問題

1. 把人類可讀的地圖字串轉成執行期資料結構，**並在轉換時就強制驗證**（列長、字元合法、S→C 連通）。
2. 把「敵人怎麼走」壓縮成一維：`board.path` 是 cell 索引陣列，敵人只有一個純量 `Enemy.dist`
   （types.ts:226-227，單位＝路徑段數，float）。執行期**不做任何尋路**，效能可預測、可重現。
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

### `Board`（types.ts:22-30）

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
  畫布 px → cell 的轉換在 `renderer.ts:93-99`，越界回傳 `-1`，呼叫端必須自己擋（pointer.ts:246）。
- `neighbors4()`（board.ts:76-86）目前只被 `findPath` 用；留給未來的洪水填充。

### 路徑是「BFS 找出的單一路徑」

`findPath()`（board.ts:49-74）從 `spawn` 做 4 向 BFS，`WALKABLE = ['path','spawn','camp']`（board.ts:47），
回溯 `prev` 得到一條最短路。走不到 `camp` → 拋 `出兵口無法抵達大營`。

**所有敵人共用這條 `path`，包含飛行單位。** `Enemy.flying` 只影響「能不能被打到」
（`canHit()`，combat.ts:96-101，需 `baseRange >= ANTI_AIR_RANGE`），**完全不影響移動路線**。
⚠ `docs/game-design.md:357` 寫「飛賊直線飛越障礙」——**那是過時的規格文字，程式沒有這個行為**，
不要照著它改。

## 主要流程

### 開局（state.ts:146-152）

```
mulberry32(seed) ─┬─→ generateMap(rng, level.gen)   ← 只有 gen 關卡會走
                  │        ↓ string[]
                  ├─→ parseMap(map, level.key) → Board（含 path）
                  └─→ buildGlyphPool(rng, level, loadout)   ← 吃同一顆 rng 的後續數列
```

固定地圖關卡跳過 `generateMap`，所以 **`rng` 在進入 `buildGlyphPool` 時的位置不同**。
→ 陷阱：任何改動 `generateMap` 抽 rng 的**次數**，都會連帶改掉隨機關卡的字池結果（見下）。

同一支 `createGame()` 還把關卡的敵人偏好搬進 state：`bias: level.bias ?? []`（state.ts:160），
`beginBattle()` 再交給波次生成器 `buildWave(wave, rng, hpMul, state.bias)`（actions.ts:307）。
地形與敵種因此是兩條互不相干的旋鈕——改 `bias` 不會動到地圖，改 `gen` 不會動到敵種。

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
  同時成立，`pierce`（combat.ts:308-317）與 `lineStrike`（skills.ts:101-128）以 `dist` 做的
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
2. **`LevelDef.pool` 是必填欄位**（levels/index.ts:64）。舊版文件的範例漏了它，
   照抄會直接 TS 編譯失敗（`tsconfig` 嚴格 + `noUnusedLocals`）。
   `bias` 型別上可省（levels/index.ts:73），但省掉等於「這關沒有偏好」，
   選關卡片也就不會有「建議帶」標籤——除了教學關 `huangjin` 刻意寫 `bias: []`，其餘關卡都該填，
   `enemies-ext.test.ts:280-290` 會抓沒有推薦手段的關卡。
3. **多個 `S` 或多個 `C` 不會報錯**：board.ts:36-37 是無條件覆寫，**最後出現的那個生效**，
   前面的變成無主的可走格 → 立刻破壞「可走格數 == 路徑長度」。手寫地圖時自己數。
4. **禁用 `Math.random()`**：`generateMap` 必須吃傳入的 `rng`（mapgen.ts:35）。
   `randInt(rng, min, max)` 是**兩端閉區間**（rng.ts:42-44）。
5. **不要改動 `generateMap` 消耗 rng 的次數**，除非你接受隨機關卡的字池結果一起變動
   （state.ts:146-152 共用同一個 rng 實例）。純粹調 `blockRate` 這種「抽的次數不變」的改動是安全的。
6. **`gen.cols` 至少要 5**：`MIN_RUN = 4`，`room = cols-1-col`，`cols <= 4` 時橫走永遠不成立，
   路會退化成一條直落的垂直線。
7. **新增 `gen` 關卡會自動被 60 個種子掃過**（mapgen.test.ts:8 的 `GEN_LEVELS` 取所有
   `LEVELS[k].gen` 的關卡，目前 6 關；mapgen.test.ts:11-23 對每顆種子做 3 條斷言）。
   `minPathLen` 訂太高 → 測試紅字，不是執行期錯誤。
   現行比例可當基準：9×14 → 44、9×15 → 48~50、9×16 → 52~54、9×17 → 58（約 `rows × 3.2~3.4`）。
8. **`isPlot()` 是唯一落點閘門**（actions.ts:137,189；pointer.ts:246）。若將來要允許在路上放東西，
   改的是這三處呼叫端，不是 `board.ts`。
9. `board.path`／`board.tiles` 在開局後視為 **immutable**。沒有任何程式碼支援中途改地形。
10. `sim/` 與 `data/` 不得 import render/ui/input（CLAUDE.md 鐵則）。`levels/index.ts` 目前零 import，
    請保持這樣——`ui/screens.ts` 是單向依賴它。

## `LevelDef` 欄位（levels/index.ts:29-82）

| 欄位 | 必填 | 作用 |
|---|---|---|
| `key` / `name` / `subtitle` | ✓ | `key` 必須與 `LEVELS` 的物件鍵一致（`state.levelKey` 由它回填，state.ts:157） |
| `map?: string[]` | 二選一 | 固定地圖。優先於 `gen`（state.ts:147） |
| `gen?: { cols, rows, minPathLen, blockRate? }` | 二選一 | 隨機地形參數，`blockRate` 預設 0.07 |
| `startFood` / `lives` / `hpMul` | ✓ | 容錯度與 ±20% 的難度微調 |
| `maxWave` | ✓ | **只是關卡長度**（打幾波）。`Infinity` 時就是無盡（見下方「無盡變體」） |
| `arc` | ✓ | **難度主旋鈕**：要在 `maxWave` 波內走完幾個參考波。越大越難；預期傻 AI 中位數 ≈ `maxWave × 20 / arc` |
| `pool: { support, generals }` | ✓ | 本局字池大小（pool.ts:63-66）；漏填直接 TS 編譯失敗 |
| `bias?: EnemyTrait[]` | 實質必填 | 這一關偏好哪些敵人特徵 |
| `endless?: boolean` | ✗ | 只有 UI 讀它（顯示「∞」、成績記在哪份榜上）；sim 一律只看 `maxWave === Infinity` |
| `mods?: LevelMods` | ✗ | **戰場特性**：`bossEvery` / `spawnGap` / `enemySpeedMul` / `rangeMul`，型別在 types.ts。全部是中性預設值（省略＝舊行為），所以既有關卡不受影響。⚠ 它會實質改變難度但 `arc` 換算的預期值不知道，加了一定要重跑 sim |

### `bias` 一個欄位驅動兩件事

```
level.bias ──→ state.bias (state.ts:160) ──→ buildWave (actions.ts:307)
   │                                            └→ weightOf(): 帶該特徵的敵人與 BOSS 權重 ×BIAS_WEIGHT
   │                                               （waves.ts:95-96,89-91,108；BIAS_WEIGHT = 4，waves.ts:36）
   └──→ countersFor(level.bias) (enemies.ts:205-211) ──→ 選關卡片的「建議帶」標籤（screens.ts:571-573,510）
```

推導鏈只有**一個來源**：敵人在 `enemies.ts` 宣告 `traits`，`TRAIT_COUNTERS`（enemies.ts:33-41）
把特徵映成應對手段，`COUNTER_LABEL`（enemies.ts:43-50）給中文字。
**關卡資料裡不要再手寫一份推薦清單**，否則會出現兩份不同步的真相。
合法特徵是 `EnemyTrait`（types.ts:203）：`swarm` / `armored` / `flying` / `fast` / `healer` / `splitter` / `tanky`。
新增特徵時要同步補 `TRAIT_COUNTERS`、`TRAIT_LABEL`（enemies.ts:52-60），
`enemies-ext.test.ts:131-139` 會抓漏。

## 12 個關卡一覽（levels/index.ts:108-360）

4 關固定地圖（教學弧 + 巨鹿 + 虎牢關）+ 8 關隨機地形。

| 順序 | key | 名稱 | 地形 | 尺寸 | startFood | lives | maxWave | **arc** | hpMul | pool (support/generals) | `bias` | 建議帶（推導結果） | sim 中位數 | 比例 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `huangjin` | 黃巾之亂 | 固定 `map`（C 在**左下**） | 9×11 | 26 | 4 | 12 | 20 | 0.85 | 2 / 3 | `[]` | 無（教學關刻意不給） | 12 | 1.00 |
| 2 | `dongzhuo` | 討伐董卓 | 固定 `map`（S 在右上、含 `.`） | 9×13 | 24 | 3 | 18 | 23 | 1.00 | 3 / 4 | `flying` | 對空 | 16 | 0.89 |
| 3 | `julu` | 巨鹿 | 固定 `map` | 9×14 | 22 | 3 | 30 | 28 | 1.15 | 4 / 6 | `swarm` | 範圍攻擊、貫穿 | 23 | 0.77 |
| 4 | `guandu` | 官渡 | `gen` minPathLen 44 | 9×14 | 24 | 3 | 24 | 31 | 1.10 | 5 / 6 | `fast` | 控場 | 18 | 0.75 |
| 5 | `chibi` | 赤壁 | `gen` minPathLen 48, blockRate 0.13 | 9×15 | 26 | 3 | 30 | 31 | 1.20 | 6 / 7 | `armored` | 持續傷害、單體高傷 | 19 | 0.63 |
| 6 | `wuzhang` | 五丈原 | `gen` minPathLen 52 | 9×16 | 28 | 2 | 40 | 32 | 1.10 | 7 / 9 | `healer` `tanky` | 單體高傷、持續傷害 | 25 | 0.63 |
| 7 | `xiangyang` | 襄陽 | `gen` minPathLen 50 | 9×15 | 28 | 3 | 32 | 39 | 1.25 | 7 / 8 | `swarm` `splitter` | 範圍攻擊、貫穿 | 17 | 0.53 |
| 8 | `hanzhong` | 漢中 | `gen` minPathLen 54, blockRate 0.10 | 9×16 | 30 | 3 | 32 | 39 | 1.20 | 7 / 8 | `armored` `tanky` | 持續傷害、單體高傷 | 15 | 0.47 |
| 9 | `luoyang` | 洛陽 | `gen` minPathLen 58, blockRate 0.08 | 9×17 | 32 | 2 | 40 | 44 | 1.28 | 8 / 10 | `flying` `fast` `healer` | 對空、控場、單體高傷 | 20 | 0.50 |
| 10 | `hefei` | 合肥 | `gen` minPathLen 54 | 9×16 | 30 | 3 | 36 | 45 | 1.20 | 8 / 9 | `swarm` `fast` | 範圍攻擊、貫穿、控場 | 15 | 0.42 |
| 11 | `hulao` | 虎牢關 | 固定 `map`（15 列蛇形關隘） | 9×15 | 30 | 3 | 30 | 47 | 1.15 | 8 / 9 | `tanky` `armored` | 持續傷害、單體高傷 | 12 | 0.40 |
| 12 | `xuchang` | 許昌 | `gen` minPathLen 60, blockRate 0.08 | 9×17 | 34 | 2 | 40 | 49 | 1.30 | 9 / 11 | `healer` `armored` `fast` | 單體高傷、持續傷害、控場 | 14 | 0.35 |

**戰場特性**（`mods`，見下一節）只有終盤三關宣告：
合肥 `spawnGap: 0.4`（出怪間隔剩一半）、虎牢關 `bossEvery: 3`（BOSS 從每 5 波變每 3 波）、
許昌 `rangeMul: 0.85` + `enemySpeedMul: 1.1`（夜霧壓境）。

「建議帶」那一欄是 `countersFor(bias)` 的輸出，**不是資料表裡的欄位**——列在這裡只為了方便對照，
改 `bias` 時不需要（也不該）另外改它。順序依 `TRAIT_COUNTERS` 的宣告順序去重。

中位數＝傻 AI（`npm run sim 16 all`）的陣亡波次中位數，「比例」是它除以 `maxWave`。
**設計目標由該關的 `arc` 換算**（≈ `maxWave × 20 / arc`，±20% 內達標），而
★ **真正的驗收是「比例」一路遞減**（1.00 → 0.35）——那一欄就是難度曲線本身。
⚠ 血量指數吃「相對進度」`wave × arc / maxWave`（`waves.ts`），所以 **`maxWave` 只是長度、`arc` 才是難度**。
以前沒有 `arc`（弧長寫死 `WAVE_REF`），每一關的比例全是 0.5、難度一樣平，而 12 波的教學關被壓成
每波血量 ×1.99，是全遊戲最陡的一段——第一關比最終關難就是那個公式的必然結果。
**改任何數值（含 `bias`——加權會改變敵種組成）後跑 `npm run sim 16 all` 對照這張表**，
並同步更新 CLAUDE.md 的「難度儀表板」段落。

⚠ **「偏差」那一欄對 `arc` 不敏感**：實際比例 ≈ k/arc、預期比例 = 20/arc，兩者同時吃 `arc`，
所以偏差量的其實是 k（這一關的地圖／生命／字池讓傻 AI 比參考值多撐了幾成）。要修的是**排序**。
⚠ **洛陽的分佈是雙峰的**（2 條命 + 隨機地形：一部分種子在前 5 波就崩、一部分撐到 20+），
中位數因此會在 15 與 20 之間跳，`arc` 44 → 45 就足以讓它整格翻面。
它與漢中之間 0.47／0.50 的先後在 16 局的取樣下屬於雜訊，不值得再往上疊 `arc` 去追。

終盤三關（合肥／虎牢關／許昌）的設計意圖與前面不同：前面靠 `bias` 收窄「該帶什麼」，
這三關改用**戰場特性**動一條與血量無關的規則（出怪節奏／BOSS 密度／我方射程），
所以就算血量曲線一樣，玩家要換的東西完全不同。

### `mods` 一個欄位驅動兩件事（與 `bias` 同一個慣例）

```
level.mods ──→ state.mods (state.ts:161) ──→ buildWave（spawnGap / bossEvery，actions.ts:307）
   │                                     ├→ moveEnemies（enemySpeedMul，step.ts:290-318）
   │                                     └→ recalcUnits（rangeMul，state.ts:426）
   └──→ modTags(level)（levels/index.ts:88-101）──→ 選關／無盡卡片上的「戰場」標籤（screens.ts）
```

**不要在關卡的 `subtitle` 之外再手寫一份特性說明**——`modTags()` 是唯一的真相來源。
新增一個旋鈕時要同時補：`LevelMods` 欄位（types.ts）、讀它的那一處 sim、`modTags()` 的一行說明，
以及 `level-mods.test.ts` 的「中性預設值」測試。

`JULU = LEVELS.julu`（levels/index.ts:362）是測試與 `createGame()` 的預設關卡（state.ts:141）。

### 無盡變體（levels/index.ts:364-413）

9 關各有一個**推導**出來的無盡版：`endlessOf(base)` 只改三個欄位（`key` 前綴 `endless_`、
`name` 加「・無盡」、`maxWave = Infinity`、`endless = true`），其餘全部沿用原關。
所以無盡不是 9 個新關卡，改原關的數值，無盡版自動跟著改。

```
LEVELS['julu']          maxWave 30   ← LEVEL_ORDER 上的流程關卡
LEVELS['endless_julu']  maxWave ∞    ← 由前者推導，只出現在 ENDLESS_ORDER
```

| helper | 用途 |
|---|---|
| `endlessKeyOf('julu')` → `'endless_julu'` | `app.startEndless()` 開局用（app.ts:532-542） |
| `baseKeyOf('endless_julu')` → `'julu'` | 成績記在 `meta.endless[原關 key]`（app.ts:173-181） |
| `isEndlessKey(key)` | 決定成績寫進 `meta.best` 還是 `meta.endless` |
| `ENDLESS_ORDER` | 無盡畫面的顯示順序，與 `LEVEL_ORDER` 一一對應 |

**四個陷阱**

1. **無盡變體必須註冊進 `LEVELS`**（levels/index.ts:413 的迴圈）——`createGame` 與續玩還原
   都只認得 `LEVELS`，沒註冊就開不起來（`restoreRun` 會回 `null`）。
2. **不可以放進 `LEVEL_ORDER`**。那條陣列是「流程」，被解鎖鏈（screens.ts:568）、
   每日挑戰輪替（daily.ts:47）與「天下歸心」成就門檻（achievements.ts:317）共用，
   混進去會同時弄壞這三件事。所有掃過 `LEVEL_ORDER` 的測試也因此不受影響。
3. **難度弧與原關的 `maxWave`／`arc` 都無關**：`Infinity` 會讓「相對進度」恆等於 0，
   所以 `enemyBaseHp` 對非有限的 `maxWave` 直接改走絕對波次（`HP_GROWTH^wave`，waves.ts），
   `endlessOf()` 也把 `arc` 明寫成 40 以免誤讀。
   推論——弧最短的黃巾（20），無盡版反而是最平緩的一條路。
   無盡的難度只由 `hpMul`／`lives`／字池區分。
4. **無盡不會通關**：`checkWaveEnd` 的 `wave >= maxWave` 對 `Infinity` 永遠不成立
   （step.ts:373，刻意不另外寫分支）。落敗是唯一的結束方式。

`npm run sim 20 endless_julu` 可以直接量它——工具對無盡把目標改成 `WAVE_REF/2 = 20`
（autobalance.ts:57-59）。現況：黃巾 22・巨鹿 21・洛陽 19。

### 固定 `map` vs 隨機 `gen`：怎麼選

| | 固定 `map` | 隨機 `gen` |
|---|---|---|
| 適用 | 教學關、要教特定技巧、要保證某個地形梗（如 S 在右上） | 重玩性、後段關卡、要玩家臨場判斷落點 |
| 可控性 | 完全可控，可以精算路徑長度與塔位 | 只能控長度下限與障礙密度 |
| 風險 | 手寫容易列長對不齊 | 每次改生成器都要重跑 60 種子測試 |

兩者互斥且至少要有一個：`core.test.ts:35-41` 斷言 `Boolean(map) || Boolean(gen)`。
`state.ts:147` 用 `level.map ?? generateMap(rng, level.gen!)`——`map` 優先，兩個都給 `gen` 會被忽略。
`ui/screens.ts:578` 用 `level.gen` 決定選關卡片是否加上 `random` 樣式（`subtitle` 自己寫「★ 隨機地形」）。
目前的分配是前 3 關固定（教得動的教學弧）、後 6 關隨機（重玩性）。

## 我想改 X → 動哪裡

| 想改什麼 | 動哪裡 | 注意 |
|---|---|---|
| 關卡難度 | ★ 動 `arc`（難度弧長度；預期中位數 = `maxWave × 20 / arc`）；`hpMul`/`startFood`/`lives` 做微調。⚠ 不要拿 `maxWave` 當難度旋鈕 | 改完跑 `npm run sim 30 <key>` 看單關偏差，或 `npm run sim 12 all` 看整條曲線 |
| 本局字池大小 | 同檔 `pool: { support, generals }` | `generals` 是「幾組姓名配方」不是幾個字（pool.ts:63-66）；數字大＝變化多但難疊高 |
| 隨機地形的路長／破碎度 | 同檔 `gen.minPathLen` / `gen.blockRate` | `minPathLen` 上限見〈契約與陷阱〉7；`blockRate` 只影響落點多寡，不影響射線 |
| 手改固定地圖 | 同檔 `map` 陣列 | 每列等長；恰好一個 `S`、一個 `C`；改完 `npm test` 會驗連通性**與「沒有走不到的路格」**（黃巾曾經把 `C` 放在錯的角落，於是最後一列有 8 格死路，見 mapgen.test.ts） |
| 這一關偏好哪些敵人／卡片上顯示什麼「建議帶」 | 同檔對應關卡的 `bias` | 一改兩動：敵種加權（×`BIAS_WEIGHT`）與 UI 標籤都跟著變；標籤是推導出來的，別另外手寫 |
| 某個特徵該用什麼手段應對 | `data/enemies.ts` 的 `TRAIT_COUNTERS`（enemies.ts:33-41） | 全部關卡的標籤一起變。新特徵要同步補 `TRAIT_LABEL` 與 `COUNTER_LABEL` |
| 新增一關 | `data/levels/index.ts`（`LEVELS` + `LEVEL_ORDER`） | `LEVEL_ORDER` 決定解鎖鏈（screens.ts:568）與過關後的下一關（app.ts:571-572）；插在中間會改變既有玩家的解鎖順序，新關卡一律往後接。別忘了 `pool` 與 `bias` |
| 新的地形種類 | `TileKind`（types.ts:20）→ `CHAR_TO_KIND`（board.ts:7-13）→ `WALKABLE`（board.ts:47）→ `drawTiles`（renderer.ts:127-175）→ 若可放置再改 `isPlot` | 四處都要改，漏一處會是「解析成功但畫不出來」或「敵人穿牆」 |
| 生成演算法（走廊形狀） | `sim/mapgen.ts` 的 `carve()` | 必須維持 induced path 性質，否則 mapgen.test.ts:25-35 紅字；別忘了 rng 消耗次數（陷阱 5） |
| 讓障礙阻擋射線 | `sim/combat.ts` 的 `pickTarget`／`effectiveRange` | 這是刻意的設計決定 #2，改動等於改遊戲手感，先確認需求 |

### 新增關卡：可直接複製且能編譯的範本

```ts
// src/data/levels/index.ts —— 加進 LEVELS，並把 key 加到 LEVEL_ORDER
  hefei: {
    key: 'hefei',              // 必須與物件的 key 一致（state.ts:157 用它回填 state.levelKey）
    name: '合肥',
    subtitle: '★ 隨機地形。窄路久攻，快賊繞不完',
    startFood: 30,
    lives: 3,
    maxWave: 32,                              // 打幾波（長度）
    arc: 38,                                  // ← 難度：32 波內走完 38 個參考波，必填
    hpMul: 1.22,
    pool: { support: 7, generals: 8 },        // ← 必填，漏了會 TS 編譯失敗
    bias: ['fast', 'swarm'],                  // ← 敵種加權 + 卡片「建議帶」都靠這一行
    gen: { cols: 9, rows: 15, minPathLen: 50 },  // 二選一：gen 或 map
  },
```

`bias` 只填 `EnemyTrait`（types.ts:203）；上例會自動推出「控場／範圍攻擊／貫穿」三個標籤，
**不要**再補一個推薦欄位。教學性質的關卡才寫 `bias: []`。

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
export const LEVEL_ORDER = [
  'huangjin', 'dongzhuo', 'julu', 'guandu', 'chibi', 'wuzhang',
  'xiangyang', 'hanzhong', 'luoyang',
  'hefei',        // ← 接在最後，才不會動到既有玩家的解鎖進度
] as const
```

`LEVELS` 是 `Record<string, LevelDef>`，忘記加進 `LEVEL_ORDER` 不會有型別錯誤——關卡只是不會出現在選關畫面。
反之只加 `LEVEL_ORDER` 不加 `LEVELS` 會被 `core.test.ts:35-41` 抓到。
新關卡若是 `gen`，`npm test` 會自動把它納入 60 顆種子的地圖掃描（mapgen.test.ts:8）；
若給了 `bias`，`enemies-ext.test.ts:280-297` 會檢查特徵合法、能推出推薦手段、且真有敵人帶那些特徵。

## 未來擴充：多路徑／雙出生點的阻礙點

目前架構在**多處**硬編碼了「單一 `path` + 單一 `spawn` + 單一 `camp`」。
`Enemy.dist` 是沿唯一 path 的一維純量，這是最深的假設。要改成多路徑，至少要動：

| 位置 | 假設內容 |
|---|---|
| `src/sim/types.ts:26-29` | `Board.path: number[]`（單一陣列）、`spawn: number`、`camp: number`（單值） |
| `src/sim/types.ts:226-227` | `Enemy.dist` 是「沿 path 的段數」，沒有 pathId 欄位 |
| `src/sim/board.ts:23-24,36-37,40` | 掃描時只記一個 spawn／camp，重複的 `S`/`C` 被靜默覆寫 |
| `src/sim/board.ts:42-43,49-74` | `parseMap` 只算一條 BFS 路徑並塞進 `board.path` |
| `src/sim/mapgen.ts:99-100` | `paint()` 只寫一個 `S`、一個 `C` |
| `src/sim/step.ts:88` | 敵人生成時 `dist: 0`，沒有「屬於哪條路」的欄位 |
| `src/sim/step.ts:290-318` | `goal = state.board.path.length - 1`，漏怪判定綁單一路徑長度 |
| `src/sim/combat.ts:85-94` | `enemyPos()` 直接索引 `board.path` |
| `src/sim/combat.ts:140` | targeting `'first'` 用 `e.dist` 跨敵人比大小——不同路徑的 dist 不可比 |
| `src/sim/combat.ts:308-317` | `pierce` 用 `|e.dist - target.dist| <= 1.3` 判定同一直線 |
| `src/sim/skills.ts:101-128` | `lineStrike` 以 `dist` 區間取範圍 |
| `src/sim/skills.ts:130-145` | `charge` 用 `dist` 排序取「最前方」 |
| `src/sim/step.ts:51-59` | `stepMeteor` 先用 `dist` 挑最前方敵人（之後才轉歐氏距離） |
| `src/app.ts:296-297,300-302` | `combo`／`leak` 粒子座標直接用 `board.camp` 當發生地點 |
| `tools/autobalance.ts:22-34` | 傻 AI 的落點評分只算「到 `b.path` 的最近距離」 |
| `src/sim/__tests__/mapgen.test.ts:25-35` | 「可走格數 == path 長度」的不變量在多路徑下必須改寫 |

最小可行改法建議：`Board.paths: number[][]` + `Enemy.pathId`，並把
`enemyPos()` 改成 `board.paths[e.pathId]`；所有用 `e.dist` 做跨敵人比較的地方
（combat.ts:140,307；skills.ts:106-108,135）都要先過濾同 `pathId`。

規模提醒：現在有 **9 關，其中 6 關是 `gen`**（`guandu`／`chibi`／`wuzhang`／`xiangyang`／`hanzhong`／`luoyang`）。
動 `mapgen.ts` 或 `Board` 形狀等於一次影響這六關 × 60 顆種子的測試，
而三張固定地圖（`huangjin`／`dongzhuo`／`julu`）得手工改寫成多路徑版本。
`bias` 與多路徑無關——敵種加權只吃 `EnemyTrait`，不碰 `path`，可以獨立演進。

## 相關頁面

- [modules/01-state-and-units.md](01-state-and-units.md) — `GameState`／`Unit` 結構、`recalcUnits`、開局組裝的其餘部分
- [modules/02-actions-and-combine.md](02-actions-and-combine.md) — 落點判定的呼叫端（`isPlot` 的使用者）與組詞相鄰邏輯
- [01-architecture.md](../01-architecture.md) — 分層、「一格可能有多個 unit」與組詞契約
- [02-data-tables.md](../02-data-tables.md) — 字／武將／敵人／羈絆資料表的欄位與平衡基準（`EnemyTrait`／`TRAIT_COUNTERS` 的權威說明在這）
- [03-change-recipes.md](../03-change-recipes.md) — 「我想改 X」的全域索引
- [04-invariants.md](../04-invariants.md) — 七條鐵則、已知陷阱、未實作項目
- [05-glossary.md](../05-glossary.md) — 「字牌／武將／空地／大營」↔ 程式碼識別字
- [06-roadmap.md](../06-roadmap.md) — 多路徑等尚未實作的擴充方向
- `docs/llm-wiki/modules/05-meta.md` — 局外養成與編隊字池（`level.pool` 在編隊模式下會被整個取代，pool.ts:58-93）
