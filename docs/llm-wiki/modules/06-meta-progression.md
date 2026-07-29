# 局外進度：存檔、兵書、商城、編隊、成就、每日挑戰、續玩

> **負責檔案**
>
> | 檔案 | 規模 | 職責 |
> |---|---|---|
> | `src/core/save.ts` | 185 行 | localStorage 讀寫（局外 meta + 局內存檔兩個 key）、版本遷移、載入時的資料清洗 |
> | `src/sim/persist.ts` | 156 行 | 局內存檔的快照與還原（純函式，不碰 localStorage） |
> | `src/data/daily.ts` | 56 行 | 每日挑戰：由日期推導出關卡與種子（純函式，不碰 Date） |
> | `src/data/upgrades.ts` | 85 行 | 兵書：4 種永久數值養成，效果**直接寫進 MetaProgress** |
> | `src/data/shop.ts` | 275 行 | 商城：16 種可升級被動道具，效果**經 Perks 注入 GameState** |
> | `src/data/loadout.ts` | 78 行 | 編隊：手動挑選字池內容的規則與切換 |
> | `src/data/achievements.ts` | 357 行 | 成就：24 個「計數器 >= 門檻」的達成條件與一次性聲望發放 |
> | `src/core/devtools.ts` | 55 行 | 開發密技：直接竄改 state／meta 的測試後門 |
>
> **上游依賴**：`sim/state.ts`（`MetaProgress`、`DEFAULT_META`、`MAX_*` 常數、`renownFor`）、
> `sim/types.ts:342-377`（`Perks`）、`data/glyphs.ts`、`data/generals.ts`。
>
> **下游使用者**：`main.ts:11`（`loadMeta()` → `new App`）、`app.ts`（唯一呼叫 `saveMeta` 的地方）、
> `ui/screens.ts`（兵書／商城／編隊／成就／密技五個畫面）、`sim/state.ts:145`（`perksFrom`）、
> `sim/pool.ts:58-93`（編隊字池）。

## 這個模組解決什麼問題

局內（`GameState`）每局重置；玩家跨局累積的東西全部住在 `MetaProgress` 這一個物件裡，
序列化成一條 localStorage 字串。五個系統共用同一種貨幣「聲望」：

| 系統 | 存哪裡 | 怎麼影響對局 | 檔案 |
|---|---|---|---|
| 圖鑑 | `seenGlyphs` / `seenGenerals` | 不影響（純收集紀錄），但是編隊的解鎖判定來源 | 由 `app.ts:139-189` 每幀寫入 |
| 兵書 | `handSize` / `wishSlots` / `extraFood` / `extraLives` | `createGame` 直接讀這些欄位 | `data/upgrades.ts` |
| 商城 | `items`（key → 等級） | 先推導成 `Perks`，再注入 `GameState.perks` | `data/shop.ts` |
| 編隊 | `loadoutActive` / `loadoutGlyphs` / `loadoutGenerals` | `createGame` 轉成 `LoadoutConfig` 給 `buildGlyphPool` | `data/loadout.ts` |
| 成就 | `achievements`（key → 解鎖序號）+ `totals` | **不影響對局**，只發聲望（是聲望的第三個來源） | `data/achievements.ts` |
| 每日挑戰 | `daily`（dateKey → 抵達波次） | **刻意完全不影響**：每日挑戰用中性 meta 開局 | `data/daily.ts` |
| 圖鑑（敵人） | `seenEnemies` | 不影響 | 由 `app.ts` 每幀寫入 |

分工的關鍵差別：**兵書改的是 meta 欄位本身**（所以 `UpgradeDef.level()` 得從欄位值反推等級），
**商城改的是一張獨立的等級表**（等級直接存著，效果每局重算），
**成就完全不改對局、只往 `meta.renown` 加數字**。新增養成項目時先決定屬於哪一類。

## 核心概念

### ★ 不變量：`perksFrom()` 在等級 0 必須回傳中性值

`NEUTRAL_PERKS`（`data/shop.ts:230-248`）是中性值的**單一真相來源**，
`perksFrom()`（`:251-258`）先 spread 它，再只對 `lv > 0` 的道具呼叫 `apply`。

```
倍率類（*Mul）中性 = 1　　機率／間隔類（*Chance、meteorInterval、healEveryWaves）中性 = 0
```

為什麼是不變量：`npm run sim` 的 `createGame(LEVEL, seed)`（`tools/autobalance.ts:63`）走 `DEFAULT_META`，
`items` 為 `{}` → 全中性 Perks。**任何一個欄位的中性值寫錯，整份難度基準（黃巾 12／董卓 18／巨鹿 20…）就全部失效**，
而且會靜默失效——模擬照跑，只是數字不再可比。守護測試：`sim/__tests__/shop.test.ts:53-76`
（逐欄比對全 17 個中性值）與 `:76-86`（每種道具只准動自己那 1 欄，`crit` 例外動 2 欄）。

### 為什麼要 Perks 這層間接

`sim/` 只認識 `Perks` 這個中性的扁平結構，**完全不知道商城存在**：
沒有 `items`、沒有價格、沒有 key 字串。好處有三：

1. 維持分層（`sim/` 不 import 存檔或 UI），`npm run sim` 與單元測試能直接捏 `state.perks.xxx` 做定點測試
   （見 `shop.test.ts:115`、`:137`、`:180` 都是直接改 perks 欄位、避免依賴亂數）。
2. 商城可以任意改價、改等級曲線、換道具名稱，`sim/` 一行都不用動。
3. `Perks` 整局固定（`createGame` 算一次），所以 `recalcUnits` 每次重算都能安全地重乘一遍。

**⚠ 效果只在「下一局開始」生效**（`ui/screens.ts:299` 的說明文字就是這件事），
因為 `perksFrom` 只在 `createGame`（`sim/state.ts:145`）被呼叫過一次。

### Perks 的 17 個欄位在 sim 的讀取點

| 欄位 | 中性值 | 道具 | sim 讀取點 |
|---|---|---|---|
| `recruitEliteChance` | 0 | `elite` 精兵符 | `sim/actions.ts:49`（征兵時每格判定 → level 2） |
| `meteorInterval` | 0 | `meteor` 流星火雨 | `sim/step.ts:46`（`<= 0` 直接 return）、`:49`；初值寫進 `sim/state.ts:184` 的 `meteorTimer` |
| `incomeMul` | 1 | `supply` 糧道暢通 | `sim/step.ts:213`（只乘 `waveIncome`，**不含** `unitIncome`） |
| `healEveryWaves` | 0 | `medic` 杏林春暖 | `sim/step.ts:223-229`（`checkWaveEnd` 內，勝利 return 之後） |
| `atkMul` | 1 | `banner` 號令旗 | `sim/state.ts:407`（`recalcUnits`，乘在羈絆 `atkMul` 之後） |
| `apsMul` | 1 | `gale` 疾風令 | `sim/state.ts:408` |
| `critChance` | 0 | `crit` 奇兵秘計 | `sim/combat.ts:187` |
| `critMul` | 1 | `crit`（同一個 `apply` 寫兩欄） | `sim/combat.ts:188` |
| `extraLives` | 0 | `fortify` 鐵壁工事 | `sim/state.ts:165-166`（`lives` 與 `maxLives` 同時加） |
| `costMul` | 1 | `thrift` 輕裝簡從 | `sim/economy.ts:23`（`recruitCost`）、`:102`（`rerollCost`） |
| `familiarBoostMul` | 1 | `familiar` 廣結善緣 | `sim/actions.ts:43`／`:70` 塞進 `RollContext` → `sim/economy.ts:100` 乘在 `FAMILIAR_BOOST` 上 |
| `leakBlockChance` | 0 | `leakshield` 回魂旗 | `sim/step.ts:162`（`stats.leaks` 照計，只擋扣命） |
| `splashMul` | 1 | `splash` 烽火連城 | `sim/combat.ts:314`（pierce）、`:324`（splash） |
| `bountyMul` | 1 | `bounty` 狩獵好手 | `sim/combat.ts:157`（`damageEnemy` 的死亡結算，`foodEarned` 也吃這個值） |
| `enemySpeedMul` | 1 | `enemyslow` 沼澤泥沼 | `sim/step.ts:155`（乘在 `SLOW_FACTOR` 之後） |
| `rangeMul` | 1 | `range` 精工兵器 | `sim/state.ts:410`（乘在 `effectiveRange` 之後） |
| `cdMul` | 1 | `bondcd` 兵法傳承 | `sim/state.ts:403` → 寫入 `state.cdMul`，再由 `sim/state.ts:432`（`skillCdMax`）與 `sim/bonds.ts:47`／`:66`（組合技 `cdMax`）讀取 |

沒有第 18 個讀取點：`state.perks` 只被上表這幾處讀。要加新欄位就照這張表補一行。

### 價格曲線：線性，不是指數

`stdCost(base)`（`data/shop.ts:44-46`）：

```ts
(level) => base + level * Math.round(base * 0.55)
```

三級的實際倍率是 **1× / 1.55× / 2.10×（加法）**，不是每級再乘 1.55（那會是 1× / 1.55× / 2.40×）。
理由寫在原始碼註解：道具效果本身也是線性遞增（例如 +8%／+14%／+20%），
價格若指數成長，第 3 級性價比會差到沒人買。

買滿總價（改價時的兩個對照數字）：

| | 買滿聲望 | 換算局數（一局 25～45） |
|---|---|---|
| 商城 16 種 × 3 級 | **13590**（只買到 1 級是 2920） | ≈300～540 局 |
| 兵書 4 項全滿 | **1230**（hand 360 + wish 240 + food 270 + lives 360） | ≈28～50 局 |

兩者共用同一個 `meta.renown`，所以商城是超長期投資標的、兵書是短期「先買哪一項」的決策。
**動任何一邊的價格都要重算另一邊的相對吸引力。**

### 聲望結算

公式在 `sim/state.ts:128-130`（放在 sim 是為了讓測試不必碰 app 層）：

```ts
renownFor(wave, kills, won) = max(1, round(wave * 1.5 + kills * 0.05) + (won ? 20 : 0))
```

波次是主要來源，擊殺是零頭，通關 +20。呼叫點只有 `app.ts:196`，
用 `this.renownPaid` 旗標保證 **一局只結一次**（`phase` 變成 `won`／`lost` 後每幀都會經過那段）。

### ★ 成就：每一個都是「計數器 >= 門檻」，沒有布林條件

`AchievementDef`（`data/achievements.ts:37-53`）刻意**不提供** `done()` 這種布林判定，
只有 `progress()` 與 `goal`。達成判定是 `progress() >= goal`，UI 的進度條讀的是同一組數字——
**兩者不可能說法不一致**。布林類的成就（例如「通關任一關」）就寫成回傳 0 或 1、`goal` 為 1。

| 欄位 | 意義 |
|---|---|
| `group` | UI 分區：`battle` 戰陣／`build` 布陣／`collect` 圖鑑／`journey` 征途（`GROUP_ORDER` 決定顯示順序） |
| `scope` | `'run'` 只看目前這一局／`'career'` 看 `MetaProgress` 跨局累積。**同時決定 UI 的「單局」標籤** |
| `goal` | 門檻。全收集類直接寫 `GLYPHS.length`／`GENERALS.length`／`LEVEL_ORDER.length`，不寫死數字 |
| `renown` | 一次性獎勵 |
| `progress(state, meta)` | 目前計數。`state` 為 `null` 代表玩家在選單畫面 |

**`scope: 'run'` 的 `progress()` 在 `state === null` 時必須回傳 0**，
否則在選單畫面會誤判成達成。`achievements.test.ts` 有一個測試逐項掃過這條規則。

`claimAchievements(meta, state)`（`achievements.ts:346-357`）**原地改 meta**、回傳這次新解鎖的清單，
慣例與 `buyUpgrade`／`buyItem` 完全一致（呼叫端負責 toast、音效與 `saveMeta`）。

解鎖時存進 `meta.achievements[key]` 的是**解鎖序號**（1 起算）而不是時間戳：
UI 只需要順序，而序號讓 `data/achievements.ts` 不必碰 `Date`，整個檔案維持純函式、可在測試裡重播。

### 成就的兩個計數來源

1. **既有的 meta 欄位**：`cleared` / `best` / `seenGlyphs` / `seenGenerals` / `handSize`。
2. **`meta.totals`**（`RunTotals`，型別定義在 `sim/state.ts:29-40`）：`runs` / `wins` / `kills` / `waves`。

⚠ `totals` **只在一局真正結束（勝或敗）時累加一次**，就寫在 `app.ts:198-203` 的
`renownPaid` 區塊裡。放這裡是為了共用那個「一局只結一次」的旗標——
若改成每幀累加，同一局會被重複計入；若改成回選單時累加，玩家反覆開關選單也會重複計入。
代價是**中途離開的那一局不列入統計**，這是刻意接受的定義（UI 的說明文字有寫）。

`RunTotals` 的型別定義放在 `sim/state.ts` 而不是 `data/achievements.ts`，
是為了讓 `data → sim` 這條邊維持「只取型別、不反向」——`data/achievements.ts` 只 `import type`。

### 檢查時機（三個進入點）

| 時機 | 位置 | 為什麼需要它 |
|---|---|---|
| 每 0.5 秒輪詢 | `app.ts:209-214` | 24 個成就要掃全場單位，不必每幀跑；0.5 秒對 toast 來說夠即時 |
| 一局結束的當下 | `app.ts:206`（`renownPaid` 區塊內） | 「通關且沒掉命」這類條件**只有那一刻成立**，等下一次輪詢玩家可能已經回選單 |
| 切換畫面時 | `app.ts:431-436` 的 `show()` | `syncProgress` 在選單畫面會早退，所以「在選單裡才達成」的成就（把兵書買滿）只能靠這裡補 |

⚠ **成就解鎖是立即 `saveMeta`，不走 2 秒節流**（`app.ts:229-242`）：
多數成就在一局結束的那一刻達成，而玩家常常馬上回選單，等節流會來不及寫入。

⚠ **一次解鎖多項時要合併成一則 toast**。`hud.toast()` 只有一格、後蓋前（`ui/hud.ts:172-176`），
在迴圈裡逐項 toast 只會看到最後一項。`app.ts:237-242` 因此把它們併成一句。

### 成就的獎勵總額是一個平衡數字

全部 24 個成就共 **2130** 聲望（`TOTAL_ACHIEVE_RENOWN`，由資料表自動加總）。
刻意夾在兵書買滿 **1230** 與商城買滿 **13590** 之間：足以明顯加速前中期，
但遠不足以跳過商城這個長期目標。`achievements.test.ts` 有一個守護測試把這個區間鎖住，
所以調整任何一項的 `renown` 時測試會提醒你回頭看這三個數字。

### ★ 每日挑戰：日期就是種子

本專案早就保證「同種子 → 同一場對局」，所以每日挑戰只要**用日期算出種子**就成立——
不需要伺服器、不需要同步。`data/daily.ts` 是純函式，**日期字串由 app 層傳進來**
（`app.ts` 的 `todayChallenge()`），理由跟 `sim/` 禁用 `Date.now()` 一樣：可測試、可重播。

```
dateKeyOf(new Date())  →  '2026-07-30'          ← app 層，當地時區
dailyChallenge(key)    →  { levelKey, seed }    ← 純函式，FNV-1a 雜湊
```

⚠ `dateKeyOf` **不能用 `toISOString()`**——那是 UTC，UTC+8 的深夜會被算成前一天。

**⚠ 每日挑戰一律用中性 meta（`DEFAULT_META`）開局。** 這不只是公平問題，
**更是重現性的必要條件**——三種養成都會改變 rng 的消耗量：

| 養成 | 為什麼會破壞重現性 |
|---|---|
| 編隊 | `buildGlyphPool` 在編隊模式下**完全不消耗 rng**（`pool.ts:59` 直接 return） |
| 商城 | 精兵符每張牌都抽一次 rng；爆擊則是短路不抽——買了就位移整條亂數流 |
| 兵書 | 手牌格數決定每次征兵抽幾張 → 直接改變 rng 的消耗量 |

任何一項不同，同一顆種子就會長出不同的對局。**新增任何養成項目時都要回來確認這件事。**

### ★ 局內續玩存檔

`GameState` 唯一不可序列化的是 `rng` 閉包，而 mulberry32 的**整個狀態就只有一個 uint32**，
所以續玩不必「存 seed 再重播整局」，存那個數字就夠了（`core/rng.ts` 的 `getState`／`setState`）。

還原策略是**「重建骨架 + 覆蓋可變欄位」**而不是逐欄反序列化（`sim/persist.ts`）：

```
1. createGame(levelKey, seed, meta)   重建 board——地圖由 (關卡, 種子) 完全決定，不必存
2. 把快照的可變欄位蓋回去              units / enemies / hand / food / wave / stats…
3. rng.setState(snap.rngState)        接回亂數流
4. recalcUnits(state)                 衍生值全部重算
```

因此**衍生值一律不存**（`activeBonds` / `cdMul` / `hints` / `atk` / `range`…）——
存了反而會在資料表改版後變成過期的假資料。`effects`（純視覺）與 `events`（每幀 drain）同理。

| 何時寫 | 位置 |
|---|---|
| 每波開始（佈陣階段） | `app.ts` 的 `syncProgress`，用 `savedWave` 做到一波只寫一次 |
| 頁面隱藏／關閉 | `pagehide` 與 `visibilitychange`——手機切背景不會有 `unload`，這兩個才可靠 |
| 分出勝負 | 改成 **`clearRun()`**：打完的局沒有續玩的必要 |

⚠ **新增 `GameState` 的可變欄位時要一併加進 `RunSnapshot`**，否則續玩會靜默遺失它。
⚠ 還原時 `perks` 與 `handSize` **取快照的值**，不是重新從 meta 算——
否則存檔期間買的道具會回溯生效，違反「商城效果只在下一局開始套用」。

守護測試在 `sim/__tests__/persist.test.ts`，其中最重要的一條是
**「還原後繼續跑，會走出跟沒中斷過完全相同的一局」**。

## 主要流程

### 開機載入與清洗（`core/save.ts:47-87`）

```
localStorage['tdwordwar.meta.v3']（沒有 → 依序找 LEGACY_KEYS: v2, v1）
  → JSON.parse
  → 逐欄補預設值 + clamp（handSize 5..8、extraFood 0..50、extraLives 0..5、wishSlots 1..3、renown >= 0）
  → items(p.items)：舊版 string[] → Record<key, level>（見下）
  → loadoutGlyphs 重新過濾：seenGlyphs.includes(ch) && isLoadoutableGlyph(ch)，再 slice(0, 8)
  → loadoutGenerals 重新過濾：isGeneralUnlocked(seenGlyphs, seenGenerals, name)，再 slice(0, 5)
  → achievements(p.achievements)：丟掉 ACHIEVEMENT_BY_KEY 查不到的 key
  → totals(p.totals)：每一欄夾成非負整數
  → 任何 throw → { ...EMPTY_META }
```

**重點：`loadMeta` 是每次開機都跑的資料清洗器**，不只是反序列化。
規則改了（例如某個字改成 `surname` 類別、某個武將被刪掉、`MAX_LOADOUT_*` 調小），
舊存檔的編隊內容會在下次載入時自動被清掉，不需要寫遷移程式。
反過來說：**編隊的合法性規則只要放進 `isLoadoutableGlyph`／`isGeneralUnlocked`，就自動具備向後相容。**

`items()`（`:84-105`）的相容轉換：舊版 `items` 是 `string[]`（一次性擁有）→ 全部視為 Lv.1；
新版是物件 → 逐一 `clamp(floor(lv), 0, def.max)`，`SHOP_BY_KEY` 查不到的 key 直接丟棄。

`achievements()`（`:107-116`）與 `totals()`（`:118-122`）同一套哲學：
**刪掉或改名一個成就，舊存檔會在下次載入時自動清乾淨，不必寫遷移**。
`totals` 的每一欄都夾成非負整數，因為存檔是使用者可以手改的輸入。

⚠ 新增 `achievements` / `totals` 兩個欄位**沒有**把 `KEY` 升到 v4：
純新增欄位靠 `loadMeta` 補預設值就向後相容，只有**改變既有欄位語意**才需要升版。

### 寫入（`saveMeta`）

`saveMeta` 本身沒有節流，**節流在 app 層**：`app.ts:216-222`，
`metaDirty` 旗標 + `saveTimer` 倒數，最多每 2 秒寫一次（圖鑑是每幀掃描的，不節流會每幀寫 localStorage）。
但**購買／編隊／密技類操作是立即寫入**（`app.ts:366`、`:296`、`:305`、`:311`、`:318`、`:326`、`:347`）——
它們發生在選單畫面，`syncProgress` 因為 `screens.visible` 早退（`app.ts:140`）不會跑到節流那段。

### 購買（兵書與商城完全同構）

```
buyUpgrade(meta, key)  /  buyItem(meta, key)
  找 def（找不到 → { ok:false }）
  → 讀目前等級（兵書從 meta 欄位反推；商城讀 meta.items[key] ?? 0）
  → 已滿級 → 擋
  → def.cost(lv) > meta.renown → 擋
  → meta.renown -= cost；兵書呼叫 def.apply(meta)／商城 meta.items[key] = lv + 1
  → 回傳 BuyResult { ok, msg }（msg 直接進 toast，見 app.ts:368）
```

兩者都**原地改 meta、不回傳新物件**，呼叫端要自己 `saveMeta` 並重繪畫面。

### 編隊套用（跨到 sim 的路徑）

```
meta.loadoutActive ? { glyphs, generals, seenGlyphs } : undefined   // sim/state.ts:140-142
  → buildGlyphPool(rng, level, loadout)                             // sim/state.ts:143
  → buildLoadoutPool()                                              // sim/pool.ts:75-93
     編隊字 ∪ 編隊武將的 recipe 字 ∪ 全部「還沒解鎖過」的字
     （空池防呆 → 退回 ALWAYS 骨幹字）
```

`loadoutActive = false` 時完全走原本的隨機抽樣，`loadoutGlyphs` 不影響任何東西
（`sim/__tests__/loadout.test.ts:172-187` 守這件事）。字池與抽卡加權的規則本身在 `sim/pool.ts`／`sim/economy.ts`。

## 契約與陷阱

**★ `perksFrom()` 等級 0 必須中性。** 見上。改 `NEUTRAL_PERKS` 或新增 Perks 欄位時，
`shop.test.ts:53-76` 那份硬編碼清單也要同步，否則測試會告訴你哪裡漏了。

**⚠ `MAX_LOADOUT_GENERALS = 5` 是新增羈絆的硬約束**（宣告與理由在 `sim/state.ts:114-125`）。
姓名字**不能**選進 `loadoutGlyphs`，只能透過 `loadoutGenerals` 帶入，
所以任何「只能靠姓名配方武將達成」的羈絆門檻（`requireGenerals.length` 或 `requireTag.count`）
一旦 > 5，該羈絆**在啟用編隊時就永遠湊不齊**。蜀漢棟樑曾經是 6，踩過這個坑。
例外：tag 掛在「部隊」武將上的羈絆（虎狼之師）不受限，因為部隊配方是兵器／兵種字，可直接選進 `loadoutGlyphs`。
守護測試：`sim/__tests__/loadout.test.ts:23-51`（會逐一列出違規的羈絆名稱）。
`5` 這個數字本身 = `BONDS` 裡最大的 `requireGenerals` 長度（五虎上將），要動就兩邊一起動。

**⚠ 編隊的兩條非顯而易見規則。**
(a) `isLoadoutableGlyph`（`data/loadout.ts:22-25`）只允許 `weapon`／`troop`／`strategy`／`economy` 四類；
`surname`／`given` 被排除，因為姓名字單獨戰力極低、存在的唯一目的是組武將——
讓玩家選「張」而不是選「張飛」只會浪費格子。這也和 `sim/pool.ts` 的 ALWAYS／SUPPORT／NAMED_RECIPES 三分法一致。
(b) `isGeneralUnlocked`（`:33-41`）比 `seenGenerals` **寬**：配方字都在 `seenGlyphs` 裡就算解鎖，
不必真的湊出來過——否則玩家明明字都抽過了卻選不到那名武將，會很困惑。
它刻意接收兩個陣列而不是整個 `MetaProgress`，這樣 `core/save.ts:79` 才能在物件還沒組完時就呼叫。

**⚠ 買道具會改變 rng 呼叫序列，同種子只在「同一份 `meta.items`」下可重現。**
`sim/actions.ts:49` 的精兵符判定**無條件**消耗一次 `rng()`（所以中性時也照樣消耗，基準穩定），
但 `sim/combat.ts:187` 的爆擊判定有 `critChance > 0 &&` 短路（中性時不消耗）。
結論：買了奇兵秘計後，整條 rng 流會位移。回報 bug 時種子必須連同 `items` 一起附上。

**⚠ `EMPTY_META`（`core/save.ts:27-45`）與 `DEFAULT_META`（`sim/state.ts:92-110`）是兩份重複定義。**
新增 `MetaProgress` 欄位要改 **4 個地方**：型別、`DEFAULT_META`、`EMPTY_META`、`loadMeta` 的解析與 clamp。
漏掉 `loadMeta` 的話新欄位會是 `undefined`，執行期才炸。

**⚠ 兵書的 `level()` 是從 meta 欄位反推的。** 例如 `food` 的 `level: (m) => Math.round(m.extraFood / 6)`
搭配 `apply: (m) => { m.extraFood += 6 }`。改步長（6）必須同時改除數，否則等級顯示與滿級判定會錯亂；
`core/save.ts` 的 clamp 上限（`extraFood` 0..50、`extraLives` 0..5）也要留足餘裕（目前 max 4 級 × 6 = 24）。

**⚠ `sim/` 不能 import `core/save.ts`。** `localStorage` 在 Node 不存在（`npm run sim` 會炸）。
現況只有 `main.ts` 與 `app.ts` 認識存檔。`saveMeta`／`loadMeta` 都有 try/catch，是為了瀏覽器隱私模式。

**依賴方向的既有例外**：`data/loadout.ts:14` 從 `sim/state.ts` import `MAX_LOADOUT_*`（值，不只型別），
`data/shop.ts` 也 import `type { Perks }`／`type { MetaProgress }`。`data → sim` 這條邊只放常數與型別，
不要以為可以把 `MAX_LOADOUT_GENERALS` 搬進 `data/`——它跟 `MAX_HAND_SIZE` 等一起住在 `sim/state.ts:111-125`。

**局外 meta 與局內存檔是兩個獨立的 key。** `tdwordwar.meta.v3` 每 2 秒可能寫一次，
`tdwordwar.run.v1` 只在每波開始與頁面隱藏時寫；分開存也讓局內存檔壞掉時不會連累局外進度。
`GameState` 含 `rng` 閉包不能直接 `JSON.stringify`，快照的產生與還原在 `sim/persist.ts`（純函式）。

**靜音設定不在這裡。** `tdwordwar.muted` 是獨立的 key，讀寫在 `app.ts:649-665`，不走 `MetaProgress`。

**`loadMeta` 不清洗 `seenGlyphs`／`seenGenerals`。** `arr()`（`:98-100`）只過濾非字串。
刪掉某個字／武將後，舊存檔會殘留不存在的識別字；目前無害（圖鑑 UI 是迭代 `GLYPHS` 再比對 Set，
編隊過濾也會因為查不到 def 而回 false），但新增讀 `seenGlyphs` 的程式碼時不要假設每個元素都查得到 def。

**開發密技刻意繞過驗證。** `core/devtools.ts` 直接改 `state`／`meta`，**不經過 `sim/actions.ts`**——
這是明知故犯的例外（檔頭註解有寫），與 `main.ts` 的 `__dev` console 掛載點同等級的測試後門。
入口：選單標題 **2.5 秒內連點 7 下**（`ui/screens.ts:140-149` 的 `handleTitleTap`），面板在 `:165-206`。
凡是改 `state.units`／`state.hand` 的密技都必須自己呼叫 `recalcUnits`（`devtools.ts:29`、`:53` 已經有）。
`devClearEnemies` 靠清空 `enemies` + `spawnQueue`，讓下一幀的 `checkWaveEnd` 自然結算進下一波。

## 我想改 X → 動哪裡

| 想改什麼 | 動哪裡 | 注意 |
|---|---|---|
| 調某個道具的數值 | `data/shop.ts` 對應項的 `detail` + `apply` 兩個陣列 | 兩處等級數必須一致，且 `apply` 只准寫自己那一欄（`shop.test.ts:78-88` 會抓） |
| 新增一種商城道具 | ① `sim/types.ts:342` 加 `Perks` 欄位 → ② `data/shop.ts:230` 加中性值 → ③ `SHOP` 加一項（`cost: stdCost(base)`）→ ④ 在 `sim/` 讀取點乘進去 → ⑤ 更新 `shop.test.ts:53-76` 的中性清單 | **中性值一定要是 1 或 0**；讀取點記得寫上「中性時為何無影響」的註解；跑 `npm run sim` 確認中位數沒變 |
| 改道具價格 | `stdCost(base)` 的 base，或整條曲線（`data/shop.ts:44-46`） | 重算買滿總價，跟兵書的 1230 一起看；`shop.test.ts:45-49` 要求逐級遞增 |
| 提高道具等級上限 | `MAX_ITEM_LEVEL`（`data/shop.ts:20`）+ 每項的 `detail`／`apply` 陣列補值 | `apply` 用 `[...][lv-1]` 索引，陣列長度不足會拿到 `undefined` → NaN 傳染整局 |
| 調／新增兵書項目 | `data/upgrades.ts` 的 `UPGRADES` | `level()` 必須是 `apply()` 的反函數；新欄位要同步 `MetaProgress`＋兩份預設值＋`loadMeta` clamp |
| 改聲望給多少 | `sim/state.ts:128-130` 的 `renownFor` | 商城／兵書總價的「換算局數」註解要跟著改（`shop.ts:12`、`upgrades.ts:5`） |
| 改編隊上限 | `sim/state.ts:113`／`:90` | 動 `MAX_LOADOUT_GENERALS` 前先讀 `loadout.test.ts:23-51`；調小的話舊存檔會被 `loadMeta` 的 `slice` 截斷（可接受） |
| 改「哪些字能選進編隊」 | `data/loadout.ts:22-25` 的 `isLoadoutableGlyph` | 規則改嚴 → 舊存檔下次載入自動清理（`core/save.ts:76`），不用寫遷移 |
| 改武將解鎖判定 | `data/loadout.ts:33-41` 的 `isGeneralUnlocked` | 同時影響圖鑑列表（`ui/screens.ts:406`）與 `loadMeta` 過濾 |
| 新增存檔欄位 | `sim/types.ts`／`sim/state.ts:47` 型別 → `DEFAULT_META` → `EMPTY_META` → `loadMeta` 解析 | 4 處全改；能 clamp 的就 clamp，存檔是使用者可手改的輸入 |
| 每日挑戰的關卡輪替／種子 | `data/daily.ts` 的 `dailyChallenge()` | 純函式、不碰 `Date`；改完 `persist.test.ts` 的「一年內每一關都會輪到」會驗證 |
| 續玩要多存一個欄位 | `sim/persist.ts` 的 `RunSnapshot` ＋ `snapshotRun` ＋ `restoreRun` | 三處一起改。**衍生值不要存**，它們由 `recalcUnits` 重算 |
| 局內存檔的寫入時機 | `app.ts` 的 `persistRun()` 呼叫點 | 目前是每波一次 + 頁面隱藏；改成更頻繁要留意 localStorage 的寫入成本 |
| **新增一個成就** | `data/achievements.ts` 的 `ACHIEVEMENTS` 加一筆 | 只要有 `progress()` 與 `goal` 就完成，UI 與存檔清洗都會自動跟上。⚠ `scope: 'run'` 的 `progress()` 在 `state === null` 時必須回 0；獎勵改動會被總額守護測試擋下 |
| 成就的獎勵額度／總額 | 各筆的 `renown` | 總額 2130 夾在兵書 1230 與商城 13590 之間，`achievements.test.ts` 有守護測試 |
| 成就分區／分區順序 | `AchieveGroup` + `GROUP_LABEL` + `GROUP_ORDER`（`achievements.ts:26-35`） | 三者都是 `Record<AchieveGroup, …>`，漏填 tsc 會擋；不在 `GROUP_ORDER` 裡的分區**整區不會被畫出來**（有測試把關） |
| 成就的檢查頻率 | `app.ts:211` 的 `achieveTimer = 0.5` | 調小會讓每幀成本上升（要掃全場單位），調大會讓 toast 變遲鈍 |
| 跨局統計要多記一項 | `RunTotals`（`sim/state.ts:29-40`）＋ `EMPTY_TOTALS` ＋ `core/save.ts` 的 `totals()` ＋ `app.ts:198-203` 的累加 | 累加**只能**放在 `renownPaid` 區塊裡，否則同一局會被重複計入 |
| 破壞性改存檔格式 | `core/save.ts:24-25`：`KEY` 升到 v4，把 v3 推進 `LEGACY_KEYS` | 舊 key 的資料會被當成 partial 解析，不相容的欄位靠 clamp／過濾吸收 |
| 新增一個開發密技 | `core/devtools.ts` 加函式 → `ui/screens.ts:53-59` 的 host 介面 → `app.ts:401+` 轉接 → `:173` 的 `actions` 陣列加按鈕 | 改 `units`／`hand` 要 `recalcUnits`；改 `meta` 要 `saveMeta` |

## 相關頁面

- [01-state-and-units.md](01-state-and-units.md) — `MetaProgress`／`GameState` 的完整欄位、`recalcUnits` 的四階段（本頁只引用不重寫）
- [../02-data-tables.md](../02-data-tables.md) — 字／武將／羈絆的資料表欄位與平衡基準（羈絆門檻與 `MAX_LOADOUT_GENERALS` 的關聯）
- [../03-change-recipes.md](../03-change-recipes.md) — 跨模組的改動流程
- [../04-invariants.md](../04-invariants.md) — 全專案的七條鐵則與已知陷阱
- [../06-roadmap.md](../06-roadmap.md) — 未實作項目（含「局內續玩」需要的 rng state 暴露）
