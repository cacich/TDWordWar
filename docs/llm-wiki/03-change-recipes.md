# 「我想改 X」→ 動哪個檔案

依常見程度排序。九成需求只需要改 `src/data/` 底下一個檔案。

---

## 1. 新增一個字

**只改 `src/data/glyphs.ts`**，在對應的分類區塊裡加一列：

```ts
{ char: '槍', category: 'weapon', rarity: 2, atk: 13, aps: 0.9, range: 1.8,
  shape: 'pierce', tags: ['兵器', '近戰'], desc: '長槍直取，可貫穿。' },
```

新字自動進入抽卡池（權重由 `rarity` 決定）、自動出現在手牌與資訊面板。
數值請對照「刀」= atk 12 / aps 1.0 / range 1.2 這把尺。

## 2. 新增一名武將

**只改 `src/data/generals.ts`**，用 `g()` helper：

```ts
g('關興', ['關', '興'], 'epic', 1.5, 'single', ['蜀', '將二代'], '關羽之子。'),
```

- `recipe` 用到的字**必須已存在於 `glyphs.ts`**，否則測試會擋下來（`core.test.ts` 有完整性檢查）
- 倍率不用寫，`g()` 會從 `TIER_MUL[tier]` 取
- 要參與羈絆就把對應 tag 加進 `tags`

## 3. 新增羈絆

**只改 `src/data/bonds.ts`**：

```ts
{ name: '江東雙璧', desc: '周瑜、魯肅同時在場：攻速 +25%',
  requireGenerals: ['周瑜', '魯肅'], apsMul: 1.25 },
```

羈絆條件在 `sim/bonds.ts` 的 `computeBonds()` 判定，觸發後由 `recalcUnits()` 套用；UI 的紅色小標籤會自動出現。

## 4. 新增敵人／BOSS

**只改 `src/data/enemies.ts`**：在 `ENEMIES` 加一筆 `EnemyDef`。
`REGULARS` / `BOSSES` 是從 `boss` 欄位衍生的，`composition()` 與 `pickBoss()` 會自動撿到，
**不需要再去 `waves.ts` 註冊**（舊版需要手動加解鎖時程，現在改成用 `minWave` 宣告）。

一般兵：

```ts
{
  key: 'myEnemy', char: '例', hpMul: 1.4, def: 20, speed: 0.9, flying: false,
  bounty: 4, damage: 1, troop: '步',
  traits: ['armored'],     // ★ 必填：決定關卡加權與 UI 推薦標籤
  minWave: 8,              // 第 8 波才開始出現
  desc: '一句話說明它的難處與解法。',
}
```

BOSS（加 `boss: true`，慣例上都給 `ccImmune`）：

```ts
{
  key: 'bossMine', char: '例', hpMul: 12, def: 60, speed: 0.7, flying: false,
  bounty: 26, damage: 2, troop: '步',
  traits: ['tanky'], boss: true, ccImmune: true, minWave: 15,
  regen: 0.02,             // 選一個「必須改變打法」的鉤子
  desc: '…',
}
```

可用的機制鉤子：`burnImmune`／`slowImmune`／`healAura`／`regen`／`splitInto`／`escort`。

⚠ 注意事項
- **`traits` 必填**。新增 trait 時要一併補 `TRAIT_COUNTERS` 與 `TRAIT_LABEL`，
  否則 `enemies-ext.test.ts` 會紅燈。
- **`splitInto` 不可形成環**（A→B→A 會無限增殖），且單次分裂總量有上限（測試把關）。
- **新 BOSS 的機制指紋不能跟現有 BOSS 重複**——有測試檢查，避免只是血量不同的複製品。
- 加完**必須跑 `npm run sim`**，新機制對難度的影響通常比數值更大。

## 5. 新增關卡

**只改 `src/data/levels/index.ts`**：在 `LEVELS` 加一筆，再把 key 放進 `LEVEL_ORDER`
（順序就是解鎖順序，選單會自動長出卡片）。

固定地圖：

```ts
myLevel: {
  key: 'myLevel', name: '街亭', subtitle: '窄路，落點極少',
  startFood: 24, lives: 3, maxWave: 20, hpMul: 1.1,
  pool: { support: 4, generals: 5 },   // ★ 必填，漏掉會 TS 編譯錯誤
  map: ['S########', 'PPPPPPPP#', '#########', /* … 每列長度必須一致 */],
}
```

`pool` 決定本局字池大小：`support` = 抽幾個謀略／經濟字，`generals` = 抽幾組姓名配方
（成組加入，不會產生湊不成配方的孤兒字）。教學關用小數字（2/3），後期關卡用大數字（7/9）。

隨機地形：把 `map` 換成 `gen`，其他欄位（含 `pool`）都一樣。

```ts
gen: { cols: 9, rows: 14, minPathLen: 44, blockRate: 0.1 }
```

⚠ `cols` 至少要 5（檔內 `MIN_RUN = 4`），否則路會退化成垂直直線。
`minPathLen` 訂太高不會拋錯——`generateMap` 重試 24 次後會保留最長的那條照樣回傳，
只有測試會抓到。

調隨機地形的手感：`minPathLen` 拉高 → 路更長更繞；`blockRate` 拉高 → 可放置的地更零碎。
改完跑 `npm test`（mapgen 測試會用 180 張地圖驗證連通性）與 `npm run sim 16 myLevel`。

## 6. 調整難度

| 想要的效果 | 改哪裡 |
|---|---|
| 整體變難／變簡單 | `sim/waves.ts` 的 `HP_GROWTH`（最有效，0.02 的差距就很明顯；目前 1.23） |
| 敵人變多 | `sim/waves.ts` 的 `enemyCount()` |
| 某類敵人出現更頻繁 | 該關的 `bias`（`data/levels/index.ts`）或 `BIAS_WEIGHT`（`sim/waves.ts`，目前 4） |
| 強力敵種太早出現 | 該敵人的 `minWave`（`data/enemies.ts`） |
| 單關變難 | 該關的 `hpMul`／`lives`／`maxWave`（`data/levels/index.ts`） |
| 前期太窮 | `sim/economy.ts` 的 `recruitCost()` 常數 8、`waveIncome()` |
| 抽不到好字 | `sim/economy.ts` 的 `RARITY_TABLE`（每列總和要 100） |
| 佈陣時間 | `sim/waves.ts` 的 `PREP_SECONDS` |
| 塔打得到的範圍 | `sim/combat.ts` 的 `RANGE_MUL`（全域射程倍率，越大越簡單）／`GENERAL_RANGE_BONUS`（武將額外）／`GLYPH_RANGE_MUL`（單個字的收斂倍率，越小越鼓勵組將） |

改完跑 `npm run sim`：傻 AI 的陣亡中位數應落在 12～20 波。

## 7. 改視覺

- **顏色／字體／階級色／品質色** → `src/render/theme.ts`（`THEME`、`TIER_COLOR`、`QUALITY_COLOR`、`STATUS_COLOR`）
- **畫法**（格子、卡片、敵人） → `src/render/renderer.ts` 對應的 `drawXxx()` 方法
- **攻擊特效** → `src/render/fx.ts`。改顏色動 `FX_COLOR`，改形狀動 `drawAttack()` 的 switch
- **新增一種攻擊特效**：
  1. `sim/types.ts` 的 `FxKind` 加成員
  2. `render/fx.ts` 的 `FX_COLOR` 加顏色、`drawAttack()` 加一個 case
  3. `data/glyphs.ts` 對應的字加 `fx: '新的'`
  4. 檢查 `sim/state.ts` 的 `FX_PRIORITY`（決定武將繼承哪一個），越前面越優先
- **新增一種非攻擊特效**（技能環、光束…）：`Effect.kind` 加 union 成員 → `sim/skills.ts` 產生 → `renderer.drawEffects()` 畫

## 7b. 新增經濟字

`src/data/glyphs.ts` 加一筆 `category: 'economy'`、`atk: 0`、`fx: 'none'`、`income: N`。
產出公式是 `income × 品質階級`（線性），每波結算由 `sim/economy.ts` 的 `unitIncome()` 統計，
`sim/step.ts` 的 `checkWaveEnd()` 加進 `state.food` 並寫入 `state.lastIncome` 供 HUD 顯示。

## 8. 改 UI 版面

四個檔案要同步（DOM id 就是契約）：

1. `index.html` 結構與 id
2. `src/style.css` 樣式
3. `src/ui/hud.ts` 的 `el('id')` 與每幀更新邏輯（遊戲中的 HUD）
4. `src/ui/screens.ts`（選關與圖鑑這兩個全螢幕畫面）

`ui/screens.ts` 透過 `ScreensHost` 跟 app 溝通；畫面開著時 `app.ts` 會暫停模擬迴圈。

⚠ 浮層元件（`.bonds`、`#infopanel`）刻意用 `position:absolute` 掛在 `#stage` 內，**不要改回 flex 子元素**，否則開關面板時棋盤會被壓縮重繪。

## 9. 新增一種玩家操作

寫在 `src/sim/actions.ts`，遵守既有形狀：

```ts
export function myAction(state: GameState, ...args): ActionResult {
  if (state.phase === 'won' || state.phase === 'lost') return fail('本局已結束')
  // ...改 state
  recalcUnits(state)                       // 若動到 units 或 hand
  return { ok: true, msg: '給玩家看的回饋' }
}
```

再從 `input/pointer.ts` 或 `ui/hud.ts` 呼叫，並把 `res.msg` 丟給 `toast()`。
如果這個操作會改變棋盤配置，記得呼叫 `tryCombine(state, cell)`。

## 10. 新增主動技或組合技

**先看 [02-data-tables.md](02-data-tables.md#srcsimskillsts--技能原型) 的原型表能不能直接套。** 九成情況兩步就好：

1. `src/data/generals.ts` 給武將加 `skill: { name, cd, desc }`
2. `src/sim/skills.ts` 的 `SKILLS` 加一行：

```ts
export const SKILLS: Record<string, SkillFn> = {
  張遼: charge(2.0, { stunDur: 1.0 }, 6),     // 衝鋒 200%，定身 1 秒，最多 6 名
  黃忠: snipe(4.5),                            // 狙擊最高血量 450%
  周瑜: global(1.2, { burn: { mul: 1, dur: 5 } }),
}
```

組合技同理：`data/bonds.ts` 加 `comboSkill`，`sim/skills.ts` 的 `COMBOS` 加實作。
組合技的 `members` 參數就是參與該羈絆的武將，用 `sumAtk(members)` 算傷害。

**契約**：`SkillFn` 回傳 `false` 表示「這次沒放」（沒目標、不需要），此時**不會重設冷卻**，
下一 tick 會再試。所以像〈仁德〉這種滿血時無效的技能要記得回傳 false，否則會白白浪費冷卻。

要寫全新原型時，把它做成回傳 `SkillFn` 的工廠函式，保持「立即結算、無排程器」的性質——
這是技能能在 Node 的 `npm run sim` 裡跑的前提。

## 10b. 新增一種控場狀態

1. `sim/types.ts` 的 `OnHit` 加欄位；`Enemy` 加對應的剩餘秒數欄位
2. `sim/step.ts` 的 `makeEnemy()` 給初值（**漏掉會是 `undefined`，比對時靜默出錯**）
3. `sim/combat.ts` 的 `applyStatus()` 寫入（要不要被 `ccImmune` / `slowImmune` / `burnImmune` 擋掉在這裡決定）
4. `sim/step.ts` 的 `stepStatuses()` 倒數並生效
5. `sim/state.ts` 的 `mergeOnHit()` 加一行，武將才會繼承
6. `render/renderer.ts` 的狀態小圓點 + `render/theme.ts` 的 `STATUS_COLOR` 加顏色
7. `ui/hud.ts` 的 `onHitText()` 加一行，資訊面板才看得到

這七處都要改，漏掉任何一處都會安靜地失效（例如漏 5 就只有字牌有效、武將沒有）。

若這個狀態需要「某些敵人免疫」，免疫欄位是**獨立的第四種**，不要塞進 `ccImmune`——
現有三種（`ccImmune` 定身＋擊退／`slowImmune` 減速／`burnImmune` 灼燒）各自判斷，
新增一種要同時改 `EnemyDef`、`Enemy` 與 `makeEnemy`。易傷刻意不可免疫，見
[modules/04](modules/04-combat-and-skills.md) §6。

## 10c. 調整「抽到想要的字」的機率

兩個旋鈕，都在資料／經濟層：

| 想要的效果 | 改哪裡 |
|---|---|
| 池子更小、更容易疊高與湊配方 | `data/levels/index.ts` 各關的 `pool: { support, generals }` 調小 |
| 抽卡更黏著已有的字 | `sim/economy.ts` 的 `FAMILIAR_BOOST`（目前 3，設 1 等於關閉） |
| 池子的組成規則（哪些字永遠在池內） | `sim/pool.ts` 的 `ALWAYS` / `SUPPORT` / `NAMED_RECIPES` |

⚠ 姓名字必須**成組**進池（`NAMED_RECIPES` 是配方而不是單字），否則會出現湊不成任何武將的孤兒字。
`pool.test.ts` 有測試把關這件事。

## 10d. 加一個音效

1. `core/audio.ts` 的 `SfxName` 加名字、`RECIPES` 加配方（振盪器 + 滑音 + 白噪音的組合）
2. 高頻音效記得在 `THROTTLE` 加節流間隔，否則後期會變噪音牆
3. 觸發點：如果是玩家操作，直接在 `app.ts` 呼叫 `this.audio.play('名字')`；
   如果是模擬內部發生的事，**必須走事件佇列**（見下）

## 10e. 加一種事件（音效／粒子的觸發來源）

1. `sim/types.ts` 的 `SimEvent` union 加一個成員
2. 在 `sim/` 對應的地方 `emit(state, { kind: '…' })`（`sim/events.ts`）
3. `app.ts` 的 `drainEvents()` 加 case，接到音效與 `renderer.particles`

⚠ 不要在 `sim/` 直接呼叫音效或 canvas——那會破壞「sim 可在 Node 跑」這條架構底線。

## 10f. 加一個局外升級（兵書）

**只改 `src/data/upgrades.ts`**：在 `UPGRADES` 加一筆，寫好 `level`（從 meta 反推目前等級）、
`max`、`cost(level)` 與 `apply(meta)`。兵書畫面會自動長出那一列。
若新增的欄位不在 `MetaProgress` 裡，要一併加欄位並在 `core/save.ts` 的 `loadMeta()` 補預設值。

## 10f2. 加一個商城道具（可升級的被動效果）

商城賣的是**整局有效的被動道具**，每種最高 `MAX_ITEM_LEVEL`（目前 3）級，買一級生效一級，
效果比兵書更會改變玩法。`MetaProgress.items` 存的是 `Record<道具 key, 目前等級>`，不是
一次性擁有的旗標。三步：

1. `src/data/shop.ts`：在 `SHOP` 加一筆 `ShopItem`——`key`／`name`／`desc`（不隨等級變的一句話總述）／
   `cost(level)`（0-based，買到 `level+1` 級要多少聲望，通常直接用現成的 `stdCost(base)`）／
   `detail(level)`（1-based，那一級的效果描述，逐級列在商城 UI）／
   `apply(level, p)`（把該等級的數值寫進 `Perks` 物件的對應欄位）。
2. `sim/types.ts` 的 `Perks` interface 加一個欄位，並在 `shop.ts` 的 `NEUTRAL_PERKS` 給中性值
   （倍率 1、機率/間隔/加成 0）。
3. 讓 sim 讀那個 `Perks` 欄位。既有 hook 範例：
   - 徵兵升階機率 → `sim/actions.ts` 的 `recruit()`
   - 全場攻擊／攻速／射程加成、羈絆冷卻倍率 → `sim/state.ts` 的 `recalcUnits()`
   - 每波收入／回血、起始與上限生命 → `sim/step.ts` 的 `checkWaveEnd()` 與 `sim/state.ts` 的 `createGame()`
   - 週期性效果（流星火雨）→ `sim/step.ts` 的 `stepMeteor()`
   - 攻擊倍率類（爆擊、範圍傷害、擊殺收入）→ `sim/combat.ts` 的 `dealDamage()` / `stepCombat()` / `damageEnemy()`
   - 敵人相關（減速、漏怪防護）→ `sim/step.ts` 的 `moveEnemies()`
   - 花費打折、抽字加權 → `sim/economy.ts` 的 `recruitCost()` / `rerollCost()` / `rollGlyph()`

⚠ **等級 0（未購買）時 `perksFrom` 必須回中性值**，否則 `npm run sim`
（用預設 meta、無道具）的難度基準會跑掉。新增 `Perks` 欄位不需動 `core/save.ts` 的存檔格式——
只有 `meta.items` 進存檔，效果都是從它現算的；但 `loadMeta()` 的 `items()` 轉換函式會依
`SHOP_BY_KEY[key].max` 夾住等級上限，加新道具或調整 `max` 不用額外改存檔遷移邏輯。

## 10f3. 編隊（手動挑選字池內容）

編隊讓玩家從**已解鎖**（`meta.seenGlyphs` / `meta.seenGenerals`）的字與武將裡，
手動指定要帶進去的內容，取代 `sim/pool.ts` 原本「依關卡隨機抽 support／named-recipe」的邏輯。
啟用（`meta.loadoutActive`）後：

- 字池 = 編隊選的字（`meta.loadoutGlyphs`，上限 `MAX_LOADOUT_GLYPHS`）
  ＋編隊選的武將的配方字（`meta.loadoutGenerals`，上限 `MAX_LOADOUT_GENERALS`）
  ＋**所有還沒解鎖過的字**（不受編隊限制，讓玩家能繼續探索新內容）
- 已解鎖但沒被選進編隊的字／武將會被排除，包括兵器／兵種骨幹字——編隊沒有安全網，
  玩家可能選出打不了怪的隊伍，這是刻意的（見 `sim/pool.ts` 的 `buildLoadoutPool()`）
- 唯一的防呆：算出來的字集合若是空的（例如 0 字 0 武將又全部解鎖），退回骨幹字，
  避免 `rollGlyph` 在空池上壞掉
- **姓氏／名字字（category `surname`／`given`）不能直接選進「攜帶的字」**——它們單獨戰力低，
  存在的唯一目的是組成武將，只能透過「攜帶的武將」帶入（`data/loadout.ts` 的
  `isLoadoutableGlyph()`），跟 `sim/pool.ts` 的 ALWAYS／SUPPORT／NAMED_RECIPES 三分法一致
- **武將的「已解鎖」判定比 `meta.seenGenerals` 寬**：只要配方的字都個別解鎖過
  （`meta.seenGlyphs` 全部命中）就算解鎖，不必真的湊出來過（`data/loadout.ts` 的
  `isGeneralUnlocked()`）——否則玩家明明字都抽過了，卻因為沒手動拼過這個武將而選不到它

修改／擴充時的動線：

1. 選字／選武將的上限、可選類別與切換邏輯在 `data/loadout.ts`（`toggleLoadoutGlyph` /
   `toggleLoadoutGeneral` / `setLoadoutActive` / `isLoadoutableGlyph` / `isGeneralUnlocked`），
   跟 `data/shop.ts`／`data/upgrades.ts` 一樣只碰 `MetaProgress`，不碰 `GameState`。
2. 實際套用字池的地方是 `sim/pool.ts` 的 `buildGlyphPool(rng, level, loadout?)`——
   有傳 `loadout` 就完全走 `buildLoadoutPool()`，不會跟原本的隨機抽樣混合。
   `sim/state.ts` 的 `createGame()` 依 `meta.loadoutActive` 決定要不要組出這個參數。
3. UI 在 `ui/screens.ts` 的 `renderLoadout()`：字按類別（`LOADOUT_GLYPH_CATEGORIES`）分區、
   武將按稀有度（`TIER_DISPLAY_ORDER`）分區，只列出已解鎖／可選的項目，
   點擊呼叫 `ScreensHost` 的 `toggleLoadoutGlyph` / `toggleLoadoutGeneral`。
4. `core/save.ts` 的 `loadMeta()` 讀舊存檔時，也要用 `isLoadoutableGlyph()` /
   `isGeneralUnlocked()` 重新過濾 `loadoutGlyphs` / `loadoutGenerals`，
   否則規則改了但舊存檔裡不合規的項目不會被清掉。

## 10f4. 加一個成就

**九成的情況只要在 `data/achievements.ts` 的 `ACHIEVEMENTS` 加一筆就完成了**——
UI、存檔清洗、聲望發放、進度條全部是資料驅動的，不需要碰其他檔案。

```ts
{
  key: 'noSell',                 // 不可與既有 key 重複（有測試把關）
  name: '滴水不漏',
  desc: '通關一局，且全程沒有任何敵人抵達大營',
  group: 'battle',               // battle 戰陣／build 布陣／collect 圖鑑／journey 征途
  scope: 'run',                  // 'run' 只看這一局／'career' 看跨局累積
  goal: 1,                       // 判定一律是 progress() >= goal
  renown: 80,
  progress: (s) => (s && s.phase === 'won' && s.stats.leaks === 0 ? 1 : 0),
}
```

**設計原則：沒有布林條件，每個成就都是「計數器 >= 門檻」。**
`progress()` 同時餵給達成判定與 UI 進度條，所以兩者不可能不一致。
做不到計數的（例如「通關且沒掉命」）就回傳 0 或 1、`goal` 寫 1。

四個容易踩的地方：

1. **`scope: 'run'` 的 `progress()` 在 `state === null` 時必須回 0。**
   玩家在選單畫面時沒有局內狀態，回傳非 0 會直接誤判成達成。
   `achievements.test.ts` 有一個測試逐項掃過這條。
2. **門檻不要寫死可推導的數字。** 全收集類請寫 `GLYPHS.length`／`GENERALS.length`／
   `LEVEL_ORDER.length`，這樣加內容時成就會自動跟上（也有測試把關）。
3. **獎勵總額是平衡數字。** 目前 24 個成就共 2130 聲望，刻意夾在兵書買滿 1230 與
   商城買滿 13590 之間。加成就會把總額往上推，超出區間測試會紅——
   那是提醒你回頭看這三個數字的關係，不是叫你改測試。
4. **要新的跨局計數器**（例如「累計徵兵次數」）才需要動別的檔案：
   `RunTotals`（`sim/state.ts`）加欄位 → `EMPTY_TOTALS` → `core/save.ts` 的 `totals()` →
   `app.ts` 的累加。⚠ 累加**只能**寫在 `renownPaid` 那個區塊裡，否則同一局會被重複計入。

新的分區要同時加進 `AchieveGroup`、`GROUP_LABEL` 與 `GROUP_ORDER`；
前兩者是 `Record<AchieveGroup, …>`，漏填 tsc 會擋，但**漏加 `GROUP_ORDER` 不會報錯，
那一整區會安靜地不被畫出來**——所以有一個測試專門檢查這件事。

## 10g. 改 PWA（圖示、名稱、離線快取）

| 想改什麼 | 動哪裡 |
|---|---|
| App 名稱、主題色、直式鎖定、start_url | `public/manifest.webmanifest` |
| 圖示（可縮放） | `public/icons/icon.svg` |
| 圖示 PNG（iOS 用） | 用瀏覽器開 `tools/make-icons.html` 產生，放進 `public/icons/` |
| 快取策略、離線行為 | `vite.config.ts` 的 `swSource()` |
| 要不要註冊 SW | `src/core/pwa.ts`（目前只在 production 註冊） |
| `<head>` 的 meta（theme-color、apple-touch-icon…） | `index.html` |

**測試 PWA 必須用 `npm run build && npm run preview`**，開發模式不會註冊 Service Worker。

離線測試法：`npm run preview` 開起來載入一次 → 關掉伺服器 → 重新整理。
應該要完整可玩。若 HTML 出得來但 CSS/JS 掛掉，看
[04-invariants.md 的「Service Worker 存快取要重建 headers」](04-invariants.md)。

## 11. 除錯手法

```js
// 瀏覽器 console
__game.state.units                    // 場上單位
__game.togglePause()                  // 凍結時間慢慢看
__dev.give('張', '飛')                // 塞手牌
__dev.put('張', 0, 1)                 // 直接放到 (col,row)，會判定組詞
__dev.put('刀', 2, 1, 3)              // 3 級的刀
```

不想開 devtools 的話，選單畫面的標題「字戰三國」在 2.5 秒內連點 7 下會打開一個
「開發密技」面板（`ui/screens.ts` 的 `handleTitleTap()`／`renderDev()`），
裡面是按鈕版的常用測試操作（+1000 聲望、+500 糧、生命全滿、清空棋盤字牌、
清空敵人／跳下一波、全圖鑑解鎖、點字直接塞進手牌）。實際邏輯在 `core/devtools.ts`，
是跟 `main.ts` 的 `__dev` console 同等級的測試後門——直接改 `state`／`meta`，
不經過 `sim/actions.ts` 的驗證，所以新增密技按鈕時比照 `__dev` 的寫法即可，
不必假裝是玩家操作。

```bash
npm run sim 100      # 跑 100 局統計，比手動試玩快得多
npm test -- combine  # 只跑組詞相關測試
```

要重現特定對局：`src/app.ts` 的 `createGame('huangjin', newSeed(), meta)`，把 `newSeed()`
換成固定數字（`newSeed()` 定義在同檔案底部，就是 `Date.now() >>> 0`）。

⚠ 「同種子 → 同一場對局」的前提是**同一份 meta**。編隊開關與商城道具都會改變
亂數的消耗量（見 [modules/05](modules/05-economy-and-waves.md) 與 [modules/06](modules/06-meta-progression.md)），
所以重現 bug 時要連 meta 一起對齊。
