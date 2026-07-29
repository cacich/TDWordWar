# 經濟、波次與模擬主迴圈

> **負責檔案**
>
> | 檔案 | 規模 | 職責 |
> |---|---|---|
> | `src/sim/step.ts` | 235 行 | `stepGame` 主迴圈：生成／狀態／敵方支援／移動／戰鬥／技能／流星／清屍與死亡分裂／波次結算 |
> | `src/sim/waves.ts` | 95 行 | 血量曲線（`HP_GROWTH`）、數量、`minWave` 開放、`bias` 加權、`pickBoss`、`buildWave` |
> | `src/sim/economy.ts` | 106 行 | 征兵／重抽花費、每波收入、抽字權重（稀有度＋熟悉度＋心願）、退款 |
> | `src/sim/pool.ts` | 99 行 | 每局字池（隨機抽樣 / 編隊兩種模式） |
> | `src/data/enemies.ts` | 180 行 | 22 種敵人（10 一般兵 + 12 BOSS）、`TRAIT_COUNTERS`／`TRAIT_LABEL`／`COUNTER_LABEL`、`REGULARS`／`BOSSES`、`countersFor()`、`ANTI_AIR_RANGE` |
>
> **上游依賴**：`core/rng.ts`（`mulberry32` / `pickWeighted`）、`data/glyphs.ts`、`data/generals.ts`、
> `data/enemies.ts`（`ENEMIES` / `ENEMY_BY_KEY` / `REGULARS` / `BOSSES`）、
> `data/levels/index.ts`（`LevelDef.pool` / `hpMul` / `maxWave` / **`bias`**）、
> `sim/combat.ts`（`damageEnemy` / `enemyPos` / `stepCombat` / `SLOW_FACTOR`）、
> `sim/skills.ts`、`sim/bonds.ts`、`sim/events.ts`、`sim/types.ts`（`Perks` / `SpawnEntry` / `EnemyTrait`）。
> **下游使用者**：`core/loop.ts`（唯一呼叫 `stepGame` 的地方，固定 1/60）、`app.ts:102`、
> `tools/autobalance.ts:79`（`npm run sim`）、`sim/actions.ts:300`（`beginBattle` 建波次）、
> `sim/state.ts:143,151`（`createGame` 建字池、注入 `bias`）、`ui/hud.ts:193,196`（顯示花費）、
> `ui/screens.ts:500`（`countersFor(level.bias)` 推導關卡卡片的「建議帶」標籤）。

## 這個模組解決什麼問題

四件事，四條曲線：

1. **難度曲線** — 敵人血量指數成長（`waves.ts:26`），玩家戰力也是指數成長（疊字 ×1.55／階 + 武將 `atkMul`），
   兩條指數曲線要在 12～20 波交叉。`npm run sim` 就是量這個交叉點的儀表板。
2. **質變曲線** — 光是血量變多會讓後期變成同一場仗。`minWave` 讓敵種隨波次陸續開放，
   關卡的 `bias` 再把某一類敵人的比重拉高，讓「這一關該帶什麼」有答案。
3. **經濟曲線** — 糧的三個來源（每波固定收入、場上經濟單位產糧、擊殺賞金）對上兩個支出（征兵、重抽）。
4. **抽卡收斂** — 71 個字全丟進池子的話，「想疊高某個字」或「想湊某個武將」的機率極低。
   三層收斂：**每局字池**（`pool.ts`）→ **熟悉度加權**（`FAMILIAR_BOOST`）→ **心願單**（`WISH_BOOST`）。

## 核心概念

### 難度旋鈕（改動前先讀這段）

| 常數 | 值 | 位置 | 意義 |
|---|---|---|---|
| `BASE_HP` | 20 | `waves.ts:12` | 第 0 波的基準血量（實際從 wave 1 起算，所以最低是 25） |
| `HP_GROWTH` | **1.23** | `waves.ts:26` | 每波血量倍率。**全專案最敏感的旋鈕**，必須貼著玩家戰力的成長率 |
| `WAVE_REF` | **40** | `waves.ts:63` | 難度弧的參考長度。血量指數 = `wave × WAVE_REF / maxWave`，**短關卡因此把同一條弧壓得更陡** |
| `PREP_SECONDS` | 12 | `waves.ts:27` | 佈陣秒數，`createGame` 與 `checkWaveEnd` 共用 |
| `BIAS_WEIGHT` | 4 | `waves.ts:30` | 帶關卡偏好特徵的敵人／BOSS，抽取權重乘這個倍率 |
| `enemyCount` | `6 + ⌊wave×1.4⌋` | `waves.ts:55-57` | 每波敵數（wave 1→7、10→20、20→34、30→48、40→62），**不含 BOSS 與護衛** |
| `gap` | 0.75 秒 | `waves.ts:99` | 出怪間隔，**寫死在 `buildWave` 內的區域變數**，不是匯出常數 |
| `isBossWave` | `wave % 5 === 0` | `waves.ts:59-61` | BOSS 在第 `n×0.75 + 2` 秒追加一隻 |
| `minWave` | 0～25 | `data/enemies.ts` 各筆 | 該敵種／BOSS 最早可以出現的波次 |
| `level.hpMul` | 0.55～1.28 | `data/levels/index.ts` | 關卡難度**微調**，乘在 `buildWave` 內，**不在 `enemyBaseHp` 裡**。整個區間只值約 2 個參考波，真正決定難度弧的是 `maxWave` |
| `level.maxWave` | 12～40 | `data/levels/index.ts` | **同時是關卡長度與難度弧的陡度**（見 `WAVE_REF`）。改短一關 = 把同一條弧壓陡，不是只是少打幾波 |
| `level.bias` | `EnemyTrait[]` | `data/levels/index.ts:43` | 關卡偏好；同時決定敵種比重與 UI 的推薦標籤 |

`enemyBaseHp(wave, maxWave) = 20 × 1.23^(wave × 40/maxWave)`。
**指數吃的是「走完關卡的百分比」，不是絕對波次**，所以：

| 進度 | 12 波的關卡 | 30 波的關卡 | 40 波的關卡 |
|---|---|---|---|
| 走完 25% | 第 3 波，基準 159 | 第 7.5 波，基準 159 | 第 10 波，基準 159 |
| 走完 50% | 第 6 波，基準 1256 | 第 15 波，基準 1256 | 第 20 波，基準 1256 |
| 走完 100% | 第 12 波，基準 78929 | 第 30 波，基準 78929 | 第 40 波，基準 78929 |

同一個進度百分比 → 同一個血量（`core.test.ts` 有測試鎖住）。這就是
**「傻 AI 中位數 ≈ 總波數一半」能對九關同時成立**的機制：陣亡點大約落在弧上的
第 20 個參考波，換算回去就是 `maxWave × 20/40` = 一半。

### ★ 為什麼難度目標不能靠 `hpMul` 達成（踩過的坑）

陣亡波次是**「血量曲線」與「玩家戰力曲線」的交點**，而這兩條線幾乎平行——
實測玩家 dps 前期約 ×1.27／波、後期降到 ×1.12／波，`HP_GROWTH` 是 1.23。
兩條近乎平行的線，垂直平移（也就是 `hpMul`）只會讓交點移動一點點：

```
兩關的陣亡波次差 = ln(hpMul 比值) / ln(HP_GROWTH) × maxWave / WAVE_REF
```

在 1.23 之下，0.55～1.28 這整個 `hpMul` 區間只值 **約 2 個參考波**。
改版前九關的傻 AI 中位數全部擠在 18～21，就是這個原因——**跟關卡長度完全無關**。

⚠ **不要試圖用降低 `HP_GROWTH` 來讓 `hpMul` 更有力**。試過：降到 1.10 之後
血量成長（×1.10）遠低於玩家戰力成長（×1.27），結果是**前期變成不可能、後期變成毫無威脅**
（傻 AI 撐到第 34～40 波）。`HP_GROWTH` 必須貼著玩家戰力的成長率，它不是自由參數。

**`HP_GROWTH` 的調整歷史**（註解在 `waves.ts:13-25`，改動時請一併更新）：

```
1.18 → 1.19（M3 技能與光環）
     → 1.21（M4b 武將可持續疊字，玩家後期戰力變成指數成長）
     → 1.25（射程全域 ×2 後塔覆蓋更長路徑、難度下滑，用血量成長拉回區間）
     → 1.23（敵種擴充後多了回血／分裂／免疫等機制，實質難度上升，往回讓一點）
     → 1.23（維持。經濟改版時試過 1.10，前期爆炸、後期無威脅，已回退——見上一節）
```

改任何數值後**必跑 `npm run sim`**（`tools/autobalance.ts`：傻 AI 打 30 局，印陣亡波次中位數），
調經濟數值則跑 **`npm run econ`**（`tools/econ-report.ts`：逐波印收入拆解與征兵次數）。

**目標是「該關 maxWave 的一半」而不是固定波次**，`autobalance.ts` 會直接把偏差算給你看。
現況基準（25 局）：

| 關卡 | 黃巾 | 董卓 | 巨鹿 | 官渡 | 赤壁 | 五丈原 | 襄陽 | 漢中 | 洛陽 |
|---|---|---|---|---|---|---|---|---|---|
| 總波數 | 12 | 18 | 30 | 24 | 30 | 40 | 32 | 32 | 40 |
| 目標（一半） | 6 | 9 | 15 | 12 | 15 | 20 | 16 | 16 | 20 |
| 傻 AI 中位數 | 6 | 9 | 16 | 13 | 15 | 20 | 17 | 16 | 20 |
| 偏差 | +0% | +0% | +7% | +8% | +0% | +0% | +6% | +0% | +0% |

偏差 ±20% 內算達標。`npm run sim 16 guandu` 可指定局數與關卡。
⚠ **教學關不再是「傻 AI 打得完」**：黃巾現在也照同一條規則，中位數 6／12 波。
`npm run sim` 用預設 meta（無商城道具）→ 全中性 `Perks`，所以**商城道具永遠不影響難度基準**。

### 敵表：一般兵（`data/enemies.ts:54-94`，共 10 種）

`REGULARS = ENEMIES.filter(e => !e.boss)`（`enemies.ts:167`）。波次組成只從這裡抽。
平衡基準：`thief` = `hpMul` 1 / `def` 0 / `speed` 0.95 / `bounty` 1，其餘以它為 1.0 調整。
⚠ `bounty` 是最大的糧食來源（約總收入 65%），改它之前先跑 `npm run econ`。

| key | 字 | `hpMul` | `def` | `speed` | `flying` | `bounty` | `troop` | `minWave` | `traits` | 機制 |
|---|---|---|---|---|---|---|---|---|---|---|
| `thief` | 賊 | 1 | 0 | 0.95 | – | 1 | 步 | – | （無） | 基本雜兵，第 1 波就有 |
| `shield` | 盾 | 1.9 | 45 | 0.7 | – | 2 | 步 | – | `armored` | 高防（`mitigate` 只留 57%），怕貫穿與灼燒 |
| `swift` | 快 | 0.55 | 0 | 2.1 | – | 1 | 騎 | – | `fast` | 移速 2 倍以上，血薄 |
| `flyer` | 飛 | 0.9 | 10 | 1.35 | ✔ | 2 | 弓 | – | `flying` | 只有 `baseRange >= ANTI_AIR_RANGE`(2.0) 的單位打得到 |
| `shaman` | 妖 | 0.8 | 5 | 0.8 | – | 3 | 步 | 6 | `healer` | `healAura` 半徑 2.4、每秒回**目標最大血** 5% |
| `swarmlet` | 蟻 | 0.3 | 0 | 1.5 | – | 1 | 步 | 7 | `swarm` | 血極薄成群；也是兩種分裂與 `bossSwarm` 護衛的產物 |
| `armor` | 甲 | 2.4 | 75 | 0.6 | – | 3 | 步 | 8 | `armored` | 防禦 75（普攻只留 44%）。**灼燒無視防禦，是正解** |
| `splitter` | 裂 | 1.5 | 10 | 0.85 | – | 2 | 步 | 9 | `splitter` | `splitInto` 蟻賊 ×2；純單體輸出會被拖住 |
| `gale` | 疾 | 0.7 | 0 | 2.4 | – | 2 | 騎 | 10 | `fast` | 全場最快的一般兵，且 `slowImmune`（只能定身或爆發） |
| `stone` | 磐 | 4.5 | 30 | 0.4 | – | 4 | 步 | 12 | `tanky` | 極慢極厚，考驗持續輸出總量 |

一般兵 `damage` 全部是 1。**開放時程**（`eligible()`，`waves.ts:64-68`）：

| 波次 | 新開放 | 一般兵池大小 | 無偏好時每種機率 |
|---|---|---|---|
| 1 | 賊／盾／快／飛 | 4 | 25% |
| 6 | 妖道 | 5 | 20% |
| 7 | 蟻賊 | 6 | 16.7% |
| 8 | 甲賊 | 7 | 14.3% |
| 9 | 分裂賊 | 8 | 12.5% |
| 10 | 疾風賊 | 9 | 11.1% |
| 12 起 | 磐石賊 | 10 | 10% |

### 敵表：BOSS（`data/enemies.ts:99-159`，共 12 種）

`BOSSES = ENEMIES.filter(e => e.boss)`（`enemies.ts:170`）。基準：`hpMul` 8～22、`def` 25～95、
`bounty` 10～17、`damage` 2、**全部 `ccImmune`**。設計原則是**每一隻都有一個「必須改變打法」的鉤子**，
而不是只有血量差異。

| key | 字 | `hpMul` | `def` | `speed` | `damage` | `troop` | `minWave` | 特色鉤子 |
|---|---|---|---|---|---|---|---|---|
| `boss` | 將 | 14 | 60 | 0.6 | 2 | 騎 | – | 最基本的首領。只有 `ccImmune`，是 5 波唯一候選 |
| `bossIron` | 甲 | 13 | 95 | 0.5 | 2 | 步 | 10 | `burnImmune` + `def` 95 → **封掉灼燒這條路**，只有高單擊打得動 |
| `bossGale` | 疾 | 9 | 30 | 1.7 | 2 | 騎 | 10 | `slowImmune`，速度 1.7 直接衝過防線；灼燒仍有效 |
| `bossShaman` | 巫 | 11 | 40 | 0.65 | 2 | 步 | 10 | `healAura` 半徑 3.0／每秒 9%，會把整批雜兵一起奶起來 → 必須先集火它 |
| `bossFly` | 翼 | 10 | 35 | 1.1 | 2 | 弓 | 10 | `flying`：沒有 `baseRange >= 2` 的單位**完全打不到** |
| `bossSplit` | 裂 | 12 | 45 | 0.7 | 2 | 步 | 15 | `splitInto` 分裂賊 ×3 → 每隻再裂成 2 蟻賊（兩層分裂，共 6 隻蟻賊） |
| `bossSwarm` | 群 | 10 | 40 | 0.75 | 2 | 步 | 15 | `escort` 蟻賊 ×10，在 `buildWave` 就展開成生成條目 |
| `bossRegen` | 生 | 12 | 50 | 0.6 | 2 | 步 | 15 | `regen` 0.02（每秒回自身最大血 2%）→ 磨血永遠打不死，必須爆發 |
| `bossToxic` | 毒 | 11 | 45 | 0.8 | **3** | 步 | 15 | `damage` 3：漏一隻就扣 3 命，在 2 命關卡等於直接輸 |
| `bossStone` | 磐 | **22** | 55 | 0.35 | 2 | 步 | 20 | 全場最厚（是雜兵的 22 倍）但慢到 0.35，純粹的輸出量測驗 |
| `bossShadow` | 影 | 8 | 25 | **2.0** | 2 | 騎 | 20 | `slowImmune` + `burnImmune`：疾風將還能靠灼燒磨，這隻只能純爆發攔 |
| `bossWarlord` | 霸 | 18 | 80 | 0.7 | **3** | 騎 | 25 | 高血 + 高防 + 不慢 + 3 傷，後期的綜合考驗 |

**BOSS 候選數隨波次成長**（`pickBoss`，`waves.ts:83-86`）：

| BOSS 波 | 新加入 | 候選數 |
|---|---|---|
| 5 | 賊將 | 1（`pickBoss` 仍會抽 1 次 rng） |
| 10 | 鐵甲將／疾風將／妖道首／飛將 | 5 |
| 15 | 分裂將／群將／再生將／毒將 | 9 |
| 20 | 磐石將／影將 | 11 |
| 25 起 | 霸將 | 12 |

### 關卡偏好（`bias`）與推薦標籤

`LevelDef.bias: EnemyTrait[]`（`data/levels/index.ts:35-43`）→ `createGame` 抄進 `state.bias`（`state.ts:151`）
→ `beginBattle` 傳給 `buildWave` 第 4 參數（`actions.ts:300`）。加權在 `weightOf`（`waves.ts:70-72`）：
敵人的 `traits` 只要**命中任一個** bias 特徵，權重就是 `BIAS_WEIGHT`(4)，否則 1。同一份權重也用在 `pickBoss`。

例：襄陽 `bias: ['swarm', 'splitter']`，第 20 波池子 10 種，蟻賊與分裂賊各 4 分、其餘 8 種各 1 分
→ 總權重 16，那兩種各 25%（無偏好時只有 10%）。

`EnemyTrait` 共 7 種（`types.ts:196`）。同一份 `traits` 經 `TRAIT_COUNTERS`（`enemies.ts:28-36`）
推導出關卡卡片上的「建議帶」標籤（`countersFor()`，`enemies.ts:179-185`；顯示在 `ui/screens.ts:500-501`）：

| `EnemyTrait` | `TRAIT_LABEL` | 推導出的 `CounterKind` |
|---|---|---|
| `swarm` | 成群 | `splash`（範圍攻擊）、`pierce`（貫穿） |
| `armored` | 重甲 | `dot`（持續傷害）、`single`（單體高傷） |
| `flying` | 飛行 | `air`（對空） |
| `fast` | 高速 | `cc`（控場） |
| `healer` | 治療 | `single` |
| `splitter` | 分裂 | `splash` |
| `tanky` | 高血 | `dot`、`single` |

**這是單一真相**：關卡不會另外手寫推薦清單。改 `bias` 會同時改變敵種比重與 UI 標籤，
所以「想加一個標籤但不想改難度」是做不到的——那要改 `TRAIT_COUNTERS`。

各關的 `bias`：黃巾 `[]`（教學）／董卓 `flying`／巨鹿 `swarm`／官渡 `fast`／赤壁 `armored`／
五丈原 `healer,tanky`／襄陽 `swarm,splitter`／漢中 `armored,tanky`／洛陽 `flying,fast,healer`。

### 相剋與防禦

相剋（`counterMul`，`combat.ts:32-38`，三向 騎→弓→步→騎，克制 ×1.25 / 被克 ×0.75）。
22 種敵人的兵種分布：

- **步**（16 種）：`thief`／`shield`／`shaman`／`armor`／`splitter`／`swarmlet`／`stone`
  ＋ `bossIron`／`bossShaman`／`bossSplit`／`bossSwarm`／`bossRegen`／`bossToxic`／`bossStone` → **弓系有利**、騎系不利
- **騎**（4 種）：`swift`／`gale` ＋ `boss`／`bossGale`／`bossShadow`／`bossWarlord` → **步系有利**、弓系不利
- **弓**（2 種）：`flyer` ＋ `bossFly` → **騎系有利**、步系不利；另外弓 tag 對飛行還有 ×1.5（`combat.ts:105`）

`def` 只影響 `dealDamage`（走 `mitigate`，`combat.ts:27-29`，`DEF_K` = 60）：
`def` 30 留 67%、45 留 57%、60 留 50%、75 留 44%、80 留 43%、95 留 39%。
**灼燒／中毒走 `damageEnemy` 純扣血、完全無視 `def`**——這就是「高防怕灼燒」的機制原因
（`combat.ts:151-174` vs `combat.ts:177-205`，詳見 `04-combat-and-skills.md`）。

### 經濟公式（全部在 `economy.ts`）

| 項目 | 公式 | 位置 |
|---|---|---|
| 征兵花費 | `max(1, round((8 + ⌊wave×2.4⌋ + 3×recruitsThisWave) × costMul))` | `economy.ts:43-49` |
| 每波固定收入 | `4 + ⌊wave×0.6⌋`，再 ×`incomeMul` | `economy.ts:60-65`／`step.ts:213` |
| 場上產糧 | Σ`u.income`（跳過已組將的字牌），四捨五入 | `economy.ts:43-49` |
| 擊殺賞金 | `round(e.bounty × bountyMul)` | `combat.ts:157` |
| 熔爐重抽 | `max(1, round((4 + ⌊wave/2⌋) × costMul))` | `economy.ts:120-122` |
| 熔爐分解 | 前 3 次 `atk×0.2`，之後 `smeltRefund = atk×0.12` | `actions.ts:122-127`／`economy.ts:115-117` |
| 鏟除退款 | `(baseAtk×0.35 + income×0.5) × SELL_RATIO`（字牌 1.0、已組將 0.3） | `actions.ts:236-237`／`economy.ts:125` |
| 提前開戰獎勵 | `round(prepTimer × 0.5)` 糧 | `actions.ts:290` |

### ★ 經濟的設計目標：一波只夠征兵 1～2 次

這是整個經濟區塊唯一要守住的數字，用 **`npm run econ`** 的「征兵」欄驗收。
現況（9 關、seed 12345）每波平均 **1.20～2.00 次**，全部落在區間內。

收入的三個來源佔比差很多，**調整時要先知道自己在動哪一塊**：

| 來源 | 佔比 | 位置 | 備註 |
|---|---|---|---|
| 擊殺賞金 | ≈65% | `data/enemies.ts` 的 `bounty` | **最大宗**。改這裡的影響遠大於改 `waveIncome` |
| 每波固定收入 | ≈30% | `waveIncome`（`economy.ts:60-65`） | 保底，讓完全沒清乾淨的一波也有進度 |
| 場上產糧 | ≈5% | 字表的 `income` | 玩家主動投資才會變高，是刻意留給經濟流的上升空間 |

⚠ **真正的旋鈕是「收入 ÷ 征兵花費」的比值，不是任何一邊的絕對值。**
`recruitCost` 的波次斜率（2.4）與 `waveIncome` 的斜率（0.6）是一組的，單獨調任何一邊都會破壞目標。

關鍵設計點：**一次征兵費用固定，但會填滿所有空手牌格**（`actions.ts:45-52`）——
手牌越大（兵書可到 8）每次征兵越划算，這是兵書 `handSize` 的真實價值所在。
`recruitsThisWave` 在 `checkWaveEnd`（`step.ts:232`）歸零，所以「同一波連續征兵」會越來越貴（每次 +`RECRUIT_STEP`＝3），跨波則重置。
那個遞增項的用途是**壓掉「某一波突然爆糧就連征四次」的尖峰**——一次征兵填滿整個手牌，連征四次等於一口氣多 20 張牌，節奏會垮。

`bounty` 從 1（蟻賊）到 17（霸將），而蟻賊與分裂物是**免費多出來的擊殺數**
（分裂賊 2 賞金，死後多給 2 隻 ×1）。分裂與護衛因此是「多一點糧、多很多時間壓力」的交換。

### 抽字權重（`rollGlyph`，`economy.ts:95-104`）

```
weight = rarityWeights(wave)[g.rarity - 1]
       × (familiar.has(char) ? FAMILIAR_BOOST(3) × familiarBoostMul : 1)
       × (wishes.includes(char) ? WISH_BOOST(5) : 1)
```

`RARITY_TABLE`（`economy.ts:60-65`）是 **module-private**，公開介面只有 `rarityWeights(wave)`（`economy.ts:67-69`）：

| 波次 | rarity1 | rarity2 | rarity3 | rarity4 |
|---|---|---|---|---|
| ≤5 | 70 | 25 | 5 | 0 |
| ≤12 | 50 | 32 | 15 | 3 |
| ≤20 | 35 | 33 | 24 | 8 |
| 其後 | 25 | 30 | 30 | 15 |

每列合計 100（`__tests__/core.test.ts:97-101` 有測試把關）。字表的稀有度分布：rarity1=5、rarity2=29（含 20 個姓氏）、rarity3=37（含 27 個名字）。
波次越後面越容易抽到姓名字，所以「後期才有機會湊神將」是這張表在推動的。

**`rarity: 4` 是死欄位**：沒有任何字是 rarity 4，`w[3]` 永遠不會被讀到。
第 4 欄留著是為了將來加「傳說級單字」，在那之前**調它一點效果都沒有**（`economy.ts:67-69`）。

### 字池的三分法（`pool.ts`）

| 集合 | 內容 | 數量 | 行為 |
|---|---|---|---|
| `ALWAYS` | `category` 為 `weapon` + `troop` | 13 | **永遠在池內**。骨幹，也是「○兵」部隊配方的來源 |
| `SUPPORT` | `strategy` + `economy` | 11 | 抽 `level.pool.support` 個（2～8） |
| `NAMED_RECIPES` | 配方字**全部**是 `surname`／`given` 的武將 | 26 | 抽 `level.pool.generals` 組（3～10），**整組配方的字一起加入** |

`NAMED_RECIPES` 的過濾條件在 `pool.ts:51-56`（逐字查 `GLYPHS` 的 category），所以「○兵」12 支部隊、
`火計`／`毒計`／`雷陣`／`風令`／`屯田` 這 5 個非姓名配方**不參與抽樣**——它們的材料本來就在 `ALWAYS`／`SUPPORT` 裡。

**為什麼要成組加入**：如果逐字抽，池子裡會出現「張」但沒有「飛」的孤兒字——玩家永遠湊不成那個武將，
抽到就只是廢牌。成組加入保證池裡每個姓名字都至少屬於一個可完成的配方，同時池子變小也讓同一個字更容易重複抽到（利於疊階）。
`finish()`（`pool.ts:96-99`）反算「本局可湊出哪些武將」寫進 `poolGenerals` 給 UI 顯示。

### 編隊模式（`buildLoadoutPool`，`pool.ts:75-93`）

`meta.loadoutActive` 為真時，`createGame`（`state.ts:139-143`）傳入 `LoadoutConfig`，
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

### `stepGame` 的完整執行順序（`step.ts:15-39`）

| # | 行 | 步驟 | 為什麼在這個位置 |
|---|---|---|---|
| 0 | 16 | `phase === 'won' \|\| 'lost'` → **return** | 遊戲結束後整棵 state 凍結，包含 `state.time` |
| 1 | 17 | `state.time += dt` | 在 prep 分支之前 → 佈陣階段時間也在走 |
| 2 | 19-24 | **prep 分支**：`prepTimer -= dt`；≤0 → `beginBattle(state)`；`stepEffects`；**return** | 佈陣期只跑特效衰減。`beginBattle`（`actions.ts:296-301`）設 `phase='battle'`、`waveTime=0`、**`spawnQueue = buildWave(wave, rng, hpMul, bias)`（消耗 rng）**。當幀立刻 return，所以第一隻敵人在下一幀才生成 |
| 3 | 26 | `state.waveTime += dt` | 生成時刻的唯一時間基準（不是 `state.time`） |
| 4 | 27 | 所有單位 `atkFlash -= dt` | 純視覺；刻意只在戰鬥階段衰減 |
| 5 | 28 | `spawnDue`（`step.ts:99-104`） | **最前面**：新生成的敵人當幀就吃狀態、會移動、會被打，不空轉一幀。生成一律走 `makeEnemy` |
| 6 | 29 | `stepStatuses`（`step.ts:133-146`） | **必須在 `moveEnemies` 之前**：定身／減速倒數與 `moveEnemies` 的讀取同幀一致，`stun` 才能當幀生效；灼燒傷害也先結算，被燒死的敵人不會再被索敵 |
| 7 | 30 | **`stepEnemySupport`**（`step.ts:111-130`） | **必須緊接在 `stepStatuses` 之後**：灼燒先扣血、回血後補，兩者在同一幀正面對撞，淨 dps 才是玩家實際感受到的數字。更關鍵的是**順序不能反過來**——`stepEnemySupport` 用 `hp <= 0` 過濾（`step.ts:113`、`step.ts:123`），所以被灼燒燒死的敵人**不會被光環奶回來**；若放在 `stepStatuses` 之前，同一幀就會出現「先奶滿再燒」的無限拉鋸。另外它讀 `enemyPos` 算光環半徑，放在 `moveEnemies` 之前 → 用的是與 `stepStatuses` 同一組位置 |
| 8 | 31 | `moveEnemies`（`step.ts:148-172`） | 敵人先移動再讓塔索敵 → 射程判定用的是**當幀最新位置**，不是上一幀的殘影 |
| 9 | 32 | `stepCombat` | 在回血之後 → `targeting: 'strong'` 挑的是**回血後**的血量，不會被光環騙 |
| 10 | 33 | `stepSkills` | 武將主動技在普攻之後 → 技能看到的是本幀扣血後的血量（狙擊類技能選目標才正確） |
| 11 | 34 | `stepBondSkills` | 羈絆組合技排在單體技之後 |
| 12 | 35 | `stepMeteor`（`step.ts:45-69`） | 局外道具的傷害源，最後補刀 |
| 13 | 36 | `stepEffects` | 特效壽命衰減，放在所有 `pushEffect` 之後，新特效才有完整一幀壽命 |
| 14 | 37 | `cleanupDead`（`step.ts:187-207`） | 移除 `hp <= 0`（含漏過的敵人，它們被設成 `hp = 0`），**並在此處理死亡分裂**——見下節 |
| 15 | 38 | `checkWaveEnd`（`step.ts:209-235`） | **必須在 `cleanupDead` 之後**：條件是 `spawnQueue.length === 0 && enemies.length === 0`，屍體沒清掉波次永遠不會結束；分裂出的小怪也是在這之前才進場，否則波次會提早結束 |

### 敵種機制的實作位置與陷阱

四個新機制分佈在三個檔案，**沒有一個是「BOSS 專屬」的路徑**——`stepEnemySupport` 與 `cleanupDead`
都只是查 `ENEMY_BY_KEY[e.defKey]`，所以一般兵（妖道、分裂賊）與 BOSS 共用同一組鉤子。

| 機制 | `EnemyDef` 欄位 | 實作位置 |
|---|---|---|
| 回血光環 | `healAura: { radius, hps }` | `stepEnemySupport`（`step.ts:120-128`） |
| 自我再生 | `regen`（每秒比例） | `stepEnemySupport`（`step.ts:116-118`） |
| 死亡分裂 | `splitInto: { key, count }` | `cleanupDead`（`step.ts:187-207`） |
| 護衛 | `escort: { key, count }` | `buildWave`（`waves.ts:111-118`），**生成期展開，不是 runtime** |
| 免疫 | `burnImmune` / `slowImmune` / `ccImmune` | `makeEnemy` 複製（`step.ts:86-88`）→ `applyStatus`（`combat.ts:214-238`） |

**1. 回血與再生一律是「最大血量的比例」，不是絕對值。**
`regen`：`e.hp = min(e.maxHp, e.hp + e.maxHp × def.regen × dt)`（`step.ts:117`）；
`healAura` 同式，但用的是**被治療者自己的 `maxHp`**（`step.ts:126`）。
理由跟 `stepMeteor` 把傷害綁 `enemyBaseHp` 完全一樣（`step.ts:56`）：血量是 `20 × 1.23^wave` 的指數成長，
任何寫死的「每秒回 30 血」在第 10 波（雜兵 159 血）強得離譜、在第 30 波（雜兵 9958 血）等於 0。
比例制讓「再生將每秒回 2%」在任何波次都是同一個相對強度，也讓平衡只需要看一個數字。
副作用是**它跟玩家的 dps 直接對打**：`regen` 0.02 等於要求玩家對那隻的有效 dps > 該波血量的 2%。

`healAura` 的三個跳過條件（`step.ts:123`）：不奶自己、不奶死人、不奶滿血的。
第二個是安全性（見上一節），第三個純粹是省迴圈。

**2. 死亡分裂必須在 `cleanupDead` 做，絕對不能在傷害來源那邊 push。**
`stepCombat`／`stepStatuses`／`stepSkills` 都在 `for (const e of state.enemies)` 迭代中，
當場 `push` 會讓「剛分裂出來的小怪在同一幀又被同一輪迴圈打死、再分裂」——同幀連鎖增殖。
`cleanupDead` 是每幀唯一一次、且在所有傷害結算之後的安全點（註解在 `step.ts:174-186`）。

- **允許多層分裂**：分裂將 → 分裂賊 ×3 → 蟻賊 ×2（共 6 隻蟻賊）。子代死亡是在**後續的幀**才結算，
  每一層都各自走過一次完整的傷害流程，所以不會在同一幀爆炸性增殖。
- 安全性靠**「分裂圖必須是無環的有限圖」**保證——蟻賊沒有 `splitInto`，鏈一定終止。
  ⚠ 新增 `splitInto` 時**絕對不能形成環**（A→B→A 會無限增殖）；`enemies-ext.test.ts:103` 有測試驗證無環且深度有限。
- 子代血量：`(e.maxHp / 母體 hpMul) × 子代 hpMul`（`step.ts:199`）——從母體的**出生血**反推出該波的 base，
  子代血量才會跟著波次成長。⚠ 這條反推假設 `maxHp` 永遠等於出生血；將來若加「生成後提升最大血」的機制，這裡要改。
- 子代沿路徑倒退 `0.25 × i` 散開（`step.ts:201`），避免完全重疊在一點。

**3. 漏過大營的敵人不會分裂。** `cleanupDead` 的 `e.dist >= state.board.path.length - 1` 檢查（`step.ts:195`）。
`moveEnemies` 是用 `hp = 0` 來表示「漏過了」（`step.ts:157`），跟被打死的敵人走同一條清理路徑。
若不擋這一條，分裂賊每次漏過就會**在終點刷出一批一出生就必漏的小怪**，連環扣命直到 `lives` 見底。

**4. 灼燒無視防禦，`burnImmune` 是唯一能封掉這條路的手段。**
灼燒每幀走 `damageEnemy(state, e, e.burnDps * dt)`（`step.ts:142`）——`damageEnemy`（`combat.ts:151-174`）
是純扣血，**不經過 `mitigate`**。於是 `def` 95 的鐵甲將對普攻只吃 39% 傷害，對灼燒吃 100%。
所以「高防」的設計正解是持續傷害或高單擊，而不是多打幾下（`enemies.ts:14-16` 的註解就是在講這件事）。
`bossIron` 與 `bossShadow` 帶 `burnImmune`，把這條捷徑收掉、逼玩家改帶高單擊。

`applyStatus`（`combat.ts:214-238`）的三種免疫各擋不同的東西：

| 免疫 | 擋掉 | 行 | 誰有 |
|---|---|---|---|
| `slowImmune` | `slowDur` | `combat.ts:215` | `gale`／`bossGale`／`bossShadow` |
| `burnImmune` | `onHit.burn`（`burnT`＋`burnDps`） | `combat.ts:217-220` | `bossIron`／`bossShadow` |
| `ccImmune` | `stunDur` 與 `knock` | `combat.ts:221-224` | 全部 12 隻 BOSS |
| （無） | `vulnDur`（易傷） | `combat.ts:216` | **刻意不給任何免疫** |

易傷不可免疫是設計決定：否則控場流會完全失去對 BOSS 的作用，只剩純傷害流一條路。

⚠ 免疫在 `makeEnemy` 時就從 `EnemyDef` 複製進 `Enemy`（`step.ts:86-88`），不是每次查表。
新增一種免疫要**同時**改三處：`types.ts` 的 `EnemyDef`、`types.ts` 的 `Enemy`、`makeEnemy`。
漏了 `makeEnemy` 那一行會**靜默失效**（欄位是 `undefined`，`!e.xxxImmune` 恆為真）。

**5. `escort` 是生成期展開，不是 runtime 行為**（`waves.ts:111-118`）。護衛只是被塞進 `spawnQueue` 的普通條目，
血量用「該波 base × 護衛自己的 `hpMul`」，出場時間 `at + 0.15 × i` 錯開。兩個推論：
護衛**不消耗額外 rng**；護衛**不受 `minWave` 限制**（`bossSwarm` 的 `minWave` 15 > 蟻賊的 7，
目前不會出事，但將來若讓早期 BOSS 帶後期護衛就會繞過開放時程）。

### `checkWaveEnd`（`step.ts:209-235`）的結算順序

```
1. 若 spawnQueue 或 enemies 非空 → 直接 return
2. lastIncome = { base: waveIncome(wave) × incomeMul, units: unitIncome(state) }（供 UI 顯示）
3. food += base + units
4. wave >= maxWave → phase='won'、emit('won')、return   ← 通關那一波不觸發回血
5. 杏林春暖：wave % healEveryWaves === 0 且 lives < maxLives → lives+1（用**遞增前**的 wave 判定）
6. emit('waveClear')、wave++、recruitsThisWave=0、phase='prep'、prepTimer=PREP_SECONDS
```

### `moveEnemies`（`step.ts:148-172`）的漏怪處理

```
stun > 0 → 當幀完全不前進
dist += speed × (slow>0 ? SLOW_FACTOR(0.5) : 1) × perks.enemySpeedMul × dt
dist >= path.length-1 → hp=0、dist 夾到終點、stats.leaks++、emit('leak')
                      → rng() >= leakBlockChance 時才 lives -= e.damage
                      → lives <= 0 → phase='lost'、emit('lost')
```

回魂旗擋下時**仍計 `stats.leaks`**，只是不扣命。`e.damage` 現在不只是 1：`bossToxic` 與 `bossWarlord` 是 3、
其餘 BOSS 是 2，所以在 2 命的關卡（五丈原、洛陽）漏一隻毒將就直接輸。

### `stepMeteor`（`step.ts:45-69`）

`perks.meteorInterval <= 0` 直接 return（未購買時零成本）。倒數 `meteorTimer` 初值＝間隔（`state.ts:184`），
歸零時用 `+=` 補回間隔（不是重設）以避免長期漂移。目標是 `dist` 最大（最前方）那隻，
對其周圍 **1.5 格**內全體造成 `0.7 × enemyBaseHp(wave) × hpMul` 傷害，並施加 3 秒、dps 為傷害 12% 的灼燒。

**傷害為什麼綁 `enemyBaseHp(wave)`**：血量是指數成長的，任何寫死的固定傷害在 10 波後就等於 0。
綁上去之後，這一發永遠等於「一隻該波雜兵的 70% 血量」，前後期威力感一致。
`hpMul` 也要乘，否則高難度關卡的相對威力會被 `level.hpMul` 稀釋。

⚠ `stepMeteor` 的灼燒**直接寫 `e.burnT`／`e.burnDps`**（`step.ts:62-63`），沒有經過 `applyStatus`，
所以**它無視 `burnImmune`**。這是目前唯一能燒到鐵甲將／影將的來源，屬於既有行為；
要改成尊重免疫的話，這裡要改走 `applyStatus`，並重跑 `npm run sim`。

## 契約與陷阱

1. **模擬固定 1/60 步長**。`stepGame` 的 `dt` 一律是 `FIXED_DT`（`core/loop.ts:5`），由 `core/loop.ts:32-36` 的累加器驅動。
   **`sim/` 內不可讀 `performance.now()`／`Date.now()`**（只有 `core/loop.ts` 可以）——否則 `npm run sim` 與單元測試（都是直接 for 迴圈呼叫 `stepGame`）會失真。
   另外掉幀保護會丟棄累加器（`loop.ts:37`），所以 `sim/` 也不可假設真實時間連續。

2. **`buildWave` 會消耗 `rng`：每波 `enemyCount(wave)` 抽（每隻敵人一抽，`waves.ts:102`），BOSS 波再多 1 抽（`pickBoss`，`waves.ts:107`）**。
   ⚠ **這與敵種擴充前不同**（舊版是「每波恰好 `enemyCount` 抽、BOSS 不抽」），所以**所有舊種子的對局內容都變了**——
   引用歷史 `npm run sim` 數字時要注意這道斷點。第 5 波即使只有賊將一個候選，`pickBoss` 仍然照抽 1 次（`pickWeighted` 無條件呼叫 `rng()`）。
   護衛的展開**不消耗** rng。
   ⚠ **要做「波次預覽」時不可以直接呼叫 `buildWave(state.wave + 1, state.rng, ...)`**——那會讓整條亂數流位移，
   破壞同種子重現性，並讓 `npm run sim` 的難度數字與實際遊戲不一致。正確做法二選一：
   - 在 `createGame` 時就把整局 `maxWave` 波預先算好存進 state（順序與現在一致，行為完全不變）；
   - 或給預覽用一條獨立的 rng（`mulberry32(seed ^ wave)`），與 `state.rng` 完全隔離。
   擴充方向見 `06-roadmap.md`。

3. **其他「無條件消耗 rng」的地方**（改動時要意識到自己在移動亂數流）：
   - `recruit` 每張牌 2 抽：`rollGlyph` 1 抽 + 精兵符判定 1 抽，**即使 `recruitEliteChance` 是 0 也會抽**（`actions.ts:47,49`）。
   - `moveEnemies` 每次漏怪 1 抽，**即使 `leakBlockChance` 是 0 也會抽**（`step.ts:162`）。
   - 對照組：爆擊判定用 `critChance > 0 &&` 短路，中性值時**不**消耗（`combat.ts:187`）。這個不一致是既有行為，改任何一邊都會讓所有既有種子的對局內容改變。

4. **編隊模式一次都不消耗 rng**（`pool.ts:59` 直接 return），隨機模式則消耗 `support + generals` 抽。
   所以**同一顆種子在「有／沒有啟用編隊」下不是同一場對局**（`pool.ts:13-16`）。這不違反重現性，但回報 bug 時必須連 meta 一起說。

5. **已成為武將成員的字牌不重複計算**。同一條規則散落**三處**，任何新增的「逐單位聚合」都要跳過 `u.kind === 'glyph' && u.formIds.length > 0`，
   否則會**靜默地**重複計算（沒有測試會抓到）：
   - 產糧：`src/sim/economy.ts:45`
   - 攻擊：`src/sim/combat.ts:250`
   - 光環投射：`src/sim/state.ts:415`

   第四個聚合（例如「全場攻擊力總和」的 UI、或新的每波結算項目）必須自己加上同樣的判斷。

6. **敵種開放由各敵人的 `minWave` 決定，不是硬編碼的時程表**（`eligible()`，`waves.ts:64-68`）。
   `composition(wave)` 現在只是 `eligible(REGULARS, wave)` 的薄包裝（`waves.ts:78-80`），
   `REGULARS`／`BOSSES` 又是從 `ENEMIES` 過濾出來的（`enemies.ts:167,170`）——
   **所以新增敵種只要改 `data/enemies.ts`，不需要動 `waves.ts`**（這與擴充前的規則相反，舊文件說要改兩處）。
   要注意的反而是這幾點：
   - `traits` 是**必填**欄位（`types.ts:216`）。填空陣列（像 `thief`）代表「不受任何 `bias` 加權」；填錯會讓關卡卡片的推薦標籤撒謊。
   - `minWave` 太高會讓敵種在短關卡永遠不出現（黃巾只到 12 波，`stone` 的 `minWave` 12 只趕上最後一波）。
   - `eligible()` 有一道防呆：全部被 `minWave` 擋掉時退回 `pool[0]`（`waves.ts:67`）。
     這依賴 `ENEMIES` 的**宣告順序**——第一筆一般兵必須是 `thief`、第一筆 BOSS 必須是 `boss`，別隨意重排表格頂端。

7. **`rarity: 4` 目前是死的**（見上）。`RARITY_TABLE` 是 module-private，外部一律用 `rarityWeights()`。

8. **`level.hpMul` 只在兩個地方被乘**：`buildWave`（`waves.ts:96`）與 `stepMeteor`（`step.ts:56`）。
   `enemyBaseHp()` 本身**不含** `hpMul`——新增任何「跟著波次成長」的傷害或血量時要記得自己乘。
   分裂子代是例外中的例外：它從母體 `maxHp` 反推（`step.ts:199`），`hpMul` 已經內含在裡面，不要再乘一次。

9. **`rollGlyph` 的 pool 過濾是 `ctx.pool.includes(g.char)`**（`economy.ts:97`）：
   池子裡出現不在 `GLYPHS` 的字會被**靜默忽略**；`ctx.pool` 為空陣列時退回全表（`?.length` 的短路）。
   `pickWeighted` 在總權重為 0 時會回傳**最後一個**候選（`core/rng.ts:31-40`），不會拋錯——
   新增 rarity 時別讓某一波的所有權重同時為 0。同一個 `pickWeighted` 也用在敵種抽取，
   所以 `weightOf` 也不能回傳 0（目前最小是 1，安全）。

10. **perks 的介入點清單**（`Perks` 定義在 `types.ts:342`，由 `data/shop.ts` 的 `perksFrom()` 推導，`createGame` 注入一次、整局固定）。
    本模組只碰這幾個，其餘（`atkMul`／`apsMul`／`critChance`／`splashMul`／`bountyMul`／`rangeMul`／`cdMul`）在 combat／state 那一層：

    | perk | 介入點 | 中性值 |
    |---|---|---|
    | `costMul` | `recruitCost`（`economy.ts:23`）、`rerollCost`（`economy.ts:121`） | 1 |
    | `familiarBoostMul` | `rollGlyph`（`economy.ts:100`），與 `FAMILIAR_BOOST` 相乘 | 1 |
    | `recruitEliteChance` | `recruit`（`actions.ts:49`） | 0 |
    | `incomeMul` | `checkWaveEnd`（`step.ts:213`），**只影響固定收入、不影響產糧** | 1 |
    | `healEveryWaves` | `checkWaveEnd`（`step.ts:222-229`） | 0 |
    | `enemySpeedMul` | `moveEnemies`（`step.ts:155`） | 1 |
    | `leakBlockChance` | `moveEnemies`（`step.ts:162`） | 0 |
    | `meteorInterval` | `stepMeteor`（`step.ts:46-49`） | 0 |
    | `extraLives` | `createGame`（`state.ts:165-166`） | 0 |

    **新增 perk 的鐵則**：中性值必須讓行為與「沒有這個 perk」逐位元相同（倍率 1／機率 0／間隔 0），
    否則 `npm run sim` 的難度基準與所有既有種子都會漂移。
    ⚠ 敵方的回血／再生**刻意沒有對應的 perk**——沒有「減少敵人回血」的道具，玩家只能用 dps 硬碰。

11. **`sim/` 不得 import render/ui/input/DOM**（`step.ts:3` 的註解就是在講這件事）。
    音效與粒子一律用 `emit(state, ...)` 推事件（`step.ts:66,160,167,219,230`），由 app 層每幀 drain；
    `pushEffect` 是 sim 內的視覺佇列，有 240 上限保護（`combat.ts:242`）。
    ⚠ **分裂與回血刻意不 emit 任何事件**：分裂一次可能生出 6 隻、回血是每幀發生，
    emit 會把事件佇列與音效淹掉。要加音效的話請只在 `cleanupDead` 對「母體」emit 一次，不要對每隻子代 emit。

12. `checkWaveEnd` 的通關判定在回血之前（`step.ts:217-221`），所以**通關那一波不會觸發杏林春暖**；
    回血用的是遞增**前**的 `state.wave`。改這段時注意別把 `wave++` 移到前面。

13. **`data/enemies.ts` 的檔頭與 BOSS 區段註解各自抄了一份數字**（`enemies.ts:2` 的 `HP_GROWTH`、
    `enemies.ts:97` 的 BOSS 基準區間）。它們只是導讀，**唯一真相是 `waves.ts:26` 與敵表本身**；
    調 `HP_GROWTH` 或新增落在區間外的 BOSS 時要順手同步這兩行，否則下一個讀者會照著錯的基準配數值。

## 我想改 X → 動哪裡

| 想改什麼 | 動哪裡 | 注意 |
|---|---|---|
| **單關太硬／太軟** | 該關的 `maxWave`（`data/levels/index.ts`） | ★ 第一順位。`maxWave` 同時是長度與弧的陡度，中位數會自動跟著變成新的一半 |
| 整體難度（全部關卡一起） | `HP_GROWTH`（`waves.ts:26`） | 指數項，動 0.01 就很有感。**但它必須貼著玩家戰力的成長率**，不是自由參數（見上面的坑）。改完跑 `npm run sim` 九關並更新歷史註解與基準表 |
| 單關的最後微調 | 該關的 `hpMul` | 整個區間只值約 2 個參考波，只拿來修 ±20% 以內的偏差 |
| 前期難度 | `BASE_HP`（`waves.ts:12`）或 `level.startFood`／`lives` | `BASE_HP` 是線性項，前期影響大、後期被指數吃掉 |
| 單關難度 | `data/levels/index.ts` 的 `hpMul`／`maxWave`／`lives` | 只影響一關，是最安全的旋鈕 |
| 敵人數量／出怪節奏 | `enemyCount`（`waves.ts:55-57`）、`gap`（`waves.ts:99`） | `gap` 是區域變數；縮小它會同時縮短整波長度與玩家的反應窗口 |
| BOSS 頻率 | `isBossWave`（`waves.ts:59-61`） | 也決定 `pickBoss` 的呼叫頻率，改它會移動整條 rng 流 |
| BOSS 強度／組成 | `data/enemies.ts` 的 BOSS 那一段（`enemies.ts:99-159`） | 現在是**隨機挑一隻**，所以「BOSS 有多強」是分布而非單值。調某一隻只影響它出現的那些波 |
| **新增敵種（一般兵）** | 只改 `data/enemies.ts` 的 `ENEMIES`（一般兵區段） | **不用改 `waves.ts`**——`REGULARS` 自動收（`enemies.ts:167`）。`traits` 必填、設好 `minWave`；`troop` 決定相剋；`flying` 需要 `baseRange >= 2` 才打得到 |
| **新增 BOSS** | 同一張表，加 `boss: true` + `minWave` | `BOSSES` 自動收（`enemies.ts:170`）。基準：`hpMul` 8～22、`ccImmune: true`、`damage` 2+。**請給它一個機制鉤子**（免疫／光環／分裂／護衛），只加血量等於沒加內容 |
| **調整關卡偏好** | `data/levels/index.ts` 的 `bias` | 同時改變敵種比重**與**關卡卡片的「建議帶」標籤（`ui/screens.ts:500`）——不要另外手寫推薦清單 |
| 偏好的強度 | `BIAS_WEIGHT`（`waves.ts:30`） | 4 的意思是「帶該特徵的敵人比重 ×4」。調高會讓關卡個性更鮮明但變化更少 |
| 新增 `EnemyTrait` | `types.ts:196` ＋ `TRAIT_COUNTERS`（`enemies.ts:28-36`）＋ `TRAIT_LABEL`（`enemies.ts:47-55`） | 後兩者是 `Record<EnemyTrait, …>`，漏填 tsc 會擋下來（這是刻意的） |
| 新增 `CounterKind`（推薦手段） | `types.ts:199` ＋ `COUNTER_LABEL`（`enemies.ts:38-45`） | 只影響 UI 文案，不影響模擬 |
| 敵種的解鎖時程 | 各敵人的 `minWave` | 短關卡（黃巾 12 波）看不到高 `minWave` 的敵種；別把第一筆 `thief`／`boss` 加上 `minWave`（`eligible` 的防呆依賴它們） |
| 回血／再生強度 | `healAura.hps`、`regen`（`data/enemies.ts`） | 兩者都是「每秒最大血量比例」，等於直接對玩家 dps 設門檻。刻意沒有反制的 perk |
| 死亡分裂 | `splitInto`（`data/enemies.ts`） | ⚠ **不能形成環**（`enemies-ext.test.ts:103` 會擋）。子代血量由母體反推（`step.ts:199`），不要另外乘 `hpMul` |
| BOSS 護衛 | `escort`（`data/enemies.ts`） | 在 `buildWave` 展開（`waves.ts:111-118`），不消耗 rng、**不受 `minWave` 限制** |
| 灼燒能不能打穿高防 | 不要改 `damageEnemy`；用 `burnImmune` | 「灼燒無視防禦」是全局設計前提，改它會連帶影響所有火系字與技能的定位 |
| 對空門檻 | `ANTI_AIR_RANGE`（`enemies.ts:173`） | 比對的是 `u.baseRange`（未乘 `RANGE_MUL`），刻意如此（`combat.ts:96-101`） |
| 在主迴圈插入「敵人自己做的事」 | `stepEnemySupport`（`step.ts:111-130`） | 已經在正確的位置（`stepStatuses` 後、`moveEnemies` 前）。新行為記得跳過 `hp <= 0`，否則會把本幀燒死的敵人救回來 |
| 征兵／重抽花費 | `economy.ts:43-49`、`economy.ts:120-122` | 一次征兵填滿所有空格，改花費等於改「手牌大小的價值」 |
| **一波能征幾次兵** | `waveIncome` 的斜率（`economy.ts:60-65`）與 `recruitCost` 的斜率（`economy.ts:43-49`）**成對調** | ★ 設計目標 1～2 次，用 `npm run econ` 驗收。單獨調一邊會破壞比值 |
| 擊殺獎勵的份量 | `data/enemies.ts` 的 `bounty` | 佔總收入約 65%，是「滾雪球速度」的主力旋鈕 |
| 每波收入／產糧 | `waveIncome`（`economy.ts:60-65`）、字表的 `income`（`data/glyphs.ts`）、`屯田` 的 `income`（`generals.ts:80`） | 經濟字產出是 `income × 品質階級`（線性，`state.ts:242`），不是指數 |
| 抽卡稀有度曲線 | `RARITY_TABLE`（`economy.ts:60-65`） | 每列合計必須是 100（有測試）。第 4 欄無效 |
| 抽卡收斂強度 | `FAMILIAR_BOOST`（`economy.ts:76`）、`WISH_BOOST`（`economy.ts:82`） | 兩者相乘。調高會讓對局更容易滾雪球 |
| 每局字池大小 | `data/levels/index.ts` 的 `pool: { support, generals }` | `generals` 是「幾組配方」，不是幾個字（一組 2～3 字） |
| 哪些字永遠在池內 | `ALWAYS`／`SUPPORT`（`pool.ts:48-49`），改的是 `category` 的分類 | 新增 `category` 時要同時檢查這兩行與 `NAMED_RECIPES` 的判斷 |
| 編隊行為 | `buildLoadoutPool`（`pool.ts:75-93`）、`data/loadout.ts` | 別加「保證有攻擊單位」的安全網（刻意的設計決定，見 `pool.ts:84-89`） |
| 佈陣秒數 | `PREP_SECONDS`（`waves.ts:27`） | 同時影響 `createGame` 初值與每波結算 |
| 在主迴圈插入新步驟 | `stepGame`（`step.ts:26-38`） | 對照上面的順序表挑位置：讀敵人狀態的放 `stepStatuses` 之後、`cleanupDead` 之前；`cleanupDead` 之後看不到本幀死亡、漏過與剛分裂出來的敵人 |
| 波次預覽／關卡地圖預告 | **不要**直接呼叫 `buildWave` | 見陷阱 2 的兩種正確做法 |
| 新增局外被動 | `data/shop.ts` 的 `SHOP` + `NEUTRAL_PERKS`（`shop.ts:230`）+ `types.ts` 的 `Perks`，再在本模組的介入點讀取 | 中性值必須零影響（陷阱 10） |

## 相關頁面

- `04-combat-and-skills.md` — 索敵、`dealDamage`／`damageEnemy` 的差別、相剋與控場、主動技與組合技
- `05-meta.md` — 兵書、商城（`Perks` 的來源）、編隊 UI、聲望與圖鑑
- `06-roadmap.md` — 波次預覽等未實作方向（敵種擴充已於 2026-07-29 完成，見該頁「已完成」）
- `../01-architecture.md` — 分層與依賴方向、字牌與武將的關係
- `../02-data-tables.md` — 字表／配方表／敵表的欄位語意與平衡基準
- `../04-invariants.md` — 七條不可違反的規則全文與已知陷阱總表
