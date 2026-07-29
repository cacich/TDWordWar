# 戰鬥、技能與羈絆（`sim/combat.ts` · `sim/skills.ts` · `sim/bonds.ts` · `data/bonds.ts`）

> **負責檔案**
>
> | 檔案 | 規模 | 職責 |
> |---|---|---|
> | `src/sim/combat.ts` | 348 行 | 索敵、射程、傷害公式、控場狀態與三種免疫、特效佇列（`stepCombat` / `stepEffects`） |
> | `src/sim/skills.ts` | 384 行 | 9 個技能原型、`SKILLS`（30 個主動技）、`stepSkills`、`COMBOS`（5 個組合技）、`bondMembers` |
> | `src/sim/bonds.ts` | 82 行 | `computeBonds`（倍率彙總，由 `recalcUnits` 呼叫）、`stepBondSkills`（每 tick） |
> | `src/data/bonds.ts` | 96 行 | `BONDS` 資料表：13 個羈絆的條件、倍率、組合技宣告 |
>
> **上游依賴**：`sim/board.ts`（`cellCenter`）、`sim/events.ts`（`emit`）、`sim/types.ts`、`data/enemies.ts`（`ANTI_AIR_RANGE`）。
> 這四個檔案**不 import** render/ui/input——這是專案最硬的架構約束（見 [../04-invariants.md](../04-invariants.md) #1）。
>
> **下游使用者**：
> - `sim/step.ts:32-34` 每 tick 依序呼叫 `stepCombat` → `stepSkills` → `stepBondSkills`
> - `sim/state.ts:375` 用 `effectiveRange()` 寫 `Unit.range`；`state.ts:365` 用 `computeBonds()`；`state.ts:304,397` 用 `SKILLS[]` 判斷「技能有沒有實作」
> - `render/renderer.ts:7` 借用 `enemyPos` / `unitCenter` 定位（唯讀）
> - `ui/screens.ts:15` 借用 `COMBOS` 在圖鑑標示「組合技已實作」
> - `tools/autobalance.ts`（`npm run sim`）整條鏈都要能在 Node 裡跑

## 這個模組解決什麼問題

把「誰打得到誰、打多痛、附加什麼狀態」收斂成**兩個傷害入口**與**一條射程公式**，
再把主動技／組合技做成**無排程器的立即結算純函式**，好處是整個戰鬥層可以在 Node 中以固定步長重播。

## 核心概念

### 1. 傷害只有兩個入口

| 入口 | 位置 | 會套用 | 什麼時候用 |
|---|---|---|---|
| `dealDamage(state, u, e, raw, applyOnHit = true)` | `combat.ts:177` | 對空 1.5×（`airBonus`，需 `弓` tag）→ 兵種相剋（`counterMul`）→ 易傷 `VULN_MUL` → 爆擊 `perks.crit*` → `mitigate()` → `u.onHit` | **有施放者**的攻擊與技能。預設路徑 |
| `damageEnemy(state, e, dmg)` | `combat.ts:151` | 只扣血 + 死亡結算（給糧 `bounty × perks.bountyMul`、`stats.kills`、`emit('kill')`、飄字） | **沒有施放者**的持續／環境傷害：灼燒（`step.ts:142`）、流星火雨（`step.ts:60`） |

- `dealDamage` **必經** `damageEnemy`，所以擊殺獎勵只寫在一個地方；灼燒擊死也會給糧（`m3.test.ts:114`）。
- 傳給 `damageEnemy` 的數字是**最終傷害**，不再過 `mitigate()`。組合技要「無施放者但仍吃防禦」時用
  `skills.ts:63` 的 `flatDamage()`（= `damageEnemy(mitigate(raw, def))`）。
- `applyOnHit = false` 用來避免二次施加狀態：連鎖雷（`combat.ts:293`）與 `crowd` 原型（`skills.ts:92`）都靠它，
  否則 chain 會遞歸鋪狀態、`crowd` 會把 onHit 疊兩次。

`mitigate(atk, def) = max(1, atk × (1 − def/(def + DEF_K)))`，`DEF_K = 60`（`combat.ts:14,27`）。
遞減但永不歸零，所以高防 BOSS 不會讓弱塔完全無效。

### 2. ★ 射程的完整疊乘鏈（最容易誤讀的地方）

`effectiveRange()`（`combat.ts:67-82`）：

```
baseRange <= 0                → 0（光環／經濟字不攻擊，直接短路）
r  = baseRange × RANGE_MUL(2)
r ×= kind === 'general' ? GENERAL_RANGE_BONUS(1.25) : GLYPH_RANGE_MUL(0.8)   ← 兩者互斥，不會同時乘
r += maxOff                  （cells.length > 1 時：中心到最遠成員格的距離）
```

再由 `recalcUnits`（`state.ts:374`）乘上局外道具 `perks.rangeMul`（精工兵器）寫進 `Unit.range`。

**⚠ 資料表裡的 `range` 不是實戰值**，差距 1.6～2.5 倍以上：

| 例子 | 表上 `range` | 實戰 `Unit.range` |
|---|---|---|
| 單字「刀」 | 1.2 | 1.2 × 2 × 0.8 = **1.92**（×1.6） |
| 單字「弓」 | 3.5 | 3.5 × 2 × 0.8 = **5.6**（×1.6） |
| 武將「弓兵」（兩格） | 1.5 | 1.5 × 2 × 1.25 + 0.5 = **4.25**（×2.83） |

規格書 `docs/game-design.md` 與早期文件長期只寫「表上的值」，看到「射程 1.2」不要以為只能打隔壁格。
要改射程手感，**優先動 `RANGE_MUL` / `GLYPH_RANGE_MUL` / `GENERAL_RANGE_BONUS` 三個常數，不要逐筆改資料表**。
`range.test.ts` 把這條公式逐項鎖住（單字、武將加成、直立＝橫向、對空資格）。

### 3. 多格單位的中心外移補償（為什麼要 `+= maxOff`）

`unitCenter()`（`combat.ts:49`）取所有 `cells` 的平均。直立合成的兩格武將，中心落在兩格之間，
比「最靠近路徑的那一格」遠了半格——若不補償，直立武將的有效覆蓋會比橫向的小，
玩家會發現「同一個武將換個方向組就打不到怪」。加回 `maxOff` 等同於**從最靠近敵人的成員格量起**，
方向就不再影響手感（`range.test.ts:38-54` 是這件事的守護測試）。

副作用：技能半徑也跟著長（`radiusOf` 讀的是 `u.range`），這是刻意接受的。

### 4. 對空資格看 `baseRange`，不看實效射程

```ts
// combat.ts:96-101
export function canHit(u: Unit, e: Enemy): boolean {
  if (!e.flying) return true
  return u.baseRange >= ANTI_AIR_RANGE   // ANTI_AIR_RANGE = 2.0（data/enemies.ts:168）
}
```

**條件是 `baseRange >= 2.0`**（`>=`，不是 `<`）。舊文件（`02-data-tables.md` 的 `range` 欄位說明）把不等號方向寫成
「`< 2.0` 才有對空資格」，是錯的。

設計原因：射程一旦被 `RANGE_MUL` 或 `perks.rangeMul` 放大，近戰單位的實效半徑也會超過 2.0；
若用實效射程判定，「刀」就會變成能打飛行 → 弓系「唯一對空」的定位崩掉。所以對空是**射程等級（資質）**問題，不是距離問題。
`airBonus`（`combat.ts:104`）的 1.5 倍對空加成則另外只看 `弓` tag。

### 5. 索敵與攻擊型態

- `pickTarget`（`combat.ts:122`）：先過 `canHit` 與 `dist > u.range`，再依 `u.targeting` 取極大值分數
  （`front` → `e.dist` 最大／`near` → 距離最近／`strong` → `hp` 最高）。
- 障礙**不阻擋射線**（設計決定 #2，`combat.ts:3`）：只算歐氏距離，沒有視線判定。
- `shape`（`combat.ts:283-337`）：`single`（可帶 `onHit.chain`，附近 1.8 內額外 chain 個目標、傷害 60%）／
  `pierce`（`|e.dist − target.dist| <= 1.3`，最多 3 名）／`splash`（命中點 1.3 格內全體）。
  後兩者傷害額外乘 `perks.splashMul`（烽火連城），且**每個命中目標都會吃到 onHit**。
- 已組成武將的字牌**跳過攻擊**（`combat.ts:250`）——由武將那一層代表出手，否則傷害雙算。

### 6. 控場狀態與三種免疫

狀態存在 `Enemy` 上，全部是「剩餘秒數」（`types.ts:242-248`），由 `step.ts:133-146` 的 `stepStatuses` 倒數，
`applyStatus`（`combat.ts:214-238`）一律用 `Math.max` 覆寫（**取較長者，不累加**）。

免疫**不是**一個開關而是三個獨立欄位，各自擋掉不同的東西（`Enemy` 的 `ccImmune`／`burnImmune`／`slowImmune`，
`types.ts:237-239`）：

| 狀態 | 欄位 | 生效處 | 被誰擋掉 |
|---|---|---|---|
| 減速（固定 50%，`SLOW_FACTOR`） | `slow` | `step.ts:153` | **`slowImmune`**（`combat.ts:215`） |
| 灼燒（每秒 `baseAtk × burn.mul`） | `burnT` / `burnDps` | `step.ts:140-144` → `damageEnemy` | **`burnImmune`**（`combat.ts:217`） |
| 易傷（`VULN_MUL = 1.3`） | `vuln` | `dealDamage`（`combat.ts:185`） | **沒有任何免疫擋得住**（`combat.ts:216`） |
| 定身 | `stun` | `step.ts:152`（不前進） | `ccImmune`（`combat.ts:221-222`） |
| 擊退（`dist -= knock`） | `dist` | `combat.ts:223` | `ccImmune`（連特效環也不畫，`combat.ts:225`） |
| 連鎖 | — | `stepCombat` 內即時處理，不是狀態 | — |

三個免疫在敵表裡的分佈很稀疏（`data/enemies.ts`）：`ccImmune` 是全部 12 隻 BOSS 都有，
`slowImmune` 只有疾風賊／疾風將／影將，`burnImmune` 只有鐵甲將與影將。**易傷刻意不可免疫**——
否則控場流會完全失去對 BOSS 的作用，只剩純傷害流一條路可走。

⚠ 免疫是在 `makeEnemy` 從 `EnemyDef` **複製**進 `Enemy` 的（`step.ts:86-88`），不是每次回查敵表。
新增一種免疫要**同時**改三處：`types.ts` 的 `EnemyDef`、`types.ts` 的 `Enemy`、`step.ts` 的 `makeEnemy`。
漏掉 `makeEnemy` 那一行會**靜默失效**（欄位是 `undefined`，`!e.xxxImmune` 恆為真）。

⚠ 另一個繞過點：`stepMeteor` 直接寫 `e.burnT` / `e.burnDps`（`step.ts:62-63`），**沒有經過 `applyStatus`，
所以無視 `burnImmune`**。這是目前唯一燒得到鐵甲將／影將的來源，屬於既有行為。

### 7. 技能是立即結算的純函式，沒有排程器

`SkillFn = (state, u) => boolean`（`skills.ts:26`）。一次呼叫就把所有傷害／狀態算完，**回傳有沒有真的施放**。
多段技（呂布無雙）用「一次結算總傷害 + 特效畫三次」表示（`burst` 的 `repeat` 參數**只影響特效段數**，`skills.ts:80`）。

為什麼不做排程器：
1. `npm run sim` 與單元測試都是把 `stepGame` 硬跑幾千次，任何「跨 tick 的施法狀態」都得序列化與重播，成本高；
2. 字牌隨時可能被鏟除或拖走（武將會即時解除），施法中的單位會變成懸空引用。立即結算讓這兩個問題自動消失。

### 8. 9 個技能原型（`skills.ts:67-227`）

| 原型 | 簽名 | 目標範圍 | 回傳 false 的條件 |
|---|---|---|---|
| `burst` | `(mul, extra, onHit?, repeat=1)` | `radiusOf(u, extra)` 內全部 | 半徑內沒敵人 |
| `crowd` | `(onHit, extra, mul=0.4)` | 同上，傷害低、**不觸發 u.onHit** | 半徑內沒敵人 |
| `lineStrike` | `(mul, len, onHit?)` | 以射程內最前方敵人為錨，路徑上 `[head.dist − len, head.dist + 0.5]` | 射程內沒敵人 |
| `charge` | `(mul, onHit?, count=8)` | **無視射程**，`dist` 排序取最前 `count` 名 | 全場沒敵人 |
| `snipe` | `(mul)` | 全場 `hp` 最高 1 名 | 全場沒敵人 |
| `global` | `(mul, onHit?)` | **全場**（不看射程也不看位置） | 全場沒敵人 |
| `healLife` | `(n)` | 玩家生命 | `lives >= maxLives`（`m3.test.ts:201`） |
| `gainFood` | `(base, perWave=0.6)` | 糧食 `round(base + wave × perWave)` | 永不失敗 |
| `burstAndFood` | `(mul, extra, food)` | `burst` 命中才徵糧（曹操） | `burst` 沒命中 |

共同細節：
- `mul` 一律乘 `u.atk`（**實效攻擊力**，已含羈絆／光環／perks），所以技能會隨構築一起變強。
- `radiusOf(u, extra) = max(u.range, 1.5) + extra`（`skills.ts:29`）——`max` 是給近戰武將的地板。
- `canHit` 在每個原型裡都過一次：**近戰武將的技能同樣打不到飛行**。
- **新增技能時優先組合現有原型**（`burstAndFood` 就是 `burst` + `gainFood` 的組合示範）。
  新增原型會讓「技能行為的可能性空間」變大、平衡難以推理，除非真的做不到才加。

### 9. 註冊表機制：`SKILLS[武將名]` / `COMBOS[羈絆名]`

資料表只**宣告**文字與冷卻（`GeneralDef.skill`、`BondDef.comboSkill`），行為在 `skills.ts` **註冊**。

- 沒註冊 → `state.ts:303,397` 讓 `skillCdMax = 0` → `stepSkills` 直接 `continue`，**技能永遠不觸發，但圖鑑／面板仍顯示描述文字**（安靜失效）。
- 鍵是字串（含全形漢字），打錯不會報錯。`core.test.ts:58-77` 有三道守護：
  `SKILLS` 的鍵必須是存在的武將名、有實作的必須也宣告 `skill`、`COMBOS` 的鍵必須是有 `comboSkill` 的羈絆。**別刪這些測試。**

### 10. 施放失敗不重設冷卻

`stepSkills`（`skills.ts:272-289`）：只有 `fn(state, u)` 回傳 `true` 才 `skillCd = skillCdMax`。
沒有目標時不該浪費一整輪冷卻——否則「敵人剛出場就被技能空放清掉」會讓玩家覺得技能不受控。
同一哲學也在攻擊上：`stepCombat` 找不到目標時把 `u.cd = 0`（`combat.ts:257`），下一 tick 立刻可打。

**寫新技能忘記回傳 `false`** 就會變成「技能一直對空氣施放」，而且不會有任何錯誤訊息。

### 11. 羈絆：條件、倍率、組合技

`computeBonds`（`bonds.ts:21`）只看 `kind === 'general'` 的單位，字牌不算。條件兩種（可並存，都要滿足）：

| 條件 | 判定 | 例 |
|---|---|---|
| `requireGenerals: string[]` | 指定武將**全部**在場（`bonds.ts:39`） | 桃園結義＝劉備＋關羽＋張飛 |
| `requireTag: { tag, count }` | 帶該 tag 的武將**數量 >= count**（`bonds.ts:40`） | 西涼鐵騎＝2 名「馬」姓 |

效果 `atkMul` / `apsMul` / `cdMul` 是**全域**的（套在場上所有單位，包含沒參與羈絆的字牌），
多個羈絆**相乘**（`bonds.ts:41-43`）。`state.cdMul = bonds.cdMul × perks.cdMul`（`state.ts:368`）。

組合技（`stepBondSkills`，`bonds.ts:68`）：
- 羈絆不成立 → `delete state.bondCds[name]`，**重新湊齊要重新等冷卻**。
- 剛湊齊時給 `min(4, cdMax)` 的短冷卻，讓玩家馬上看到一次（`bonds.ts:79`）。
- 傷害以 `sumAtk(members)`（**參與武將的實效攻擊力總和**，`skills.ts:294`）為基準 →
  越晚湊齊、武將等級越高，組合技越痛。這是後期構築的主要爆發來源。
- 組合技沒有施放者，走 `flatDamage()`：**不吃相剋、不吃對空加成、不吃易傷、不會爆擊**，只過 `mitigate`。

## 主要流程

```
core/loop.ts（固定 1/60）
└─ step.ts:15 stepGame
   ├─ spawnDue          依 spawnQueue 生成敵人（makeEnemy 複製三種免疫）
   ├─ stepStatuses      減速/定身/易傷倒數；灼燒 → damageEnemy（純扣血）
   ├─ stepEnemySupport  敵方回血光環與自我再生（在灼燒之後，燒死的不會被奶回來）
   ├─ moveEnemies       stun 中不前進；slow → ×SLOW_FACTOR
   ├─ stepCombat        每個單位：cd 倒數 → pickTarget → dealDamage（依 shape 擴散）→ pushEffect
   ├─ stepSkills        skillCd 倒數 → SKILLS[defKey](state, u) → 成功才進冷卻 + emit('skill')
   ├─ stepBondSkills    bondCds 倒數 → COMBOS[bondName](state, bondMembers(...)) → emit('combo')
   ├─ stepMeteor        局外道具：damageEnemy + 直接寫 burnT/burnDps（繞過 applyStatus）
   ├─ stepEffects       life -= dt，過期丟棄
   └─ cleanupDead / checkWaveEnd    cleanupDead 同時展開死亡分裂（splitInto）
```

完整的每 tick 順序與「為什麼是這個順序」在 [05-economy-and-waves.md](05-economy-and-waves.md)。

倍率的重算走另一條路（**不在每 tick**）：

```
actions.ts 任一操作 → recalcUnits(state)（state.ts:358）
  1. recomputeForm       武將屬性 = 成員字牌總和 × 武將倍率
  2. computeBonds        → state.activeBonds / state.cdMul；u.atk/aps/range（含 effectiveRange × perks.rangeMul）
  3. 光環                 在羈絆之後相乘
  4. skillCdMax = skill.cd × state.cdMul（只有 SKILLS 有註冊才給值）
```

## 契約與陷阱

1. **⚠ 新增羈絆的硬約束：靠姓名配方武將達成的門檻不能超過 `MAX_LOADOUT_GENERALS`（= 5，`state.ts:90`）。**
   姓氏／名字字**不能**被選進編隊的「攜帶的字」，只能靠「攜帶的武將」欄位帶入，
   所以門檻 > 5 的羈絆在啟用編隊時**永遠湊不齊**（蜀漢棟樑曾經是 6，踩過這個坑，見 `data/bonds.ts:90`）。
   `loadout.test.ts:23-51` 是守護測試：`requireGenerals.length <= 5`；`requireTag.count` 若無法靠「配方是兵器／兵種字的部隊武將」達成，也必須 `<= 5`。
   例外：`虎狼之師`（`部隊` tag，count 4）不受限，因為部隊的配方字可以直接選進 `loadoutGlyphs`。

2. **爆擊的 RNG 慣例是「短路、不抽樣」，跟另外兩處相反。**
   ```ts
   // combat.ts:187 —— critChance 為中性值 0 時，&& 短路，rng() 完全不被呼叫
   const crit = state.perks.critChance > 0 && state.rng() < state.perks.critChance
   ```
   但 `step.ts:162`（回魂旗漏怪防護）與 `actions.ts:49`（精兵符）是 **`state.rng()` 無論如何都抽**。
   影響：預設 meta（無道具）下 `dealDamage` 不消耗亂數，所以 `npm run sim` 的難度基準與所有種子測試都對得上；
   一旦在戰鬥熱路徑加入「無條件抽樣」的新 perk，**同種子的整條亂數流會位移**，所有既有基準與確定性測試同時漂移。
   在 `combat.ts` / `skills.ts` 加機率效果時**沿用短路寫法**。

3. **`applyStatus` 的第 4 參數 `baseAtk` 只餵灼燒**（`combat.ts:219`：`burnDps = baseAtk × burn.mul`）。
   組合技傳 `0` 時灼燒 dps 會是 0 —— 這就是 `江東基業` 特意傳 `total * 0.6` 的原因（`skills.ts:359`），
   而 `桃園結義` 只給 stun/vuln 所以傳 0 沒事（`skills.ts:321`）。**新組合技帶 `burn` 時務必傳非 0 的基準值。**

4. **`computeBonds` 必須收到 `perks.cdMul` 才算得對 `cdMax`。**（曾經是 bug，已修）
   面板顯示的 `active[].combo.cdMax` 用 `bonds.ts:49` 的 `effectiveCdMul = cdMul × perksCdMul`，
   而實際倒數用 `bonds.ts:76` 的 `state.cdMul`——兩者必須同基準。
   歷史上 `computeBonds` 沒有 `perksCdMul` 參數，只乘了羈絆的 `cdMul`，
   導致買冷卻道具後**面板顯示的冷卻比實際偏長**。
   **新增任何會影響冷卻的來源時，記得兩邊都要納入**；`shop.test.ts` 有迴歸守護測試。

5. **`bondMembers` 的 fallback 會回傳全部武將**（`skills.ts:383`：`generals.filter(() => bondName.length > 0)`）。
   只有在羈絆既沒 `requireGenerals` 也沒 `requireTag` 時才會走到（目前不存在這種資料）。
   新增這種羈絆前先想清楚 `sumAtk` 會把全場武將都算進去。

6. **`COMBOS` 沒註冊時 `stepBondSkills` 仍會重設冷卻**（`bonds.ts:85-87`）——避免每 tick 空轉查表。所以「沒實作」在行為上完全靜默。

7. **`Effect` 只是視覺，`pushEffect` 超過 240 筆直接丟棄**（`combat.ts:242`）。不要把任何機制資訊塞進 `state.effects`，它會被丟。
   `ring` 用 `toX − fromX` 偷渡半徑給 renderer（`skills.ts:38`），改 `Effect` 結構時注意這個約定。

8. **音效與粒子一律走 `emit()`**（`attack` / `kill` / `skill` / `combo`），`sim/` 內不可碰 Audio／canvas。事件佇列上限 64（`types.ts:297`）。
   ⚠ 敵方的死亡分裂與回血**刻意不 emit 任何事件**（分裂一次可能生 6 隻、回血每幀發生，會把佇列與音效淹掉）。

9. `stepCombat` 用 `u.atk <= 0 || u.aps <= 0` 過濾光環／經濟字（`combat.ts:251`）；`effectiveRange` 另外用 `baseRange <= 0` 短路。兩個條件都要成立才算「完全不攻擊」。

## 我想改 X → 動哪裡

| 想改什麼 | 動哪裡 | 注意 |
|---|---|---|
| 整體射程手感 | `combat.ts:21-25` 的 `RANGE_MUL` / `GENERAL_RANGE_BONUS` / `GLYPH_RANGE_MUL` | `range.test.ts` 用常數本身斷言，不會因此壞掉；但 `npm run sim` 的中位數會整體位移，改完要重跑 |
| 單字 vs 武將的射程差距 | 只動 `GLYPH_RANGE_MUL` | 這是「鼓勵組將」的旋鈕 |
| 誰能打飛行 | `data/enemies.ts:168` 的 `ANTI_AIR_RANGE`，或個別字的 `range` | 判定用 `baseRange`；調 `RANGE_MUL` **不會**改變對空名單（刻意）。目前飛行敵人有飛賊與飛將兩種 |
| 防禦曲線 | `combat.ts:14` `DEF_K` | `mitigate` 有 `max(1, …)` 地板，別移除 |
| 相剋強度 | `combat.ts:17-18` `COUNTER_BONUS` / `COUNTER_PENALTY` | 相剋環定義在 `counterMul` 的 `beats` 表（騎→弓→步→騎） |
| 減速／易傷幅度 | `combat.ts:15-16` `SLOW_FACTOR` / `VULN_MUL` | 減速幅度是全域固定值，資料表只能給**持續秒數** |
| 某武將的技能數值 | `skills.ts:230-266` 的 `SKILLS` 那一行 | 冷卻在 `data/generals.ts` 的 `skill.cd`，不在這裡 |
| 新增一名武將的主動技 | ① `data/generals.ts` 宣告 `skill: { name, cd, desc }` ② `skills.ts` 的 `SKILLS['武將名']` 註冊 | 兩邊缺一就靜默失效；優先組合現有原型。完整步驟見 [../03-change-recipes.md](../03-change-recipes.md) §10 |
| 新增技能原型 | `skills.ts:67-227` 區塊 | **最後手段**。必須回傳 `boolean`，且失敗時不得產生副作用 |
| 新增一種控場狀態 | 要改七處（`OnHit` 型別、`Enemy` 欄位、`makeEnemy` 初值、`applyStatus`、`stepStatuses`、`mergeOnHit`、render／hud 顯示） | 完整清單見 [../03-change-recipes.md](../03-change-recipes.md) §10b；漏一處會安靜失效 |
| 新增羈絆 | `data/bonds.ts` 加一筆；有組合技再到 `skills.ts` 的 `COMBOS` 註冊 | **門檻 <= `MAX_LOADOUT_GENERALS`（5）**，否則 `loadout.test.ts` 會紅；描述文字要跟數值一致（UI 直接顯示 `desc`） |
| 組合技威力 | `skills.ts:315-376` 的 `sumAtk(members) × n` 係數 | 基準是實效攻擊力總和，後期成長很快，係數調 0.1 影響就很大 |
| 某隻敵人免疫什麼 | `data/enemies.ts` 該筆的 `ccImmune` / `burnImmune` / `slowImmune` | **不要改 `applyStatus` 的判斷**——三種免疫已經各自獨立，逐筆宣告即可。改完同步該筆的 `desc` 與 `m3.test.ts:134` |
| 新增第四種免疫 | `types.ts` 的 `EnemyDef` ＋ `Enemy` ＋ `step.ts:86-88` 的 `makeEnemy` ＋ `applyStatus`（`combat.ts:214-238`） | 漏掉 `makeEnemy` 那一行會靜默失效。**易傷刻意保持不可免疫**，別順手補上去 |
| 擊殺獎勵 / 死亡飄字 | `damageEnemy`（`combat.ts:151-174`） | 唯一的死亡結算點，`dealDamage` 也會流經這裡 |

## 相關頁面

- [../01-architecture.md](../01-architecture.md) — 分層規則、`GameState` 全貌、字牌與武將的疊層關係（`glyphAt` / `formsAt`）
- [../02-data-tables.md](../02-data-tables.md) — `GlyphDef` / `GeneralDef` / `BondDef` 每個欄位的平衡基準（注意其 `range` 欄位的對空不等號方向有誤，以本頁 §4 為準）
- [../03-change-recipes.md](../03-change-recipes.md) — §3 新增羈絆、§10 新增主動技／組合技、§10b 新增控場狀態、§10f2 商城道具（`Perks`）
- [../04-invariants.md](../04-invariants.md) — 七條鐵則、`ccImmune` 只擋定身擊退、技能失敗不重設冷卻、光環在羈絆之後結算
- [../05-glossary.md](../05-glossary.md) — 中文術語 ↔ 識別字對照
- 同層模組頁：`sim/state.ts` 的 `recalcUnits`（倍率結算順序）、`sim/step.ts` 的每 tick 順序、`sim/combine.ts` 的組詞判定、`data/shop.ts` 的 `Perks` 推導，各有專頁
