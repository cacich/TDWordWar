# 經濟、波次與模擬主迴圈

> **負責檔案**
>
> | 檔案 | 規模 | 職責 |
> |---|---|---|
> | `src/sim/step.ts` | 173 行 | `stepGame` 主迴圈：生成／狀態／移動／戰鬥／技能／流星／清屍／波次結算 |
> | `src/sim/waves.ts` | 56 行 | 敵人血量曲線（`HP_GROWTH`）、數量、BOSS 判定、`buildWave` |
> | `src/sim/economy.ts` | 106 行 | 征兵／重抽花費、每波收入、抽字權重（稀有度＋熟悉度＋心願）、退款 |
> | `src/sim/pool.ts` | 99 行 | 每局字池（隨機抽樣 / 編隊兩種模式） |
> | `src/data/enemies.ts` | 20 行 | 5 種敵人的資料表 + `ANTI_AIR_RANGE` |
>
> **上游依賴**：`core/rng.ts`（`mulberry32` / `pickWeighted`）、`data/glyphs.ts`、`data/generals.ts`、
> `data/levels/index.ts`（`LevelDef.pool` / `hpMul` / `maxWave`）、`sim/combat.ts`（`damageEnemy` / `enemyPos` / `stepCombat` / `SLOW_FACTOR`）、
> `sim/skills.ts`、`sim/bonds.ts`、`sim/events.ts`、`sim/types.ts`（`Perks` / `SpawnEntry`）。
> **下游使用者**：`core/loop.ts`（唯一呼叫 `stepGame` 的地方，固定 1/60）、`app.ts:85`、
> `tools/autobalance.ts:80`（`npm run sim`）、`sim/actions.ts`（花費與抽字）、`sim/state.ts:108`（`createGame` 建字池）、`ui/hud.ts:193,196`（顯示花費）。

## 這個模組解決什麼問題

三件事，三條曲線：

1. **難度曲線** — 敵人血量指數成長（`waves.ts:13`），玩家戰力也是指數成長（疊字 ×1.55／階 + 武將 `atkMul`），
   兩條指數曲線要在 12～20 波交叉。`npm run sim` 就是量這個交叉點的儀表板。
2. **經濟曲線** — 糧的三個來源（每波固定收入、場上經濟單位產糧、擊殺賞金）對上兩個支出（征兵、重抽）。
3. **抽卡收斂** — 71 個字全丟進池子的話，「想疊高某個字」或「想湊某個武將」的機率極低。
   三層收斂：**每局字池**（`pool.ts`）→ **熟悉度加權**（`FAMILIAR_BOOST`）→ **心願單**（`WISH_BOOST`）。

## 核心概念

### 難度旋鈕（改動前先讀這段）

| 常數 | 值 | 位置 | 意義 |
|---|---|---|---|
| `BASE_HP` | 20 | `waves.ts:7` | 第 0 波的基準血量（實際從 wave 1 起算，所以最低是 25） |
| `HP_GROWTH` | **1.25** | `waves.ts:13` | 每波血量倍率。**全專案最敏感的旋鈕** |
| `PREP_SECONDS` | 12 | `waves.ts:14` | 佈陣秒數，`createGame` 與 `checkWaveEnd` 共用 |
| `enemyCount` | `6 + ⌊wave×1.4⌋` | `waves.ts:20` | 每波敵數（wave 1→7、10→20、20→34、30→48、40→62） |
| `gap` | 0.75 秒 | `waves.ts:42` | 出怪間隔，**寫死在 `buildWave` 內的區域變數**，不是匯出常數 |
| `isBossWave` | `wave % 5 === 0` | `waves.ts:24` | BOSS 在第 n×0.75+2 秒追加一隻 |
| `level.hpMul` | 0.85～1.3 | `data/levels/index.ts` | 關卡難度倍率，乘在 `buildWave` 內（`waves.ts:39`），**不在 `enemyBaseHp` 裡** |

`enemyBaseHp(wave) = 20 × 1.25^wave`：wave 10 ≈ 186、wave 20 ≈ 1735、wave 30 ≈ 16156、wave 40 ≈ 150463。
巨鹿（`hpMul` 1.15）第 30 波的 BOSS 因此有 16156 × 1.15 × 14 ≈ 260000 血。

**`HP_GROWTH` 的調整歷史**（註解在 `waves.ts:9-12`，改動時請一併更新）：

```
1.18 → 1.19（M3 技能與光環）
     → 1.21（M4b 武將可持續疊字，玩家後期戰力變成指數成長）
     → 1.25（射程全域 ×2 後塔覆蓋更長路徑、難度下滑，用血量成長拉回 12～20 區間）
```

改任何數值後**必跑 `npm run sim`**（`tools/autobalance.ts`：傻 AI 固定策略打 30 局，印陣亡波次中位數）。
目標區間寫在 `autobalance.ts:109`：中位數 12～20。CLAUDE.md 記載的現況基準：

| 關卡 | 黃巾 | 董卓 | 巨鹿 | 官渡 | 赤壁 | 五丈原 |
|---|---|---|---|---|---|---|
| 傻 AI 中位數 | 12（滿關） | 18（滿關） | 20 | 18 | 18 | 20 |

前兩關是教學弧，傻 AI 打得完是刻意的。`npm run sim 16 guandu` 可指定局數與關卡。
`npm run sim` 用預設 meta（無商城道具）→ 全中性 `Perks`，所以**商城道具永遠不影響難度基準**（`data/shop.ts:8-9`、`types.ts:294-296`）。

### 敵表（`data/enemies.ts`，全部 5 種）

| key | 字 | `hpMul` | `def` | `speed` | `flying` | `bounty` | `damage` | `troop` | 特性 |
|---|---|---|---|---|---|---|---|---|---|
| `thief` | 賊 | 1 | 0 | 0.95 | – | 2 | 1 | 步 | 基本雜兵，第 1 波就有 |
| `shield` | 盾 | 1.9 | 45 | 0.7 | – | 4 | 1 | 步 | 高防（`mitigate` 只留 57% 傷害），怕貫穿與灼燒 |
| `swift` | 快 | 0.55 | 0 | 2.1 | – | 2 | 1 | 騎 | 移速 2 倍以上，血薄 |
| `flyer` | 飛 | 0.9 | 10 | 1.35 | ✔ | 4 | 1 | 弓 | 只有 `baseRange >= ANTI_AIR_RANGE`(2.0) 的單位打得到 |
| `boss` | 將 | 14 | 60 | 0.6 | – | 20 | **2** | 騎 | `ccImmune`：免疫定身與擊退（減速／易傷／灼燒仍有效） |

相剋（`combat.ts:32-38`，三向 騎→弓→步→騎，克制 ×1.25 / 被克 ×0.75）：

- 打 `thief`／`shield`（步）→ **弓系有利**、騎系不利
- 打 `swift`（騎）→ **步系有利**、弓系不利
- 打 `flyer`（弓）→ **騎系有利**、步系不利；另外弓 tag 對飛行還有 ×1.5（`combat.ts:104`）
- 打 `boss`（騎）→ **步系有利**

`def` 只影響 `dealDamage`（走 `mitigate`）；**灼燒／中毒走 `damageEnemy` 純扣血、完全無視 `def`**——
這就是「盾賊怕灼燒」的機制原因（`combat.ts:150-174` vs `combat.ts:176-205`，詳見 `04-combat-and-skills.md`）。

### 經濟公式（全部在 `economy.ts`）

| 項目 | 公式 | 位置 |
|---|---|---|
| 征兵花費 | `max(1, round((8 + ⌊wave×1.6⌋ + 2×recruitsThisWave) × costMul))` | `economy.ts:10-13` |
| 每波固定收入 | `5 + ⌊wave×1.2⌋`，再 ×`incomeMul` | `economy.ts:16`／`step.ts:151` |
| 場上產糧 | Σ`u.income`（跳過已組將的字牌），四捨五入 | `economy.ts:24-31` |
| 擊殺賞金 | `round(e.bounty × bountyMul)` | `combat.ts:157` |
| 熔爐重抽 | `max(1, round((4 + ⌊wave/2⌋) × costMul))` | `economy.ts:101-103` |
| 熔爐分解 | 前 3 次 `atk×0.2`，之後 `smeltRefund = atk×0.12` | `actions.ts:122-127`／`economy.ts:96` |
| 鏟除退款 | `(baseAtk×0.35 + income×0.5) × SELL_RATIO`（字牌 1.0、已組將 0.3） | `actions.ts:236-237`／`economy.ts:106` |
| 提前開戰獎勵 | `round(prepTimer × 0.5)` 糧 | `actions.ts:290` |

關鍵設計點：**一次征兵費用固定，但會填滿所有空手牌格**（`actions.ts:45-52`）——
手牌越大（兵書可到 8）每次征兵越划算，這是兵書 `handSize` 的真實價值所在。
`recruitsThisWave` 在 `checkWaveEnd`（`step.ts:170`）歸零，所以「同一波連續征兵」會越來越貴，跨波則重置。

### 抽字權重（`rollGlyph`，`economy.ts:76-85`）

```
weight = rarityWeights(wave)[g.rarity - 1]
       × (familiar.has(char) ? FAMILIAR_BOOST(3) × familiarBoostMul : 1)
       × (wishes.includes(char) ? WISH_BOOST(5) : 1)
```

`RARITY_TABLE`（`economy.ts:41-46`）是 **module-private**，公開介面只有 `rarityWeights(wave)`：

| 波次 | rarity1 | rarity2 | rarity3 | rarity4 |
|---|---|---|---|---|
| ≤5 | 70 | 25 | 5 | 0 |
| ≤12 | 50 | 32 | 15 | 3 |
| ≤20 | 35 | 33 | 24 | 8 |
| 其後 | 25 | 30 | 30 | 15 |

每列合計 100（`__tests__/core.test.ts:99` 有測試把關）。字表的稀有度分布：rarity1=5、rarity2=29（含 20 個姓氏）、rarity3=37（含 27 個名字）。
波次越後面越容易抽到姓名字，所以「後期才有機會湊神將」是這張表在推動的。

**`rarity: 4` 是死欄位**：沒有任何字是 rarity 4，`w[3]` 永遠不會被讀到。
第 4 欄留著是為了將來加「傳說級單字」，在那之前**調它一點效果都沒有**（`economy.ts:37-39`）。

### 字池的三分法（`pool.ts`）

| 集合 | 內容 | 數量 | 行為 |
|---|---|---|---|
| `ALWAYS` | `category` 為 `weapon` + `troop` | 13 | **永遠在池內**。骨幹，也是「○兵」部隊配方的來源 |
| `SUPPORT` | `strategy` + `economy` | 11 | 抽 `level.pool.support` 個（2～7） |
| `NAMED_RECIPES` | 配方字**全部**是 `surname`／`given` 的武將 | 26 | 抽 `level.pool.generals` 組（3～9），**整組配方的字一起加入** |

`NAMED_RECIPES` 的過濾條件在 `pool.ts:51-56`（逐字查 `GLYPHS` 的 category），所以「○兵」12 支部隊、
`火計`／`毒計`／`雷陣`／`風令`／`屯田` 這 5 個非姓名配方**不參與抽樣**——它們的材料本來就在 `ALWAYS`／`SUPPORT` 裡。

**為什麼要成組加入**：如果逐字抽，池子裡會出現「張」但沒有「飛」的孤兒字——玩家永遠湊不成那個武將，
抽到就只是廢牌。成組加入保證池裡每個姓名字都至少屬於一個可完成的配方，同時池子變小也讓同一個字更容易重複抽到（利於疊階）。
`finish()`（`pool.ts:96-99`）反算「本局可湊出哪些武將」寫進 `poolGenerals` 給 UI 顯示。

### 編隊模式（`buildLoadoutPool`，`pool.ts:75-93`）

`meta.loadoutActive` 為真時，`createGame`（`state.ts:105-108`）傳入 `LoadoutConfig`，
`buildGlyphPool` **第一行就 return，完全跳過隨機抽樣**（`pool.ts:59`）。組成規則：

```
選中的字  ∪  選中武將的配方字  ∪  所有「還沒解鎖過」的字（不受編隊限制，留著讓玩家探索）
```

`seenGlyphs` 是解鎖名單；**已解鎖但沒被選進編隊的字會被排除**，這是編隊能收窄池子的唯一機制。
一旦玩家解鎖全部 71 字，池子就完全等於玩家的選擇。

防呆只有一層：池子為空時退回 `ALWAYS`（`pool.ts:90`），避免 `rollGlyph` 在空 `candidates` 上壞掉。
**刻意不防「沒有攻擊單位」**——只選經濟／光環字（糧田屯商陣令）會開出一局打不動任何敵人的對局。
這是設計決定，編隊沒有安全網（`pool.ts:84-89`，另見 `05-meta.md`）。

## 主要流程

### `stepGame` 的完整執行順序（`step.ts:15-38`）

| # | 行 | 步驟 | 為什麼在這個位置 |
|---|---|---|---|
| 0 | 16 | `phase === 'won' \|\| 'lost'` → **return** | 遊戲結束後整棵 state 凍結，包含 `state.time` |
| 1 | 17 | `state.time += dt` | 在 prep 分支之前 → 佈陣階段時間也在走 |
| 2 | 19-24 | **prep 分支**：`prepTimer -= dt`；≤0 → `beginBattle(state)`；`stepEffects`；**return** | 佈陣期只跑特效衰減。`beginBattle`（`actions.ts:296-301`）設 `phase='battle'`、`waveTime=0`、**`spawnQueue = buildWave(...)`（消耗 rng）**。當幀立刻 return，所以第一隻敵人在下一幀才生成 |
| 3 | 26 | `state.waveTime += dt` | 生成時刻的唯一時間基準（不是 `state.time`） |
| 4 | 27 | 所有單位 `atkFlash -= dt` | 純視覺；刻意只在戰鬥階段衰減 |
| 5 | 28 | `spawnDue` | **最前面**：新生成的敵人當幀就吃狀態、會移動、會被打，不空轉一幀 |
| 6 | 29 | `stepStatuses` | **必須在 `moveEnemies` 之前**：定身／減速倒數與 `moveEnemies` 的讀取同幀一致，`stun` 才能當幀生效；灼燒傷害也先結算，被燒死的敵人不會再被索敵 |
| 7 | 30 | `moveEnemies` | 敵人先移動再讓塔索敵 → 射程判定用的是**當幀最新位置**，不是上一幀的殘影 |
| 8 | 31 | `stepCombat` | 見 `04-combat-and-skills.md` |
| 9 | 32 | `stepSkills` | 武將主動技在普攻之後 → 技能看到的是本幀扣血後的血量（狙擊類技能選目標才正確） |
| 10 | 33 | `stepBondSkills` | 羈絆組合技排在單體技之後 |
| 11 | 34 | `stepMeteor` | 局外道具的傷害源，最後補刀 |
| 12 | 35 | `stepEffects` | 特效壽命衰減，放在所有 `pushEffect` 之後，新特效才有完整一幀壽命 |
| 13 | 36 | `cleanupDead` | 移除 `hp <= 0`（含漏過的敵人，它們被設成 `hp = 0`） |
| 14 | 37 | `checkWaveEnd` | **必須在 `cleanupDead` 之後**：條件是 `spawnQueue.length === 0 && enemies.length === 0`，屍體沒清掉波次永遠不會結束 |

### `checkWaveEnd`（`step.ts:147-173`）的結算順序

```
1. 若 spawnQueue 或 enemies 非空 → 直接 return
2. lastIncome = { base: waveIncome(wave) × incomeMul, units: unitIncome(state) }（供 UI 顯示）
3. food += base + units
4. wave >= maxWave → phase='won'、emit('won')、return   ← 通關那一波不觸發回血
5. 杏林春暖：wave % healEveryWaves === 0 且 lives < maxLives → lives+1（用**遞增前**的 wave 判定）
6. emit('waveClear')、wave++、recruitsThisWave=0、phase='prep'、prepTimer=PREP_SECONDS
```

### `moveEnemies`（`step.ts:115-139`）的漏怪處理

```
dist += speed × (slow>0 ? SLOW_FACTOR(0.5) : 1) × perks.enemySpeedMul × dt
dist >= path.length-1 → hp=0（交給 cleanupDead）、stats.leaks++、emit('leak')
                      → rng() >= leakBlockChance 時才 lives -= e.damage
                      → lives <= 0 → phase='lost'、emit('lost')
```

回魂旗擋下時**仍計 `stats.leaks`**，只是不扣命。

### `stepMeteor`（`step.ts:44-68`）

`perks.meteorInterval <= 0` 直接 return（未購買時零成本）。倒數 `meteorTimer` 初值＝間隔（`state.ts:148`），
歸零時用 `+=` 補回間隔（不是重設）以避免長期漂移。目標是 `dist` 最大（最前方）那隻，
對其周圍 **1.5 格**內全體造成 `0.7 × enemyBaseHp(wave) × hpMul` 傷害，並施加 3 秒、dps 為傷害 12% 的灼燒。

**傷害為什麼綁 `enemyBaseHp(wave)`**：血量是指數成長的，任何寫死的固定傷害在 10 波後就等於 0。
綁上去之後，這一發永遠等於「一隻該波雜兵的 70% 血量」，前後期威力感一致。
`hpMul` 也要乘，否則高難度關卡的相對威力會被 `level.hpMul` 稀釋。

## 契約與陷阱

1. **模擬固定 1/60 步長**。`stepGame` 的 `dt` 一律是 `FIXED_DT`（`core/loop.ts:5`），由 `core/loop.ts:32-36` 的累加器驅動。
   **`sim/` 內不可讀 `performance.now()`／`Date.now()`**（只有 `core/loop.ts` 可以）——否則 `npm run sim` 與單元測試（都是直接 for 迴圈呼叫 `stepGame`）會失真。
   另外掉幀保護會丟棄累加器（`loop.ts:37`），所以 `sim/` 也不可假設真實時間連續。

2. **`buildWave` 會消耗 `rng`，每波恰好 `enemyCount(wave)` 抽（BOSS 不抽）**（`waves.ts:44-48`）。
   ⚠ **要做「波次預覽」時不可以直接呼叫 `buildWave(state.wave + 1, state.rng)`**——那會讓整條亂數流位移，
   破壞同種子重現性，並讓 `npm run sim` 的難度數字與實際遊戲不一致。正確做法二選一：
   - 在 `createGame` 時就把整局 `maxWave` 波預先算好存進 state（順序與現在一致，行為完全不變）；
   - 或給預覽用一條獨立的 rng（`mulberry32(seed ^ wave)`），與 `state.rng` 完全隔離。
   擴充方向見 `06-roadmap.md`。

3. **其他「無條件消耗 rng」的地方**（改動時要意識到自己在移動亂數流）：
   - `recruit` 每張牌 2 抽：`rollGlyph` 1 抽 + 精兵符判定 1 抽，**即使 `recruitEliteChance` 是 0 也會抽**（`actions.ts:47,49`）。
   - `moveEnemies` 每次漏怪 1 抽，**即使 `leakBlockChance` 是 0 也會抽**（`step.ts:129`）。
   - 對照組：爆擊判定用 `critChance > 0 &&` 短路，中性值時**不**消耗（`combat.ts:187`）。這個不一致是既有行為，改任何一邊都會讓所有既有種子的對局內容改變。

4. **編隊模式一次都不消耗 rng**（`pool.ts:59` 直接 return），隨機模式則消耗 `support + generals` 抽。
   所以**同一顆種子在「有／沒有啟用編隊」下不是同一場對局**（`pool.ts:13-16`）。這不違反重現性，但回報 bug 時必須連 meta 一起說。

5. **已成為武將成員的字牌不重複計算**。同一條規則散落**三處**，任何新增的「逐單位聚合」都要跳過 `u.kind === 'glyph' && u.formIds.length > 0`，
   否則會**靜默地**重複計算（沒有測試會抓到）：
   - 產糧：`src/sim/economy.ts:27`
   - 攻擊：`src/sim/combat.ts:244`
   - 光環投射：`src/sim/state.ts:379`

   第四個聚合（例如「全場攻擊力總和」的 UI、或新的每波結算項目）必須自己加上同樣的判斷。

6. **`composition()` 在第 7 波後不再加入新敵種**（`waves.ts:29-35`）。目前只有 5 種敵人（含 BOSS），
   `wave >= 7` 之後池子固定是 `thief/swift/shield/flyer` 四種、**均勻機率各 25%**。
   巨鹿 30 波裡第 7～30 波（24 波）的敵種組成完全相同，只有數量、血量與每 5 波的 BOSS 在變。
   這是已知的內容失衡（後期缺乏質變），擴充方向見 `06-roadmap.md`。`composition` 是 module-private，
   新增敵種必須**同時**改 `data/enemies.ts` 與這個函式，只加資料表不會有任何效果。

7. **`rarity: 4` 目前是死的**（見上）。`RARITY_TABLE` 是 module-private，外部一律用 `rarityWeights()`。

8. **`level.hpMul` 只在兩個地方被乘**：`buildWave`（`waves.ts:39`）與 `stepMeteor`（`step.ts:55`）。
   `enemyBaseHp()` 本身**不含** `hpMul`——新增任何「跟著波次成長」的傷害或血量時要記得自己乘。

9. **`rollGlyph` 的 pool 過濾是 `ctx.pool.includes(g.char)`**（`economy.ts:78`）：
   池子裡出現不在 `GLYPHS` 的字會被**靜默忽略**；`ctx.pool` 為空陣列時退回全表（`?.length` 的短路）。
   `pickWeighted` 在總權重為 0 時會回傳第一個候選（`core/rng.ts:19-24`），不會拋錯——新增 rarity 時別讓某一波的所有權重同時為 0。

10. **perks 的介入點清單**（`Perks` 定義在 `types.ts:297`，由 `data/shop.ts` 的 `perksFrom()` 推導，`createGame` 注入一次、整局固定）。
    本模組只碰這幾個，其餘（`atkMul`／`apsMul`／`critChance`／`splashMul`／`bountyMul`／`rangeMul`／`cdMul`）在 combat／state 那一層：

    | perk | 介入點 | 中性值 |
    |---|---|---|
    | `costMul` | `recruitCost`（`economy.ts:12`）、`rerollCost`（`economy.ts:102`） | 1 |
    | `familiarBoostMul` | `rollGlyph`（`economy.ts:81`），與 `FAMILIAR_BOOST` 相乘 | 1 |
    | `recruitEliteChance` | `recruit`（`actions.ts:49`） | 0 |
    | `incomeMul` | `checkWaveEnd`（`step.ts:151`），**只影響固定收入、不影響產糧** | 1 |
    | `healEveryWaves` | `checkWaveEnd`（`step.ts:162-167`） | 0 |
    | `enemySpeedMul` | `moveEnemies`（`step.ts:122`） | 1 |
    | `leakBlockChance` | `moveEnemies`（`step.ts:129`） | 0 |
    | `meteorInterval` | `stepMeteor`（`step.ts:45-48`） | 0 |
    | `extraLives` | `createGame`（`state.ts:129-130`） | 0 |

    **新增 perk 的鐵則**：中性值必須讓行為與「沒有這個 perk」逐位元相同（倍率 1／機率 0／間隔 0），
    否則 `npm run sim` 的難度基準與所有既有種子都會漂移。

11. **`sim/` 不得 import render/ui/input/DOM**（`step.ts:3` 的註解就是在講這件事）。
    音效與粒子一律用 `emit(state, ...)` 推事件（`step.ts:65,127,133,168`），由 app 層每幀 drain；
    `pushEffect` 是 sim 內的視覺佇列，有 240 上限保護（`combat.ts:236`）。

12. **規格書落差**：`docs/game-design.md` 提到的「妖道」敵人**不存在於程式中**。
    `data/enemies.ts` 就是唯一真相，只有 5 種敵人。要加就照第 6 點的兩處一起改。

13. `checkWaveEnd` 的通關判定在回血之前（`step.ts:155-159`），所以**通關那一波不會觸發杏林春暖**；
    回血用的是遞增**前**的 `state.wave`。改這段時注意別把 `wave++` 移到前面。

## 我想改 X → 動哪裡

| 想改什麼 | 動哪裡 | 注意 |
|---|---|---|
| 整體難度（後期太硬／太軟） | `HP_GROWTH`（`waves.ts:13`） | 指數項，動 0.01 就很有感。改完跑 `npm run sim` 六關，並更新 `waves.ts:9-12` 的歷史註解與 CLAUDE.md 的中位數 |
| 前期難度 | `BASE_HP`（`waves.ts:7`）或 `level.startFood`／`lives` | `BASE_HP` 是線性項，前期影響大、後期被指數吃掉 |
| 單關難度 | `data/levels/index.ts` 的 `hpMul`／`maxWave`／`lives` | 只影響一關，是最安全的旋鈕 |
| 敵人數量／出怪節奏 | `enemyCount`（`waves.ts:20`）、`gap`（`waves.ts:42`） | `gap` 是區域變數；縮小它會同時縮短整波長度與玩家的反應窗口 |
| BOSS 頻率／強度 | `isBossWave`（`waves.ts:24`）、`boss.hpMul`（`enemies.ts:12`） | BOSS `hpMul` 14 是雜兵的 14 倍，且 `ccImmune` |
| 新增敵種 | `data/enemies.ts` 的 `ENEMIES` **＋** `composition()`（`waves.ts:29-35`） | 只加資料表不會生成。`troop` 決定相剋，`flying` 需要 `baseRange >= 2` 才打得到 |
| 對空門檻 | `ANTI_AIR_RANGE`（`enemies.ts:20`） | 比對的是 `u.baseRange`（未乘 `RANGE_MUL`），刻意如此（`combat.ts:96-101`） |
| 征兵／重抽花費 | `economy.ts:10-13`、`economy.ts:101-103` | 一次征兵填滿所有空格，改花費等於改「手牌大小的價值」 |
| 每波收入／產糧 | `waveIncome`（`economy.ts:16`）、字表的 `income`（`data/glyphs.ts`）、`屯田` 的 `income`（`generals.ts:79`） | 經濟字產出是 `income × 品質階級`（線性，`state.ts:206`），不是指數 |
| 抽卡稀有度曲線 | `RARITY_TABLE`（`economy.ts:41-46`） | 每列合計必須是 100（有測試）。第 4 欄無效 |
| 抽卡收斂強度 | `FAMILIAR_BOOST`（`economy.ts:57`）、`WISH_BOOST`（`economy.ts:63`） | 兩者相乘。調高會讓對局更容易滾雪球 |
| 每局字池大小 | `data/levels/index.ts` 的 `pool: { support, generals }` | `generals` 是「幾組配方」，不是幾個字（一組 2～3 字） |
| 哪些字永遠在池內 | `ALWAYS`／`SUPPORT`（`pool.ts:48-49`），改的是 `category` 的分類 | 新增 `category` 時要同時檢查這兩行與 `NAMED_RECIPES` 的判斷 |
| 編隊行為 | `buildLoadoutPool`（`pool.ts:75-93`）、`data/loadout.ts` | 別加「保證有攻擊單位」的安全網（刻意的設計決定，見 `pool.ts:84-89`） |
| 佈陣秒數 | `PREP_SECONDS`（`waves.ts:14`） | 同時影響 `createGame` 初值與每波結算 |
| 在主迴圈插入新步驟 | `stepGame`（`step.ts:26-37`） | 對照上面的順序表挑位置：讀敵人狀態的放 `stepStatuses` 之後、`cleanupDead` 之前；`cleanupDead` 之後看不到本幀死亡與漏過的敵人 |
| 波次預覽／關卡地圖預告 | **不要**直接呼叫 `buildWave` | 見陷阱 2 的兩種正確做法 |
| 新增局外被動 | `data/shop.ts` 的 `SHOP` + `NEUTRAL_PERKS` + `types.ts` 的 `Perks`，再在本模組的介入點讀取 | 中性值必須零影響（陷阱 10） |

## 相關頁面

- `04-combat-and-skills.md` — 索敵、`dealDamage`／`damageEnemy` 的差別、相剋與控場、主動技與組合技
- `05-meta.md` — 兵書、商城（`Perks` 的來源）、編隊 UI、聲望與圖鑑
- `06-roadmap.md` — 波次預覽、敵種擴充等未實作方向
- `../01-architecture.md` — 分層與依賴方向、字牌與武將的關係
- `../02-data-tables.md` — 字表／配方表／敵表的欄位語意與平衡基準
- `../04-invariants.md` — 七條不可違反的規則全文與已知陷阱總表
