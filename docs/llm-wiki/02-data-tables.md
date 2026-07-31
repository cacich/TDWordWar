# 資料表與平衡基準

所有可調數值都在 `src/data/` 與 `src/sim/economy.ts`、`src/sim/waves.ts`。
改完務必跑 `npm test`（有資料表完整性測試）與 `npm run sim`（看難度曲線）。

---

## src/data/glyphs.ts — 字表

```ts
{ char, category, rarity, atk, aps, range, shape, tags, desc }
```

| 欄位 | 說明 |
|---|---|
| `category` | `weapon` 兵器 / `troop` 兵種 / `surname` 姓氏 / `given` 名字 / `strategy` 謀略 / `economy` 經濟 |
| `rarity` | 1～4，同時是抽卡權重分級（見下方權重表） |
| `range` | 單位是**格**，這裡填的是**基礎值**。實效射程 = `baseRange × RANGE_MUL`（全域 ×2，見 `sim/combat.ts`），單個字（尚未組成武將）再 ×`GLYPH_RANGE_MUL`（0.8），武將則是 ×`GENERAL_RANGE_BONUS`（1.25）並補償多格中心外移，兩者互斥。**對空資格看的是 baseRange，不受放大影響**：`canHit` 要求 `baseRange >= ANTI_AIR_RANGE`（2.0），
即資料表的 `range < 2.0` 視為近戰、打不到飛行單位 |
| `shape` | `single` 單體 / `pierce` 沿路徑貫穿最多 3 名 / `splash` 目標周圍 1.3 格 |
| `tags` | 給羈絆、兵種相剋（`騎`/`弓`/`步`）與對空加成（`弓`）用 |
| `onHit` | 命中附加控場，見下表 |
| `aura` | 光環，影響半徑內其他單位；帶 aura 的字通常 `atk: 0` |
| `income` | 每波產糧（經濟字）。實際產出 = `income × 品質階級`，**線性不指數** |
| `fx` | 攻擊特效樣式。未指定則由 `deriveGlyphFx()` 推導 |

目前內容量：**71 字**（兵器 8／兵種 5／謀略 7／經濟 4／姓氏 20／名字 27）。

**平衡基準**：兵器 rarity1「刀」= atk 17 / aps 1.0 / range 1.2。其他字都以它為尺。
⚠ 整張表的 `atk` 是**可以整批等比例縮放**的——它與敵人血量是一體兩面，
上次經濟改版就整表 ×1.45 來補償「征兵變慢」。要調整體戰力請整批縮放，不要逐筆改。
姓氏與名字字刻意壓到 atk 7（約 40%），製造「先放著等組將 vs 賣掉換糧」的張力——**這是核心設計，別隨手調高**。

### onHit 控場欄位

```ts
onHit: {
  slowDur?: number              // 減速秒數（幅度固定 SLOW_FACTOR = 50%）
  stunDur?: number              // 定身秒數
  vulnDur?: number              // 易傷秒數（受傷 ×VULN_MUL = 1.3）
  knock?: number                // 擊退幾格（沿路徑後退）
  chain?: number                // 連鎖幾名附近敵人（傷害 60%）
  burn?: { mul: number; dur: number }  // 每秒 atk×mul，持續 dur 秒
}
```

- 定身與擊退會被 `EnemyDef.ccImmune`（全部 BOSS）擋掉；灼燒被 `burnImmune`、減速被 `slowImmune` 擋掉；**易傷沒有任何免疫**
- **武將未自訂 `onHit` 時，會自動繼承組成字牌的 onHit**（取各欄位最強者），
  所以「火」＋「計」組出的「火計」自動同時有灼燒與減速——新增謀略配方時不必重寫

### 品質階級（疊合）

- 同字同階疊合 → 升一階，屬性 ×`LEVEL_MUL`（1.55），上限 `MAX_GLYPH_LEVEL`（5）
- 顏色與名稱：`qualityName()` 在 `data/glyphs.ts`，`qualityColor()` 在 `render/theme.ts`（兩處的階數必須一致）
- 光環強度也隨品質成長，換算在 `sim/state.ts` 的 `scaleAura()`
- 疊合可在棋盤（`placeFromHand` / `moveGlyph`）或手牌之間（`mergeHand`）發生

---

## src/data/generals.ts — 配方表（武將）

```ts
g(name, recipe, tier, range, shape, tags, desc, skill?)
```

- `recipe` 是**正讀順序**的字陣列。`['張','飛']` 只有「張在左／上、飛在右／下」才成立。
- `tier` 決定倍率，倍率統一由 `TIER_MUL` 提供，**不要手寫 atkMul**：

| tier | atkMul | apsMul | 用途 |
|---|---|---|---|
| `common` 普通 | 1.6 | 1.10 | 兵種部隊（弓兵、刀兵…） |
| `fine` 精良 | 2.0 | 1.15 | 副將（黃蓋、馬岱） |
| `epic` 史詩 | 2.4 | 1.20 | 名將（馬超、關興） |
| `legendary` 傳說 | 3.0 | 1.30 | 頂級武將（張飛、關羽…） |
| `mythic` 神話 | 3.8 | 1.40 | 三字以上配方，目前只有諸葛亮 |

武將戰力公式（`sim/state.ts` 的 **`recomputeForm()`**）：

> ⚠ **不要改 `makeGeneralUnit`**——它只建殼，`baseAtk`／`baseAps`／`level`／`income`
> 都設 0 後在同一次呼叫的最後委派給 `recomputeForm()` 覆寫。改 `makeGeneralUnit`
> 裡的數字完全沒有效果。


```
baseAtk = Σ(組成字牌的 baseAtk，已含等級倍率) × atkMul
baseAps = avg(組成字牌的 baseAps) × apsMul
```

因為字牌品質會被繼承，**用三階的字組出的張飛遠強於一階**——這是「先養字再組將」路線的機制基礎。

目前內容量：**69 名武將**（普通 16／精良 26／史詩 11／傳說 15／神話 1），其中 33 名有主動技且全部有實作。
分成兩大類：**姓名配方 26 個**（劉備、張飛…，配方字全是姓氏／名字）與
**字組合 43 個**（刀兵、車騎、風陣、陣令、屯田…，配方含兵器／兵種／謀略／經濟字）。

★ **字組合是「不必等姓名字」的那條路**：兵器與兵種字永遠在字池內（見 `sim/pool.ts` 的 `ALWAYS`），
所以每一局都湊得到。目前**每個非姓名字都有 2～13 種組合**，例如
車 → 車兵／車騎／雷車／輜重、陣 → 風陣／計陣／陣令／雷陣。

⚠ **謀略類的組合大多刻意不宣告 `onHit`**，讓 `recomputeForm` 自動繼承成員的控場效果
（逐欄取最強者，`mergeOnHit`）——「風＋雷」因此自然同時有擊退與連鎖，不必在資料表重寫一遍。
只有想要「跟成員不同或更強」的效果時才顯式宣告。

`skill` 只是宣告，行為註冊在 `sim/skills.ts` 的 `SKILLS[武將名]`。
沒有註冊實作的武將 `skillCdMax` 會是 0（永不施放），資訊面板會顯示「（尚未實作）」。
有測試把關 `SKILLS` 的鍵一定對得上武將名。

「兵」是刻意設計的低成本組詞鑰匙：rarity 1、atk 6，而且是**全表組合最多的字（13 種）**，
讓玩家早期就能體驗到組詞的爽感。
三字配方（諸葛亮）已支援，`MAX_RECIPE_LEN` 會自動從配方表推導，不需要另外設定。

---

## src/data/enemies.ts — 敵表

```ts
{ key, char, hpMul, def, speed, flying, bounty, damage, troop, desc,
  traits,                        // ★ 必填：這隻敵人「難對付的地方」
  ccImmune?, burnImmune?, slowImmune?,
  healAura?: { radius, hps },    // 為半徑內其他敵人回血（比例／秒）
  buffAura?: { radius, defAdd?, speedMul? },  // 加防／加速光環（旗賊、戰鼓將）
  maxShare?,                     // 這一種在單一波裡的數量佔比上限（0～1）
  regen?,                        // 自我回血（最大血量的比例／秒）
  splitInto?: { key, count },    // 死亡分裂
  escort?: { key, count },       // 生成時一起帶出的護衛
  boss?, minWave? }
```

目前 **24 種敵人 = 11 一般兵 + 13 種 BOSS**。

- `speed` 單位是「每秒前進幾格」
- `def` 走遞減公式：`傷害 = atk × (1 - def/(def+60))`，`DEF_K = 60` 定義在 `sim/combat.ts`
- `flying: true` 只有 `range >= 2` 的單位打得到
- `troop` 參與三向相剋：騎 → 弓 → 步 → 騎（`COUNTER_BONUS` 1.25 / `COUNTER_PENALTY` 0.75）
- 三種免疫各擋不同東西：`ccImmune` 定身＋擊退／`slowImmune` 減速／`burnImmune` 灼燒。
  **易傷刻意無法免疫**，否則控場流會對 BOSS 完全失效
- ⚠ **灼燒無視防禦**（走 `damageEnemy` 不經 `mitigate`），所以「高防」的解法是持續傷害；
  `burnImmune` 是唯一能封掉這條路、逼玩家改帶高單擊的手段
- ⚠ **敵方光環（`healAura` / `buffAura`）一律有疊加上限，治療者之間也不互相治療**，
  實作在 `sim/step.ts`。沒有這兩條會出現「一波打不死又推不動」的無限卡波，
  詳見 [modules/05](modules/05-economy-and-waves.md) 的「卡波與督戰」
- 實際血量 = `enemyBaseHp(wave, maxWave, arc) × hpMul`。⚠ **指數吃的是「走完難度弧的百分比」**
  （`wave × arc / maxWave`），難度看關卡的 `arc` 不是波數，見 [modules/05](modules/05-economy-and-waves.md)

### traits 與推薦手段

`traits` 一個欄位驅動兩件事，**不要在別處重複定義**：

1. 關卡的 `bias` 加權帶該特徵的敵人與 BOSS 的出現率（`sim/waves.ts` 的 `BIAS_WEIGHT`）
2. 經 `TRAIT_COUNTERS` 推導出選單卡片的「建議帶」標籤（`countersFor()`）

| trait | 意義 | 推導出的應對手段 |
|---|---|---|
| `swarm` | 成群、血薄 | 範圍攻擊、貫穿 |
| `armored` | 高防 | 持續傷害、單體高傷 |
| `flying` | 飛行 | 對空 |
| `fast` | 高速 | 控場 |
| `healer` | 回血支援 | 單體高傷（集火） |
| `splitter` | 死亡分裂 | 範圍攻擊 |
| `tanky` | 血量厚 | 持續傷害、單體高傷 |

## src/sim/waves.ts — 波次成長

```ts
BASE_HP = 32         // 第 0 波基準。**線性項**，用來抵銷「玩家整體戰力變了」
                     // （20 → 32：字組合從 17 擴到 43 種後傻 AI 每波戰力約 +78%）
HP_GROWTH = 1.23     // 每波 ×1.23。⚠ 必須貼著玩家戰力成長率，不是自由參數
WAVE_REF   = 40      // 弧的「參考」長度。血量指數 = wave × level.arc / maxWave ← 吃相對進度
                     // arc 省略或無盡模式時就取 WAVE_REF（= 走完整條弧）
enemyCount(w) = 6 + floor(w × 1.4)
PREP_SECONDS = 12    // 佈陣時間
isBossWave(w) = w % 5 === 0
BIAS_WEIGHT = 4      // 帶關卡偏好特徵的敵人，出現權重 ×4
composition(w)       // 該波可出現的一般兵（依各敵人的 minWave 開放）
pickBoss(w, rng, bias)  // BOSS 波從合格 BOSS 中依 bias 加權隨機挑一隻
```

**難度旋鈕的優先順序**：單關太硬／太軟先動該關的 `arc`（難度弧長度，唯一的主旋鈕）→
全部關卡一起動才碰 `HP_GROWTH`（⚠ 它必須貼著玩家戰力的成長率，不是自由參數）→
`enemyCount` → 各敵人的 `minWave` → 該關 `hpMul` 做最後 ±20% 微調。
⚠ **不要用 `maxWave` 調難度**：它現在只是「打幾波」。

⚠ `buildWave` 會**消耗 rng**（抽敵種與 BOSS）。要做「波次預覽」不能直接呼叫它，
詳見 [06-roadmap.md](06-roadmap.md) §2。

## src/sim/economy.ts — 經濟

```ts
recruitCost(state) = 8 + floor(wave × 2.4) + RECRUIT_STEP(3) × recruitsThisWave
waveIncome(wave)   = 4 + floor(wave × 0.6)
// ★ 設計目標：一波只夠征兵 1～2 次。用 `npm run econ` 驗收。
// 收入佔比 擊殺賞金≈65%／固定收入≈30%／場上產糧≈5%，主力旋鈕是 enemies.ts 的 bounty。
// 真正的旋鈕是「收入 ÷ 花費」的比值，兩條斜率（0.6 與 2.4）是一組的，不要單獨調。
SELL_RATIO = { glyph: 1.0, general: 0.3 }   // 鏟除武將只退 3 成
```

抽卡稀有度權重（`sim/economy.ts` 的 `RARITY_TABLE`，每列總和必須是 100，有測試把關。
`RARITY_TABLE` 本身是 module-private，公開介面是 `rarityWeights(wave)`）：

> ⚠ **第 4 欄目前是死的**：沒有任何字是 `rarity: 4`（分布為 1→5／2→29／3→37），
> 所以索引 3 永遠不會被讀取，調整它不會有任何效果。


| 波次 | R1 | R2 | R3 | R4 |
|---|---|---|---|---|
| ≤5 | 70 | 25 | 5 | 0 |
| ≤12 | 50 | 32 | 15 | 3 |
| ≤20 | 35 | 33 | 24 | 8 |
| 21+ | 25 | 30 | 30 | 15 |

## src/data/bonds.ts — 羈絆

條件二選一（也可並用）：

```ts
requireGenerals: ['劉備','關羽','張飛']   // 全部在場
requireTag: { tag: '馬', count: 2 }       // 帶此 tag 的武將達到數量（只算武將，不算字牌）
```

效果：`atkMul` / `apsMul` / `cdMul`（技能冷卻倍率），全域乘算，多個羈絆相乘。
`comboSkill` 的行為註冊在 `sim/skills.ts` 的 `COMBOS[羈絆名]`；沒註冊就只有數值加成。
組合技傷害以參與武將的**攻擊力總和**計算 → 越晚湊齊威力越大。

羈絆條件靠武將的 `tags`，所以新增武將時記得補 tag（例如馬姓武將要有 `'馬'`）。
目前 13 組羈絆、5 個組合技。

## src/sim/skills.ts — 技能原型

改技能不必寫新邏輯，先看能不能套現成原型：

| 原型 | 行為 | 參數 |
|---|---|---|
| `burst` | 半徑內全部敵人受傷，可附加狀態 | `(mul, extra, onHit?, repeat?)` |
| `crowd` | 純控場，傷害很低 | `(onHit, extra, mul?)` |
| `lineStrike` | 以最前方目標為基準，往後涵蓋 N 段路徑 | `(mul, len, onHit?)` |
| `charge` | 無視射程，打最前方 N 名 | `(mul, onHit?, count?)` |
| `snipe` | 全場血量最高者 | `(mul)` |
| `global` | 全場敵人 | `(mul, onHit?)` |
| `healLife` | 恢復生命（滿血時回傳 false，不消耗冷卻） | `(n)` |
| `gainFood` | 徵糧（隨波次成長） | `(base, perWave?)` |
| `burstAndFood` | 先範圍傷害再徵糧（曹操用） | `(mul, extra, food)` |

共 9 個原型。`extra` 是「在單位射程之外再加幾格」，所以射程長的武將技能範圍自然更大。

**新增技能時請優先組合現有原型，不要新增原型**——原型越少，技能行為越可預測。

## src/data/levels/index.ts — 關卡

```ts
{ key, name, subtitle, startFood, lives, maxWave, arc, hpMul,   // arc = 難度弧長度，★ 必填
  pool: { support: number; generals: number },             // ★ 必填，別漏掉
  bias?: EnemyTrait[],                                     // 偏好的敵人特徵
  map?: string[],                                          // 固定地圖
  gen?: { cols, rows, minPathLen, blockRate? } }           // 隨機地形
```

```
S 出兵口   C 大營   # 路   P 空地   . 障礙
```

目前 **12 關**（4 關固定地圖 + 8 關隨機地形），另有**由這 12 關推導出的 12 個無盡變體**
（`endless_<key>`，`maxWave: Infinity`；見 [modules/03](modules/03-board-and-mapgen.md) 的「無盡變體」）。

- **`pool` 是必填欄位**（漏掉會 TS 編譯錯誤）：`support` = 抽幾個謀略／經濟字，
  `generals` = 抽幾組姓名配方。數字越小越容易疊高與湊配方，但變化也越少。
  可直接複製的完整範例見 [03-change-recipes.md](03-change-recipes.md) §5。
- **`bias` 決定這一關的性格**：帶那些特徵的敵人與 BOSS 出現權重 ×`BIAS_WEIGHT`，
  並自動推導出選單卡片的「建議帶」標籤。**不要另外手寫推薦清單**，
  推導只有一個來源（`data/enemies.ts` 的 `TRAIT_COUNTERS`）。
- `map` 與 `gen` 二選一（有測試檢查每關至少有一個）
- 固定地圖每一列長度必須相等，否則 `parseMap()` 會拋錯（有測試）
- **`arc` 是該關的難度主旋鈕**（難度弧長度，單位是參考波）：越大越難，`maxWave` 只管長度。
  `hpMul` 是乘在血量上的 ±20% 微調
- 關卡順序與解鎖條件由 `LEVEL_ORDER` 決定（前一關通關才解鎖下一關）；**無盡變體刻意不在 `LEVEL_ORDER` 裡**
- `maxWave` 為 `Infinity` 就是無盡：改走絕對波次曲線（等同 `arc` = 40），成績記在 `meta.endless`
- 設計決定 #2：**障礙不阻擋射線**，`.` 只影響可放置性與視覺

各關偏好與傻 AI 中位數（**目標 ≈ `maxWave × 20 / arc`**，±20% 內算達標；`npm run sim 16 all`）：

| 關卡 | 波數 | arc | hpMul | bias | 戰場特性 `mods` | sim 中位數 | 比例 |
|---|---|---|---|---|---|---|---|
| 黃巾之亂 | 12 | 20 | 0.85 | —（教學） | — | 12 | 1.00 |
| 討伐董卓 | 18 | 23 | 1.00 | flying | — | 16 | 0.89 |
| 巨鹿 | 30 | 28 | 1.15 | swarm | — | 23 | 0.77 |
| 官渡 | 24 | 31 | 1.10 | fast | — | 18 | 0.75 |
| 赤壁 | 30 | 31 | 1.20 | armored | — | 19 | 0.63 |
| 五丈原 | 40 | 32 | 1.10 | healer, tanky | — | 25 | 0.63 |
| 襄陽 | 32 | 39 | 1.25 | swarm, splitter | — | 17 | 0.53 |
| 漢中 | 32 | 39 | 1.20 | armored, tanky | — | 15 | 0.47 |
| 洛陽 | 40 | 44 | 1.28 | flying, fast, healer | — | 20 | 0.50 |
| 合肥 | 36 | 45 | 1.20 | swarm, fast | `spawnGap: 0.4` | 15 | 0.42 |
| 虎牢關 | 30 | 47 | 1.15 | tanky, armored | `bossEvery: 3` | 12 | 0.40 |
| 許昌 | 40 | 49 | 1.30 | healer, armored, fast | `rangeMul: 0.85`、`enemySpeedMul: 1.1` | 14 | 0.35 |

★ **「比例」一路遞減才是難度曲線**（1.00 → 0.35）。`arc` 因此逐關不遞減；
它不是等差，因為生命數與字池也算難度（2 條命的五丈原用的弧比襄陽短）。
⚠ 漢中 0.47／洛陽 0.50 的先後在 16 局取樣下屬於雜訊（洛陽是雙峰分佈），不必再往上疊 `arc` 去追。
⚠ **戰場特性也是難度**，但 `arc` 換算出的預期值不知道它存在——加 `mods` 的關卡一定要重跑 sim。

無盡變體沿用同一份 `hpMul`／`bias`／字池，弧一律 40（絕對波次），目標 `WAVE_REF/2 = 20`：
黃巾 22・巨鹿 21・洛陽 19。

## src/sim/mapgen.ts — 隨機地形

`generateMap(rng, gen)` 回傳地圖字串陣列。**死路在設計上不可能出現**：先畫出一條
從最上列連到最下列的走廊，其餘格子才填空地。可調參數：

| 參數 | 意義 |
|---|---|
| `cols` / `rows` | 棋盤尺寸 |
| `minPathLen` | 路徑長度門檻，達不到就換參數重試（最多 24 次） |
| `blockRate` | 空地變障礙的機率（赤壁用 0.13，其餘 0.07） |
| `MIN_RUN`（檔內常數） | 每段橫走的最短長度，太小路會變成一直往下掉 |

走廊保持 induced path（非相鄰的走廊格不貼邊），所以 BFS 最短路 == 生成的走廊。
`mapgen.test.ts` 用 180 張隨機地圖驗證這個不變量。

## src/render/fx.ts — 攻擊特效

`FxKind` 是 sim 給的語義，顏色與畫法在這裡決定（維持 sim 不依賴 render）。

| FxKind | 誰用 | 長相 |
|---|---|---|
| `blade` | 刀劍斧戟 | 墨黑弧形斬擊 |
| `arrow` | 弓弩 | 墨綠細箭 |
| `thrust` | 矛槍 | 靛藍直刺 + 菱形槍尖 |
| `fire` | 火、周瑜 | 橘紅火球 + 拖尾 |
| `bolt` | 雷 | 紫色鋸齒閃電 |
| `venom` | 毒 | 草綠虛線 + 氣泡 |
| `gale` | 風 | 天藍新月氣旋 |
| `plan` | 計 | 把字本身丟出去 |
| `charge` | 兵步盾騎車 | 土褐塵土弧 |
| `none` | 光環與經濟字 | 不畫（不攻擊） |

每次攻擊還會在命中點浮現攻擊者的字，並讓攻擊者閃一下同色外框（`Unit.atkFlash`）。
