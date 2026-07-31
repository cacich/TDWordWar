# 玩家操作與組詞判定（actions + combine）

> **負責檔案**
>
> | 檔案 | 規模 | 職責 |
> |---|---|---|
> | `src/sim/actions.ts` | 315 行、15 個匯出 | 玩家操作的**唯一入口**：驗證 → 改 state → 回傳 `ActionResult` |
> | `src/sim/combine.ts` | 175 行、3 個匯出 | 純函式組詞判定引擎 + UI 提示的寬鬆判定 |
>
> **上游依賴**：`data/glyphs`（`GLYPH_BY_CHAR` / `MAX_GLYPH_LEVEL` / `levelMul` / `qualityName`）、
> `data/generals`（`RECIPE_INDEX` / `TIER_ORDER` / `MAX_RECIPE_LEN`）、
> `sim/board`（`isPlot` / `cellCol` / `cellRow` / `cellIndex`）、
> `sim/economy`（`recruitCost` / `rerollCost` / `rollGlyph` / `smeltRefund` / `SELL_RATIO` / `familiarChars`）、
> `sim/state`（`glyphAt` / `unitById` / `makeGlyphUnit` / `makeGeneralUnit` / `recalcUnits`）、
> `sim/events`（`emit`）、`sim/waves`（`buildWave`）。
>
> **下游使用者**：`input/pointer.ts:10`（`placeFromHand` / `moveGlyph` / `mergeHand` / `sellGlyph`）、
> `app.ts:26`（`recruit` / `rerollHand` / `smelt` / `sellGlyph` / `startWaveNow` / `toggleWish`）、
> `sim/step.ts:6`（`beginBattle`，佈陣倒數結束時自動開戰）、
> `tools/autobalance.ts:8`（傻 AI 只用 `recruit` + `placeFromHand`）、
> `main.ts:35`（`__dev.put()` 手動呼叫 `tryCombine`）。
> `combine.ts` 另被 `sim/state.ts:15` 使用（`possibleRecipes`）與 `tools/autobalance.ts:10`（`findCombination`）。

## 這個模組解決什麼問題

1. **把「玩家想做的事」收斂成一組可測試的純 state 轉換。** UI／輸入層不准自己動 `state.units`、
   `state.hand`、`state.food`；規則（能不能放、糧夠不夠、階級能不能疊）只寫在這裡一份。
   → 不變式 #4，見 [../04-invariants.md](../04-invariants.md)。
2. **把「棋盤配置變了 → 有沒有成將」這件事集中成一個判定函式**，讓放置、疊合、移動、交換
   四條路徑共用同一套組詞規則。

`actions.ts` 的鐵律（檔頭註解 `src/sim/actions.ts:1-7`）：**只改 `GameState`，不碰 DOM、不播音效、
不回傳 JSX**。音效與粒子一律走 `emit()` 事件佇列（不變式 #7），由 `app.ts:262` 每幀 drain。

## 核心概念

### ActionResult：唯一的回傳形狀

`src/sim/actions.ts:17-27`

| 欄位 | 意義 | 誰在讀 |
|---|---|---|
| `ok` | 操作是否成立 | `input/pointer.ts:108` 決定要不要 `select(cell)`；`app.ts:350` 決定播 `ui` 還是 `deny` |
| `msg` | 給玩家看的字串（成功摘要或失敗原因） | 全部呼叫端都是 `if (res.msg) toast(res.msg)` |
| `combined` | 這次成的武將名，**可能兩個**（十字同時成兩將） | `input/pointer.ts:107,205` → `host.onCombined()` → `app.ts:615` |
| `broken` | 這次解除的武將名 | `input/pointer.ts:204`（**只在 `msg` 為空時**才自己 toast，避免與 `msg` 重複） |

失敗一律用 `fail(msg)` helper（`src/sim/actions.ts:27`），回傳 `{ ok:false, msg }` 且**不改任何 state**
（所有驗證都在改動之前做完）。`combined` 沒有東西時是 `undefined` 而**不是**空陣列
（`tryCombine` 的回傳型別是 `string[] | undefined`，`src/sim/actions.ts:275`）——呼叫端請用 `res.combined?.length`。

### 棋盤上被操作的一律是「字牌」

武將（`kind === 'general'`）是疊在字牌上的一層，`state.units` 同時裝兩者，格子會重疊。
所以 action 名稱刻意叫 `moveGlyph` / `sellGlyph` 而不是 `moveUnit` / `sellUnit`
（`src/sim/actions.ts:185,232`），入口都會先擋 `u.kind !== 'glyph'`（`:188,234`）。

武將屬性不由 action 維護，而是 `recalcUnits()` → `recomputeForm()` 每次從成員字牌現算
（`src/sim/state.ts:377`）。這帶來兩個結果：

- **成員字牌被疊高 → 武將自動變強，不需要重新合成**（`src/sim/__tests__/actions.test.ts:90-108` 鎖住這行為）。
- **成員字牌被搬走／鏟除 → 武將必須解除**，這就是 `dissolveFormsOf()` 存在的理由。

資料模型細節（`Unit` 欄位、`formIds` / `memberIds`、`glyphAt` / `formsAt`）見
[01-state-and-units.md](01-state-and-units.md)，這裡不重複。

### 組詞判定：`findCombinations` 的五條規則

`src/sim/combine.ts:1-11` 的檔頭註解就是規格摘要，實作對應：

| 規則 | 實作位置 |
|---|---|
| 只有 `kind === 'glyph'` 參與（武將不再融合，設計決定 #3） | `glyphAtCell()` `src/sim/combine.ts:24` |
| 取包含 `changedCell` 的**最長連續字牌序列**，已依正讀順序排好 | `runThrough()` `:32-62` |
| 只檢查「含 `changedCell`」的子串（其他位置在它們自己被放置時就判定過了） | `bestInOrientation()` `:97` 的 start 範圍 |
| 同方向多個命中 → 先比 `TIER_ORDER`、再比配方字數 | `betterThan()` `:64-69` |
| 同名 + 同格子（**順序敏感**）的武將不重複產生 | `alreadyFormed()` `:72-80` |

### ★ 一枚字牌可以同時屬於好幾個武將（配方擴充後的推論）

`findCombinations` 一次**每個方向最多回傳一個**，但**武將形成之後不會因為後來又形成別的武將而消失**
（`alreadyFormed` 只擋「同名同格」）。於是同一枚字牌會隨著多次放置累積 `formIds`：

```
刀 盾 兵   →  放 刀盾 之後再放「兵」，盾兵 也成立
              「盾」同時屬於 刀盾 與 盾兵，兩個武將各自獨立計算傷害
```

⚠ **`formIds` 的上限不是 2**（舊文件說「橫向與縱向各一，最多 2」）。
字組合擴充後有些字**既是某配方的頭、又是另一個配方的尾**（`陣` → 風陣＋陣令），
所以橫向就可能掛到兩個，加上縱向最多到四個。實測 `陣` 擺成十字時 `formIds.length === 3`。

這是刻意接受的設計：它讓「一條線上連續鋪字」變成一種構築手法，與十字成雙同源。
代價是玩家戰力整體上升——配方從 17 種擴到 43 種時，傻 AI 每波戰力約 +78%，
用 `BASE_HP` 20 → 32 反向抵銷（見 [05-economy-and-waves.md](05-economy-and-waves.md)）。

⚠ **不要新增「把既有配方再包一層」的巢狀配方**（例如已有 `車騎` 又加 `車騎兵`）：
兩者會同時存在並共用同一批字牌，等於同一條線白拿兩份火力，而且沒有「升級取代」的語意。
首尾相接（風陣＋陣令）可以，巢狀包覆不行。`data/generals.ts` 的兵種編制區有一段註解記著這件事。

`runThrough` 的方向向量 `dc/dr` 由 `orientation` 決定（`:35-36`）：`'h'` = 左→右、`'v'` = 上→下，
回傳陣列**就是正讀順序**（`before.unshift()` + `after.push()`，`:48,57`）。
`makeGeneralUnit()` 直接把 `parts.map(p => p.cells[0])` 當成 `Unit.cells`（`src/sim/state.ts:334`），
所以**正讀順序是從 `runThrough` 一路傳到渲染的**——這就是不變式 #5 的來源。

搜尋上界是 `MAX_RECIPE_LEN`（`data/generals.ts:338`，由 `GENERALS` 自動算出最長配方），
新增更長的配方不需要改 `combine.ts`。

## 主要流程

### 一次「從手牌放到棋盤」

`placeFromHand(state, handIndex, cell)` `src/sim/actions.ts:133-166`

```
phase 是 won/lost？        → fail
手牌該格為空？             → fail
!isPlot(board, cell)？     → fail（路上／出口不能放）
glyphAt(state, cell)
 ├─ 有人 → 同字？同階？未滿階？（三個都要，否則 fail）
 │        levelUpGlyph()  → emit 'merge' → tryCombine() → recalcUnits()
 │        （占位字牌若已屬於武將，武將不解除，只是變強：msg 追加「武將同步強化」）
 └─ 空地 → units.push(makeGlyphUnit()) → emit 'place' → tryCombine() → recalcUnits()
```

### 一次「搬動字牌」：`moveGlyph` 的三條分支

`src/sim/actions.ts:185-228`。設計決定 #5：字牌可隨時自由移動（連戰鬥中也行），
而**搬走的字牌所屬武將必定解除**——這是「張遼 → 拖走遼 → 補上飛 → 張飛」玩法的基礎。

| 分支 | 條件 | 動作序 | 回傳 |
|---|---|---|---|
| **A 疊合升階** | 目標格有字牌且同字同階未滿階（`:194-195`） | `dissolveFormsOf(u)` → `removeGlyph(u)` → `levelUpGlyph(occupant)` → emit `merge` → `tryCombine(toCell)` → `recalcUnits` | `msg` + `combined` + `broken` |
| **B 交換位置** | 目標格有字牌但不可疊合（不同字／不同階／已滿階） | `dissolveFormsOf(u)` **＋** `dissolveFormsOf(occupant)` → 互換 `cells` → `tryCombine(toCell)` **＋** `tryCombine(fromCell)` → `recalcUnits` | `msg` + `combined`（合併兩端結果）+ `broken` |
| **C 單純移動** | 目標格是空地 | `dissolveFormsOf(u)` → 改 `cells` → `tryCombine(toCell)` → `recalcUnits` | `combined` + `broken`（無 `msg`） |

分支 A 與 B 的**非對稱是刻意的**：A 是「疊上去」，語意等同 `placeFromHand` 的疊合，
所以**占位方（`occupant`）的武將不解除**、只有被搬走的那一方解除；
B 兩邊都算「移動」，所以兩邊的武將都解除、兩端都要重新判定組詞
（`src/sim/__tests__/actions.test.ts:207-224` 鎖住「交換後成將」這條路）。

分支 B 存在的理由：**讓拖曳一定成立**。如果不可疊合就 fail，玩家在滿盤時會卡住無法重排。

### `dissolveFormsOf` 的連帶效果

`src/sim/actions.ts:255-268`。傳入**字牌 id**，解除所有 `memberIds` 含它的武將（可能 2 個），做四件事：

1. 從 `state.units` 移除那些武將（整個陣列 filter 重建，`:259`）
2. 把**所有**字牌的 `formIds` 裡對應 id 清掉（`:260-262`）——不只成員，是全掃，寫法上不用先算成員集合
3. `delete state.bondCds[name]`（`:264`）——羈絆技冷卻以武將名為 key，武將沒了就得歸零，
   否則重新組同一名武將會繼承舊冷卻
4. 每個被解除的武將 `emit({ kind:'dissolve', name })`（`:265`）→ `app.ts:280` 播音效

**回傳武將名陣列**，供 `ActionResult.broken`。**它自己不呼叫 `recalcUnits`**，由 action 收尾時統一呼叫。

### `levelUpGlyph`：就地升階，必須保留 id 與 formIds

`src/sim/actions.ts:171-178`（module-private）。為了拿到「新階級的完整屬性」，它直接
`makeGlyphUnit()` 造一個新物件，然後把 `id`、`formIds`、`targeting` 覆寫回去，最後
`state.units[indexOf(target)] = fresh` 換掉陣列裡的元素。

- **`id` 必須保留**：武將透過 `memberIds` → id 找成員（`glyphsOf()`，`src/sim/state.ts:221`），
  換 id 等於成員憑空消失，`recomputeForm()` 會因為 `parts.length === 0` 直接 return（`state.ts:381`），
  武將屬性靜默凍結在舊值。
- **`formIds` 必須保留**：否則字牌會被當成「自由字牌」→ 單獨攻擊、單獨產糧、單獨投射光環，
  傷害與收入雙重計算（不變式 #5c）。`memberIds` 不需要動，因為 id 沒變。
- **`targeting` 也要帶**：玩家設過的索敵模式不該因為疊字被重設。

### 波次

`startWaveNow()` `src/sim/actions.ts:288-294`：只在 `phase === 'prep'` 可用，把剩餘 `prepTimer`
的一半換成糧（提前開戰的獎勵），然後呼叫 `beginBattle()`。
`beginBattle()` `:296-301` 回傳 `void`（不是 `ActionResult`）——它是**階段轉換**而不是玩家操作，
另一個呼叫者是 `sim/step.ts` 的佈陣倒數結束。反向的 `battle → prep` 轉換在
`sim/step.ts:355-391` 的 `checkWaveEnd()`（那裡也負責 `recruitsThisWave = 0`）。

`beginBattle` 唯一做的事是 `spawnQueue = buildWave(wave, rng, hpMul, state.bias)`（`actions.ts:307`）——
**這一行會消耗 `state.rng`**（每隻敵人 1 抽，BOSS 波再多 1 抽）。所以要做「下一波預覽」時
**不可以**在這裡多呼叫一次 `buildWave`，那會讓整條亂數流位移、破壞同種子重現性。
正確做法見 [05-economy-and-waves.md](05-economy-and-waves.md) 的陷阱 2。

### 提示：`possibleRecipes`

`src/sim/combine.ts:138-175`。**寬鬆判定，不檢查相鄰性**，只數「手牌 + 場上」的字夠不夠湊出配方，
按 tier 排序取前 3 名。兩個過濾條件是理解它的關鍵：

- `formed.has(def.name)` → 已經有這名武將就不提示（`:145,153`）
- `usesHand` → **只提示「用得到手牌」的組合**（`:165,168`）。理由寫在註解：純場上就能湊的，
  玩家早該組好了，提示它只是噪音。

呼叫端只有 `recalcUnits()` 尾端（`src/sim/state.ts:455`），寫進 `state.hints`；
`state.hints` 接著餵給 `computeHintCells()`（`state.ts:463`）算出棋盤上的 `hintCells` 標記。
`hints` / `hintCells` 的欄位語意與渲染見 [01-state-and-units.md](01-state-and-units.md)。

### perks 介入點

局外商城道具（`data/shop.ts`）在本模組只有兩個 hook：

| perk | 介入點 | 效果 |
|---|---|---|
| `recruitEliteChance`（精兵符） | `src/sim/actions.ts:49` | 每個抽到的字**獨立**擲一次 `state.rng()`，命中就直接是二階 |
| `familiarBoostMul`（廣結善緣） | `src/sim/actions.ts:43,70` → 塞進 `RollContext` | 疊在 `FAMILIAR_BOOST` 上，`economy.ts:100` 相乘 |

`costMul`（輕裝簡從）不在本檔，它在 `economy.ts` 的 `recruitCost()`／`rerollCost()` 裡（`economy.ts:23,121`），
`actions.ts` 只是呼叫這兩個函式。**新增花費類 perk 請改 `economy.ts`，不要在 action 裡再乘一次倍率。**

## 契約與陷阱

### ★★★ 陷阱 1：`findCombinations`（複數）才是正式路徑

```
findCombinations(board, units, changedCell): CombineMatch[]   ← 正式路徑（combine.ts:118）
findCombination (board, units, changedCell): CombineMatch|null ← 只給測試／探測用（combine.ts:128）
```

- **單數版是複數版的 wrapper**，用 `betterThan` 把橫向與縱向的結果 reduce 成「最好的那一個」
  （`src/sim/combine.ts:128-132`）。也就是說**它會丟掉第二個方向的結果**。
- 唯一的生產路徑 `tryCombine()` 用的是**複數版**（`src/sim/actions.ts:276`），for-loop 逐一
  `makeGeneralUnit()` 並各發一個 `combine` 事件（`:279-283`），所以一次放置最多同時成兩將。
- 單數版目前只有兩處呼叫者，兩者都只關心「有沒有／是哪一個」：
  `src/sim/__tests__/combine.test.ts` 與 `tools/autobalance.ts:56`（傻 AI 拿它評估落點分數）。

> **如果把新的 action 接到單數版 `findCombination`，「十字同時成兩將」的能力會靜默消失。**
> 型別檢查會過（`CombineMatch | null` 也能用）、單元測試不會紅（現有測試沒有一條走你的新 action）、
> 遊戲照樣能玩，只是玩家永遠只成一將。這是本模組最貴的靜默失敗。
> **任何會改變棋盤配置的新 action，都應該呼叫 `tryCombine(state, cell)`，而不是自己碰 `combine.ts`。**
> 現有回歸測試在 `src/sim/__tests__/actions.test.ts:130-144`（`expect(res.combined).toHaveLength(2)`）——
> 新 action 請照抄一份。

### ★★ 陷阱 2：`recalcUnits` 逐一對照表

不變式 #3：改過 `units` 或 `hand` 就必須呼叫 `recalcUnits(state)`。本模組的實際情況：

| 函式 | 尾端呼叫 `recalcUnits`？ | 說明 |
|---|---|---|
| `recruit` | ✅ `actions.ts:53` | 改了 hand → hints 要重算 |
| `rerollHand` | ✅ `:76` | 同上 |
| `toggleWish` | ❌ | 只改 `state.wishes`（抽卡權重），不影響任何衍生值。**故意不呼叫** |
| `mergeHand` | ✅ `:111` | |
| `smelt` | ✅ `:128` | |
| `placeFromHand` | ✅ 兩條分支各一次（`:151`、`:164`） | |
| `moveGlyph` | ✅ 三條分支各一次（`:203`、`:214`、`:226`） | |
| `sellGlyph` | ✅ `:241` | |
| `levelUpGlyph`（private） | ❌ | 由呼叫端負責 |
| `removeGlyph`（private） | ❌ | 同上；實作只是 `units.filter`（`:250-252`） |
| `dissolveFormsOf`（exported） | ❌ | **由呼叫端負責**。它是 helper 不是 action |
| `tryCombine`（exported） | ❌ | **由呼叫端負責**。`main.ts:35-36` 的 `__dev.put()` 就是手動補一次 |
| `startWaveNow` / `beginBattle` | ❌ | 不動 units／hand |

寫新 action 的樣板：**驗證 → 改 state → `emit()` → `tryCombine()` → `recalcUnits()` → return**。
順序很重要：`tryCombine` 要在 `recalcUnits` **之前**，新生成的武將才會被納入這一輪的羈絆與光環重算。

### 陷阱 3：`levelUpGlyph` 之後，原本的變數就是懸空物件

`levelUpGlyph()` 是**換掉 `state.units` 裡的元素**，不是原地改欄位。呼叫後你手上的
`occupant` / `target` 變數指向一個已經不在 `state.units` 裡的舊物件。
現有程式碼只在之後讀它的不變欄位（`occupant.chars[0]`、`occupant.formIds.length`，
`actions.ts:154,201`）所以沒事，但**在 `levelUpGlyph` 之後寫入該變數會靜默丟失**。
需要新物件請用 `glyphAt(state, cell)` 重新取。

### 陷阱 4：phase 守門並不一致

| 有 `won`/`lost` 守門 | 完全沒有 phase 檢查 | 需要特定 phase |
|---|---|---|
| `recruit` `:31`、`rerollHand` `:59`、`placeFromHand` `:134`、`moveGlyph` `:186` | `toggleWish`、`mergeHand`、`smelt`、`sellGlyph` | `startWaveNow` 要求 `phase === 'prep'` `:289` |

沒守門的那四個是刻意的（手牌整理與鏟除在任何階段都無害），但**新增 action 時請預設加上
`if (state.phase === 'won' || state.phase === 'lost') return fail('本局已結束')`**，
除非你能說出為什麼不用。

### 陷阱 5：事件發送也不對稱

`placeFromHand` 發 `place` / `merge`（`:149,162`）、`moveGlyph` 的疊合分支發 `merge`（`:201`）、
`tryCombine` 每個武將發 `combine`（`:282`）、`dissolveFormsOf` 每個武將發 `dissolve`（`:265`）。
但 **`mergeHand`（手牌之間疊合）與 `moveGlyph` 的移動／交換分支不發任何事件**，
`recruit` / `rerollHand` / `smelt` / `sellGlyph` 也不發——這些操作的音效由 UI 層依 `res.ok` 自己播
（例如 `app.ts:350`）。加事件前先確認 `SimEvent` 聯集（`sim/types.ts`）與 `app.ts:262` 的 drain switch
都要同步，否則事件被無聲丟棄。

### 陷阱 6：`alreadyFormed` 的比對是順序敏感的

`src/sim/combine.ts:72-80` 用 `u.cells.every((c, i) => c === match.cells[i])` 比對。
這正確的前提是「同一組字牌的正讀順序唯一」——由 `runThrough` 保證。
如果哪天有人手動塞了一個 `cells` 順序顛倒的武將（例如繞過 `makeGeneralUnit` 自己 push），
去重就會失效，同一個武將會被重複產生。

### 契約速查

- `recruit` 是「**一次填滿所有空手牌格**」，但 `recruitCost` 只算一次、`recruitsThisWave` 只 +1
  （`actions.ts:38,45-52`）。不是「一格一次花費」。
- `rerollHand` 只重抽**非空**的格子（`:73`）且**把階級重設為 1**（`:74`）——刻意的：
  不然玩家可以拿高階字免費換高階字。空格不會被填滿，重抽不增加張數。
- `smelt` 的 `state.smeltFreeLeft`（初始 3，`state.ts:184`）不是「免費次數」而是
  **高退款次數**：有額度時退 20%（`:124`），沒額度時走 `smeltRefund()` 的 12%（`economy.ts:116`）。
- `sellGlyph` 的退款公式在 `actions.ts:237`，成員字牌只退 `SELL_RATIO.general = 0.3`
  （`economy.ts:125`，設計決定：拆將要有重量）。它**不走** `smeltRefund()`。
- `toggleWish` 會拒絕不在 `state.pool` 的字（`:91`）——池外的字許願無效果，所以直接擋下並說明。
- 所有隨機都走 `state.rng`（`:47,49,74`），不變式 #1。`recruit` 的擲骰次數會隨空格數變動，
  改動抽卡流程會改變後續 rng 序列 → `npm run sim` 的數字會整體位移，這是預期的。

## 我想改 X → 動哪裡

| 想改什麼 | 動哪裡 | 注意 |
|---|---|---|
| 新增一種玩家操作 | `sim/actions.ts` 新增 `export function`，回傳 `ActionResult` | 照樣板：phase 守門 → 驗證 → 改 state → `emit` → `tryCombine` → `recalcUnits`。UI 接線在 `input/pointer.ts` 或 `app.ts` |
| 操作會改變棋盤配置 | 一定要呼叫 `tryCombine(state, cell)` | **不要**直接用 `findCombination`（單數）——見陷阱 1 |
| 組詞規則（相鄰性、方向、去重） | `sim/combine.ts` 的 `runThrough` / `bestInOrientation` / `alreadyFormed` | 純函式，先加 `__tests__/combine.test.ts` 的案例再改 |
| 同方向多命中時挑哪個 | `betterThan()` `combine.ts:64` | 目前是 tier → 字數。改這裡會影響所有配方的優先序 |
| 允許斜向組詞 | `runThrough` 的 `dc/dr` 與 `findCombinations` 的 orientation 迴圈 | `CombineMatch.orientation` 型別（`'h'` / `'v'`）要一起擴，渲染層也讀它 |
| 加更長的配方 | 只改 `data/generals.ts` | `MAX_RECIPE_LEN` 自動跟上，`combine.ts` 不用動 |
| 疊合／升階規則（幾階可疊、要不要同階） | `placeFromHand:142-144`、`moveGlyph:194-195`、`mergeHand:105-107` | **三處都要改**，否則手牌與棋盤行為不一致 |
| 階級上限 | `data/glyphs.ts` 的 `MAX_GLYPH_LEVEL` | 三處疊合檢查都引用它，改一處即可 |
| 移動／交換的判定 | `moveGlyph` 三條分支 `actions.ts:192-227` | 改分支 B 前先看 `__tests__/actions.test.ts:174-224` |
| 武將解除的連帶效果 | `dissolveFormsOf()` `actions.ts:255` | 別忘 `bondCds` 與 `dissolve` 事件；呼叫端負責 `recalcUnits` |
| 提示要提示什麼 | `possibleRecipes()` `combine.ts:138`（名單）＋ `state.ts:463` `computeHintCells()`（棋盤標記） | 純衍生值，不影響機制。`usesHand` 過濾是刻意的 |
| 花費／退款數值 | `sim/economy.ts` | `actions.ts` 只呼叫，不重複算倍率 |
| 抽字權重 | `sim/economy.ts` 的 `rollGlyph` / `RARITY_TABLE` | `actions.ts:39-44,66-71` 只負責組 `RollContext` |
| 加一個影響征兵／抽字的 perk | 讀 `state.perks.*`，介入點見上表 | 新欄位要同時改 `types.ts` 的 `Perks` 與 `shop.ts` 的 `NEUTRAL_PERKS` |
| 波次開始的時機／獎勵 | `startWaveNow` `:288`、`beginBattle` `:296` | `beginBattle` 也被 `sim/step.ts:6` 呼叫，兩條路徑都要通 |

改完務必：`npm test`（`__tests__/actions.test.ts` 與 `combine.test.ts` 是本模組的護欄）＋ `npm run sim`。

## 相關頁面

- [01-state-and-units.md](01-state-and-units.md) — `GameState` / `Unit` 欄位、`formIds` vs `memberIds`、
  `recalcUnits` 的完整重算順序、`hints` / `hintCells`
- [03-board-and-mapgen.md](03-board-and-mapgen.md) — `Board` / `tiles` / `isPlot` / `cellIndex` 座標約定
- [../01-architecture.md](../01-architecture.md) — 分層與依賴方向、一幀的生命週期、事件佇列
- [../03-change-recipes.md](../03-change-recipes.md) §9 — 新增玩家操作的操作步驟
- [../04-invariants.md](../04-invariants.md) — 不變式 #1 / #3 / #4 / #5 / #5b / #5c / #7 的原文與症狀
