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
| `range` | 單位是**格**，這裡填的是**基礎值**。實效射程 = `baseRange × RANGE_MUL`（全域 ×2，見 `sim/combat.ts`），單個字（尚未組成武將）再 ×`GLYPH_RANGE_MUL`（0.8），武將則是 ×`GENERAL_RANGE_BONUS`（1.25）並補償多格中心外移，兩者互斥。**對空資格（`< 2.0` `ANTI_AIR_RANGE`）看的是 baseRange，不受放大影響** |
| `shape` | `single` 單體 / `pierce` 沿路徑貫穿最多 3 名 / `splash` 目標周圍 1.3 格 |
| `tags` | 給羈絆、兵種相剋（`騎`/`弓`/`步`）與對空加成（`弓`）用 |
| `onHit` | 命中附加控場，見下表 |
| `aura` | 光環，影響半徑內其他單位；帶 aura 的字通常 `atk: 0` |
| `income` | 每波產糧（經濟字）。實際產出 = `income × 品質階級`，**線性不指數** |
| `fx` | 攻擊特效樣式。未指定則由 `deriveGlyphFx()` 推導 |

目前內容量：**71 字**（兵器 8／兵種 5／謀略 7／經濟 4／姓氏 20／名字 27）。

**平衡基準**：兵器 rarity1「刀」= atk 12 / aps 1.0 / range 1.2。其他字都以它為尺。
姓氏與名字字刻意壓到 atk 5（約 40%），製造「先放著等組將 vs 賣掉換糧」的張力——**這是核心設計，別隨手調高**。

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

- 定身與擊退會被 `EnemyDef.ccImmune`（賊將）擋掉；灼燒／減速／易傷不會
- **武將未自訂 `onHit` 時，會自動繼承組成字牌的 onHit**（取各欄位最強者），
  所以「火」＋「計」組出的「火計」自動同時有灼燒與減速——新增謀略配方時不必重寫

### 品質階級（疊合）

- 同字同階疊合 → 升一階，屬性 ×`LEVEL_MUL`（1.55），上限 `MAX_GLYPH_LEVEL`（5）
- 顏色與名稱：`qualityName()` 在 `data/glyphs.ts`，`qualityColor()` 在 `render/theme.ts`（兩處的階數必須一致）
- 光環強度也隨品質成長，換算在 `sim/state.ts` 的 `scaleAura()`
- 疊合可在棋盤（`placeFromHand` / `moveUnit`）或手牌之間（`mergeHand`）發生

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
| `mythic` 神話 | 3.8 | 1.40 | 尚未使用，保留給三字以上配方 |

武將戰力公式（`sim/state.ts` 的 `makeGeneralUnit`）：

```
baseAtk = Σ(組成字牌的 baseAtk，已含等級倍率) × atkMul
baseAps = avg(組成字牌的 baseAps) × apsMul
```

因為字牌品質會被繼承，**用三階的字組出的張飛遠強於一階**——這是「先養字再組將」路線的機制基礎。

目前內容量：**43 名武將**（普通 12／精良 10／史詩 5／傳說 15／神話 1），其中 30 名有主動技且全部有實作。

`skill` 只是宣告，行為註冊在 `sim/skills.ts` 的 `SKILLS[武將名]`。
沒有註冊實作的武將 `skillCdMax` 會是 0（永不施放），資訊面板會顯示「（尚未實作）」。
有測試把關 `SKILLS` 的鍵一定對得上武將名。

「兵」是刻意設計的低成本組詞鑰匙：rarity 1、atk 4，讓玩家早期就能體驗到組詞的爽感。
三字配方（諸葛亮）已支援，`MAX_RECIPE_LEN` 會自動從配方表推導，不需要另外設定。

---

## src/data/enemies.ts — 敵表

```ts
{ key, char, hpMul, def, speed, flying, bounty, damage, troop, desc, ccImmune? }
```

- `speed` 單位是「每秒前進幾格」
- `def` 走遞減公式：`傷害 = atk × (1 - def/(def+60))`，`DEF_K = 60` 定義在 `sim/combat.ts`
- `flying: true` 只有 `range >= 2` 的單位打得到
- `troop` 參與三向相剋：騎 → 弓 → 步 → 騎（`COUNTER_BONUS` 1.25 / `COUNTER_PENALTY` 0.75）
- `ccImmune: true` 免疫定身與擊退（目前只有賊將）
- 實際血量 = `enemyBaseHp(wave) × hpMul`

## src/sim/waves.ts — 波次成長

```ts
BASE_HP = 20         // 第 0 波基準
HP_GROWTH = 1.25     // 每波 ×1.25（射程全域 ×2 後上調，把難度拉回 12～20）
enemyCount(w) = 6 + floor(w × 1.4)
PREP_SECONDS = 12    // 佈陣時間
isBossWave(w) = w % 5 === 0
composition(w)       // 波次解鎖敵種：3 波快賊、4 波盾賊、7 波飛賊
```

**難度旋鈕的優先順序**：先動 `HP_GROWTH`（影響最劇烈）→ `enemyCount` → `composition` 解鎖時機。

## src/sim/economy.ts — 經濟

```ts
recruitCost(state) = 8 + floor(wave × 1.6) + 2 × recruitsThisWave
waveIncome(wave)   = 5 + floor(wave × 1.2)
SELL_RATIO = { glyph: 1.0, general: 0.3 }   // 鏟除武將只退 3 成
```

抽卡稀有度權重（`RARITY_TABLE`，每列總和必須是 100，有測試把關）：

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

`extra` 是「在單位射程之外再加幾格」，所以射程長的武將技能範圍自然更大。

## src/data/levels/index.ts — 關卡

```ts
{ key, name, subtitle, startFood, lives, maxWave, hpMul,
  map?: string[],                                          // 固定地圖
  gen?: { cols, rows, minPathLen, blockRate? } }           // 隨機地形
```

```
S 出兵口   C 大營   # 路   P 空地   . 障礙
```

- `map` 與 `gen` 二選一（有測試檢查每關至少有一個）
- 固定地圖每一列長度必須相等，否則 `parseMap()` 會拋錯（有測試）
- `hpMul` 是該關的難度旋鈕，乘在敵人血量上
- 關卡順序與解鎖條件由 `LEVEL_ORDER` 決定（前一關通關才解鎖下一關）
- 設計決定 #2：**障礙不阻擋射線**，`.` 只影響可放置性與視覺

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
