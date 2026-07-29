# 狀態樹與單位（`sim/types.ts` + `sim/state.ts`）

> **負責檔案**
>
> | 檔案 | 規模 | 職責 |
> |---|---|---|
> | `src/sim/types.ts` | 446 行，零 import | 全專案共用型別的單一定義處：`Board` / `GlyphDef` / `GeneralDef` / `Unit` / `Enemy` / `Effect` / `SimEvent` / `BondDef` / `Perks` / `GameState` / `HintCell` |
> | `src/sim/state.ts` | 446 行 | `GameState` 的建立（`createGame`）、單位工廠（`makeGlyphUnit` / `makeGeneralUnit`）、衍生值重算（`recomputeForm` / `recalcUnits`）、查詢輔助（`glyphAt` / `formsAt` / `glyphsOf` / `unitById` / `generalDefOf`）、局外進度型別（`MetaProgress`）與上限常數 |
>
> **上游依賴**
> `types.ts`：**沒有任何 import**（純型別檔，這是它能被所有層安全引用的前提）。
> `state.ts`：`core/rng`(mulberry32)、`data/generals`(`GENERAL_BY_NAME`)、`data/glyphs`(`GLYPH_BY_CHAR` / `glyphDef` / `levelMul` / `MAX_GLYPH_LEVEL`)、`data/levels`(`LEVELS`)、`data/shop`(`perksFrom`)、`sim/board`(`parseMap`)、`sim/bonds`(`computeBonds`)、`sim/combat`(`effectiveRange` / `troopFromTags` / `unitCenter`)、`sim/combine`(`possibleRecipes`)、`sim/mapgen`(`generateMap`)、`sim/pool`(`buildGlyphPool`)、`sim/skills`(`SKILLS`)、`sim/waves`(`PREP_SECONDS`)。
>
> **下游使用者**
> `sim/actions.ts:13`（唯一的寫入者）、`app.ts:26`、`main.ts:6`（`__dev`）、`input/pointer.ts:11`、`core/devtools.ts:9`、`tools/autobalance.ts:12`、全部 `sim/__tests__/*`。
> 另外 `core/save.ts:9-17`、`data/loadout.ts:14`、`data/upgrades.ts:9`、`data/shop.ts:17`、`ui/screens.ts:25` 只取 `MetaProgress` 型別與 `MAX_*` 常數。

## 這個模組解決什麼問題

1. **單一狀態樹**：整局遊戲只有一個 `GameState`（`types.ts:375`）。沒有隱藏在 render/ui 裡的第二份真實資料，所以 `npm run sim` 能在 Node 裡跑完整對局。
2. **字牌與武將的雙層模型**：武將不取代字牌，而是疊在字牌上的一層。這個決定讓「組將後繼續疊字升階」、「抽走一個字換將」、「一個字同時屬於橫向與縱向兩個武將」三種玩法成立，代價是**一格可能有多個 `Unit`**。
3. **基礎值 / 實效值分離**：`baseAtk`/`baseAps` 是可重算的純函式輸出，`atk`/`aps` 是每次 `recalcUnits()` 從基礎值重新推導的快取。這讓「羈絆、光環、局外道具」可以任意重算而不會層層複利。

## 核心概念

### `Unit`：字牌與武將共用型別（`types.ts:117-173`）

```
state.units = [ ...字牌(kind:'glyph'), ...武將(kind:'general') ]   // 同一個陣列，格子會重疊
```

| 欄位 | glyph | general |
|---|---|---|
| `cells` | 長度 1 | 配方全字，**依正讀順序**（橫向左→右／縱向上→下） |
| `level` | 品質階級 1~5 | 成員階級之和（三階張＋二階飛 = 5） |
| `formIds` | 所屬武將 id，**0～2 個** | 恆為 `[]` |
| `memberIds` | 恆為 `[]` | 成員字牌 id，依正讀順序 |
| `tier` | 恆 `'common'` | 來自 `GeneralDef.tier` |

雙向指標由 `makeGeneralUnit` 建立（`state.ts:315` 寫 `memberIds`、`state.ts:337` 反向 push `formIds`），由 `actions.dissolveFormsOf`（`actions.ts:255-268`）拆除。

**為什麼不能假設「一格一個 unit」**：`張`右邊是`遼`、下面是`飛` → 同一枚`張`的 `formIds` 同時掛著張遼與張飛兩個武將 id。所以：

- 取字牌：`glyphAt(state, cell)`（`state.ts:186`，比對 `kind==='glyph' && cells[0]===cell`）
- 取覆蓋該格的武將：`formsAt(state, cell)`（`state.ts:191`，回傳 0～2 個）
- 取武將成員：`glyphsOf(state, form)`（`state.ts:199`，走 `memberIds` 查 id，**不是**走 `cells`）

**「成員字牌不重複計算」是散落在三處的同一條規則**（都用 `formIds.length > 0` 判斷）：
攻擊 `combat.ts:250`、產糧 `economy.ts:45`、光環投射 `state.ts:409`。新增任何「掃全場 units 加總」的邏輯時必須自己補這個判斷，模組本身不會幫你擋。

### 基礎值 vs 實效值（`types.ts:147-155`）

```
baseAtk = GlyphDef.atk × levelMul(level)                    ← 字牌，makeGlyphUnit:194
baseAtk = Σ(成員 baseAtk) × GeneralDef.atkMul                ← 武將，recomputeForm:342
baseAps = (Σ成員 baseAps / 成員數) × GeneralDef.apsMul       ← 武將取平均再乘，recomputeForm:341

atk   = baseAtk × bonds.atkMul × perks.atkMul × Π(命中的光環 atkMul)
aps   = baseAps × bonds.apsMul × perks.apsMul × Π(命中的光環 apsMul)
range = effectiveRange(board, u) × perks.rangeMul           ← effectiveRange 內含 RANGE_MUL / 武將加成 / 多格中心補償
```

`recalcUnits` 每次都從 `base*` 重算 `atk`/`aps`，所以它是**冪等**的——重複呼叫不會讓倍率複利。這是「絕對不要把加成寫進 `baseAtk`」的理由。
兵種相剋、爆擊、`splashMul`、防禦減免不在這裡，它們是每次出手時算的，見 `modules/04-combat-and-skills.md`。

### `GameState` 的分區（`types.ts:375-440`）

- **不變量**：`levelKey` / `levelName` / `hpMul` / `bias` / `board` / `pool` / `poolGenerals` / `perks`（整局固定，`perks` 由 `createGame` 從 `meta.items` 算好；`bias` 是關卡的敵人偏好，`createGame:116` 從 `level.bias` 抄進來，只被 `buildWave` 讀）
- **RNG**：`state.rng`（`createGame:102` 建立的 mulberry32）。**禁用 `Math.random()`**，同種子必須重現同一場。
- **真實資料**：`units` / `enemies` / `hand` / `food` / `lives` / `wave` / `phase`
- **每 tick 遞減**：`prepTimer` / `waveTime` / `meteorTimer` / `bondCds` / 單位的 `cd` / `skillCd` / `*Flash`
- **衍生值（只由 `recalcUnits` 寫）**：`activeBonds` / `cdMul` / 每個 unit 的 `atk`/`aps`/`range`/`skillCdMax` / `hints` / `hintCells`
- **輸出佇列**：`events`（`MAX_EVENTS = 64`，`types.ts:297`）、`effects`

### `MetaProgress`（`state.ts:47-86`）

局外存檔的型別定義在 sim 層，但 **sim 只讀其中一部分**：`handSize`、`extraFood`、`extraLives`、`wishSlots`、`items`、`loadoutActive`/`loadoutGlyphs`/`loadoutGenerals`（`createGame:105-110`、`129-131`）。
`cleared` / `seenGenerals` / `best` / `renown` / `achievements` / `totals` 由 app 層維護，sim 不讀。
`achievements`（key → 解鎖序號）與 `totals`（`RunTotals`，`state.ts:29-40`）是成就系統用的，
判定與發獎都在 `data/achievements.ts` 與 `app.ts`，見 [modules/06](06-meta-progression.md)。
⚠ 註解（`state.ts:44`）說 `seenGlyphs` 屬於 app 層，但**啟用編隊時 `createGame:106` 會把它傳進 `buildGlyphPool`**（`pool.ts:33,82`：沒解鎖過的字繼續留在池內）。改編隊邏輯時別被那行註解誤導。

### `hintCells`（`types.ts:435-439`、`state.ts:441-471`）

純 UI 衍生值，`recalcUnits` 最後一步產生，`render/renderer.ts:235` 消費（畫脈動光暈）。
`kind:'upgrade'` = 手牌＋場上有 ≥2 枚同字同階且未滿階；`kind:'combine'` = 該字是 `state.hints` 裡某個可湊配方的成員字。判定刻意寬鬆、每格最多一筆（upgrade 優先），**不影響任何機制**，改它不必跑 `npm run sim`。

## 主要流程

### 開局

`createGame(levelKey, seed, meta)`（`state.ts:126`）→ `LEVELS[key]` → `level.map ?? generateMap(rng, level.gen!)` → `parseMap` → `buildGlyphPool(rng, level, loadout)` → `perksFrom(meta.items)` → 回傳一棵全新的 state。
**`createGame` 不呼叫 `recalcUnits`**，所以 `cdMul` 留在初值 `1`、`hints`/`hintCells` 為空。呼叫端自己補：`app.ts:60`、`app.ts:407`；測試裡的同一個坑見 `__tests__/shop.test.ts:220` 的註解。

### 放一個字 → 可能成兩將

```
actions.placeFromHand(actions.ts:133)
  ├ 空格 → makeGlyphUnit(state.ts:209) ─ 呼叫端負責 state.units.push（actions.ts:160）
  ├ 同字同階 → levelUpGlyph(actions.ts:171)：重建物件但沿用 id 與 formIds，武將不斷線
  ├ tryCombine(actions.ts:275) → combine.findCombinations → makeGeneralUnit(state.ts:306) × 0~2
  └ recalcUnits(state.ts:387)        ← 一定在最後
```

`makeGeneralUnit` 只做三件事：**建殼**（`level`/`baseAtk`/`baseAps`/`income` 全填 0，`state.ts:313-325`）、**設定一次就不再變的欄位**（`tier`/`tags`/`shape`/`troop`/`fx`/`skillCd`/`skillCdMax`）、**接上雙向指標並委派 `recomputeForm`**（`state.ts:337-338`）。

`recomputeForm(state, form)`（`state.ts:355`）才是武將戰力的真正公式所在：`level`、`baseAtk`、`baseAps`、`baseRange`、`onHit`、`aura`、`income` 全部在這裡從當下的成員字牌現算。
👉 **想改武將戰力公式，改 `recomputeForm`；改 `makeGeneralUnit` 裡那些 0 完全沒有效果**（它們在同一次呼叫的最後一行就被覆寫）。舊版文件曾把這點寫反。
這也是「先組將再疊字」與「先疊字再組將」結果一致的原因。

### `recalcUnits()`：四階段，順序不可顛倒（`state.ts:387-435`）

| # | 做什麼 | 行號 | 為什麼在這個位置 |
|---|---|---|---|
| 1 | 對所有 `kind==='general'` 跑 `recomputeForm` | 360-362 | 成員字牌可能剛升階；後面每一步都要吃最新的 `baseAtk`/`baseAps` |
| 2 | `computeBonds` → `activeBonds`、`state.cdMul = bonds.cdMul × perks.cdMul`；再把 `atk`/`aps`/`range` **從 base 重設** | 364-376 | 羈絆條件看的是場上武將名／tag，必須在 1 之後；這一步是唯一「重設」實效值的地方 |
| 3 | 光環：對每個 (source, target) 配對做距離判定，命中就 `target.atk *= …` | 378-392 | 乘在羈絆之上（相乘關係）。source 排除「已成為武將成員的字牌」，否則與武將繼承的光環重複計算 |
| 4 | `skillCdMax = def.skill.cd × state.cdMul`，並把超出的 `skillCd` 夾回上限 | 394-400 | 依賴 2 算出的 `state.cdMul` |
| — | `hints = possibleRecipes(units, handChars)`、`hintCells = computeHintCells(...)` | 402-405 | `computeHintCells` 讀 `state.hints`，必須在它之後 |

顛倒後果：3 移到 2 前面 → 光環倍率被步驟 2 的重設清掉；4 移到 2 前面 → 冷卻用到上一次的 `cdMul`；1 移到 2 後面 → 剛升階的字牌要等下一次操作才生效。

### 不在 `recalcUnits` 裡的東西

`stepGame`（`step.ts:15`）**每 tick 都不呼叫 `recalcUnits`**，只遞減計時器。所以 `recalcUnits` 是 O(n²)（光環配對）也無所謂，但反過來說：任何「戰鬥中會改變 unit 屬性」的新機制都不能靠 `recalcUnits` 生效，得自己在 step 裡處理，或在改動點顯式呼叫一次。

## 契約與陷阱

1. **改動 `state.units` 或 `state.hand` 後必須呼叫 `recalcUnits(state)`**。漏了會出現：武將吃到舊的成員屬性、羈絆沒觸發、`hints`/`hintCells` 不更新、`skillCdMax` 停在舊 `cdMul`。`actions.ts` 裡每個成功分支都有一行 `recalcUnits(state)`（53/76/111/128/151/164/203/214/226/241），新增 action 請照抄這個結尾。
2. **武將戰力公式只在 `recomputeForm`**。`makeGeneralUnit` 的 `baseAtk: 0` 是佔位；`recomputeForm` 沒重算的欄位（`fx`、`troop`、`shape`、`tier`）才是 `makeGeneralUnit` 的責任範圍。
3. **`makeGlyphUnit` / `makeGeneralUnit` 只回傳物件，不會塞進 `state.units`**，但**會遞增 `state.nextUnitId`**。拿它們當「試算探針」（`tools/autobalance.ts:55` 就是這樣用）會消耗 id——不影響正確性，但別依賴 id 連續。
4. **不要把加成寫進 `baseAtk`/`baseAps`**。這兩個欄位被 `recomputeForm` 當作成員的「乾淨值」加總；一旦污染，武將屬性會隨每次 `recalcUnits` 複利膨脹。
5. **`scaleAura`（`state.ts:246`）的成長是「超出 1 的部分 × min(m,3)」**，不是整體乘倍：`1.25` 的光環在高階約到 `1.4`，且 `m` 被夾在 3 倍以內（避免五階光環字失控）。`radius` 完全不隨階級成長。字牌階段就已經 scale 過，武將是**直接沿用第一個帶光環成員的物件參考**（`state.ts:329`、`345`：`parts.find(p => p.aura)?.aura`）——所以 (a) 兩個以上帶光環的成員只有第一個有效，(b) **這是共享參考，任何就地修改 `u.aura` 的程式都會污染字牌**，要改請整個替換物件。
6. **`inheritFx`（`state.ts:269`）只看 `GLYPH_BY_CHAR[char].fx` 明確宣告的值**，刻意忽略 `deriveGlyphFx` 推導出來的預設。理由：姓氏／名字字沒有 `fx`，推導會給它們填 `'blade'`，若把填充值也納入繼承，黃忠這種本該是 `'arrow'` 的武將會被姓氏字的 `'blade'` 蓋掉。挑選規則是 `FX_PRIORITY`（`state.ts:262`）的最前者，`'none'` 一律跳過。三段 fallback：`def.fx ?? inheritFx(parts) ?? deriveGeneralFx(def)`（`state.ts:331`）。
7. **`mergeOnHit`（`state.ts:280`）逐欄位取最大值，不是取某一個字的整包 `OnHit`**；`burn` 的 `mul` 與 `dur` 也是各自取 max（可能組出資料表裡不存在的組合，這是刻意的）。`GeneralDef.onHit` 一旦指定就完全覆蓋繼承（`def.onHit ?? mergeOnHit(parts)`）。此外 `recomputeForm:344-345` 每次都重算 `onHit`/`aura`，所以在別處就地修改武將的 `onHit` 會被下一次 `recalcUnits` 抹掉。
8. **`MAX_LOADOUT_GENERALS = 5` 是新增羈絆的硬約束**（註解在 `state.ts:108-119`）：任何靠「姓名配方武將」達成的羈絆門檻（`requireGenerals.length` 或 `requireTag.count`）都**不得超過 5**。姓名字進不了 `loadoutGlyphs`（見 `data/loadout.ts` 的 `isLoadoutableGlyph`），只能靠 `loadoutGenerals` 帶進場，門檻大於 5 的羈絆在啟用編隊時就永遠湊不齊。例外：tag 掛在「部隊」類武將上的羈絆（配方是兵器／兵種字，可直接選進 `loadoutGlyphs`）不受此限。
9. **`skillCdMax = 0` 表示「沒有可用主動技」**，判定條件是 `def.skill && SKILLS[u.defKey]` 兩者都成立（`state.ts:333`、`397`）。只在 `data/generals.ts` 寫了 `skill` 卻沒在 `sim/skills.ts` 註冊實作 → UI 不顯示、永遠放不出來，且不會報錯。
10. **`recomputeForm` 在 `!parts.length` 時直接 return**（`state.ts:359`），留下舊值。正常流程下成員消失必經 `dissolveFormsOf`（武將整個被移除），所以不會發生；但若新增了「繞過 dissolve 直接刪字牌」的路徑，會留下一個屬性凍結的殭屍武將。
11. **`levelUpGlyph`（`actions.ts:171`）用「重建物件＋沿用 id/formIds/targeting」實作升階**。任何加進 `Unit` 的新欄位若需要跨升階保留（例如玩家設定的偏好），必須在那裡補一行複製，否則會被 `makeGlyphUnit` 的初值重設。
12. **`income` 不吃 `perks.incomeMul`**。`perks.incomeMul` 只乘在每波固定收入上（`step.ts:213`），單位產糧是原值（`economy.ts:43-49`）。字牌產糧刻意用線性 `income × level`（`state.ts:236`），不是 `levelMul` 的指數——五階「商」會直接破壞經濟曲線。武將產糧走平均階級（`state.ts:376-380`）。
13. **`MetaProgress` 定義在 sim 卻被 `data/shop.ts`、`data/loadout.ts`、`data/upgrades.ts` 反向 import**。這些都是 `import type`，編譯後會被抹除，所以沒有真的執行期循環（`state.ts:18` 對 `data/shop` 是值 import）。要在那些 data 檔裡改成值 import 之前，先確認不會做出 `data → sim → data` 的執行期循環。
14. **`types.ts` 不可 import 任何東西**，`state.ts` 不可 import `render/` `ui/` `input/`。這是 `npm run sim` 與所有 sim 測試能在 Node 跑的前提。
15. **`Unit.cells` 必須維持正讀順序**。`combine.ts` 的配方比對、renderer 的武將底板連續繪製、`glyphsOf` 回傳順序都靠它。`makeGeneralUnit:283` 直接沿用 `findCombinations` 給的 `parts` 順序，不要在中途 sort。

## 我想改 X → 動哪裡

| 想改什麼 | 動哪裡 | 注意 |
|---|---|---|
| 武將攻擊／攻速／等級／產糧公式 | `state.ts:355-381` `recomputeForm` | **不是** `makeGeneralUnit`。改完跑 `npm run sim` 對照 CLAUDE.md 的中位數基準 |
| 字牌基礎屬性隨階級的成長 | `data/glyphs.ts:129` `LEVEL_MUL`／`makeGlyphUnit:194` | 影響全部武將（`baseAtk` 是加總來源），改動幅度要小 |
| 羈絆／光環／perks 的疊法（相乘改相加等） | `state.ts:399-421` | 別破壞「每次都從 `base*` 重設」的冪等性 |
| 新增一種全場被動加成 | `types.ts:328` `Perks` ＋ `data/shop.ts` ＋ `state.ts:399-405` | `Perks` 新欄位必須有中性值（倍率 1／機率 0），否則會改變無道具時的難度基準 |
| 光環的成長曲線或半徑 | `state.ts:246` `scaleAura` | `radius` 目前不隨階級成長；武將沿用成員的 aura 物件參考（陷阱 5） |
| 武將的攻擊特效繼承 | `state.ts:262` `FX_PRIORITY` / `240` `inheritFx` / `313` `deriveGeneralFx` | 只認資料表明確宣告的 `fx`（陷阱 6） |
| 控場效果的繼承合併 | `state.ts:280` `mergeOnHit` ＋ `types.ts:34` `OnHit` | 新增 `OnHit` 欄位要同步補一行 max 合併，否則武將不會繼承 |
| `Unit` 加新欄位 | `types.ts:130` ＋ `makeGlyphUnit:183` ＋ `makeGeneralUnit:278` ＋（需跨升階保留時）`actions.ts:171` | 三處工廠都要給初值，否則 `undefined` 會漏到 render |
| `GameState` 加新欄位 | `types.ts:375` ＋ `createGame:112` | 衍生值請在 `recalcUnits` 尾段產生，不要在 render 裡算 |
| 局外存檔加新項目 | `state.ts:47` `MetaProgress` ＋ `DEFAULT_META:61` ＋ `core/save.ts` 的遷移 | 舊存檔沒有這個 key，讀取端要有預設值 |
| 提示光暈的判定 | `state.ts:441` `computeHintCells`（消費端 `render/renderer.ts:235`） | 純 UI，不影響機制，不必跑平衡 |
| 編隊上限／羈絆門檻 | `state.ts:107-119` `MAX_LOADOUT_*` ＋ `data/bonds.ts` | 兩者互相牽制，見陷阱 8 |
| 開局資源／生命／手牌數 | `createGame:127-138` ＋ `data/levels/` ＋ `data/upgrades.ts` | `lives` 與 `maxLives` 要一起改（`state.ts:159-160`） |
| 新增查詢輔助 | `state.ts:184-206` | 一律以 `formIds.length > 0` 排除武將成員字牌，否則攻擊／產糧／光環會被重複計算 |

## 相關頁面

- `../01-architecture.md` — 分層與依賴方向、組詞判定的合約
- `../04-invariants.md` — 七條鐵則的完整版與已知陷阱
- `../03-change-recipes.md` — 「我想改 X → 動哪個檔案」的全專案索引
- `../02-data-tables.md` — `GlyphDef` / `GeneralDef` / `BondDef` 各欄位的平衡基準
- `modules/04-combat-and-skills.md` — `atk`/`aps`/`range` 被誰消費：出手節奏、相剋、爆擊、`OnHit` 的實際套用、主動技與組合技
- 原始碼直讀：`sim/actions.ts`（唯一寫入者）、`sim/combine.ts`（配方比對與 `parts` 順序）、`sim/bonds.ts`（`computeBonds`）、`sim/economy.ts`（`unitIncome`）、`data/shop.ts`（`perksFrom`）
