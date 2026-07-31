# 經濟、波次與模擬主迴圈

> **負責檔案**
>
> | 檔案 | 規模 | 職責 |
> |---|---|---|
> | `src/sim/step.ts` | 391 行 | `stepGame` 主迴圈：生成／**督戰（卡波保險）**／狀態／敵方支援（光環與其疊加上限）／移動／戰鬥／技能／流星／清屍與死亡分裂／波次結算 |
> | `src/sim/waves.ts` | 177 行 | 血量曲線（`HP_GROWTH`）、數量與其上限、`minWave` 開放、`bias` 加權、`maxShare` 佔比上限、`pickBoss`、`buildWave` |
> | `src/sim/economy.ts` | 106 行 | 征兵／重抽花費、每波收入、抽字權重（稀有度＋熟悉度＋心願）、退款 |
> | `src/sim/pool.ts` | 99 行 | 每局字池（隨機抽樣 / 編隊兩種模式） |
> | `src/data/enemies.ts` | 211 行 | 24 種敵人（11 一般兵 + 13 BOSS）、`TRAIT_COUNTERS`／`TRAIT_LABEL`／`COUNTER_LABEL`、`REGULARS`／`BOSSES`、`countersFor()`、`ANTI_AIR_RANGE` |
>
> **上游依賴**：`core/rng.ts`（`mulberry32` / `pickWeighted`）、`data/glyphs.ts`、`data/generals.ts`、
> `data/enemies.ts`（`ENEMIES` / `ENEMY_BY_KEY` / `REGULARS` / `BOSSES`）、
> `data/levels/index.ts`（`LevelDef.pool` / `hpMul` / `maxWave` / **`bias`**）、
> `sim/combat.ts`（`damageEnemy` / `enemyPos` / `stepCombat` / `SLOW_FACTOR`）、
> `sim/skills.ts`、`sim/bonds.ts`、`sim/events.ts`、`sim/types.ts`（`Perks` / `SpawnEntry` / `EnemyTrait`）。
> **下游使用者**：`core/loop.ts`（唯一呼叫 `stepGame` 的地方，固定 1/60）、`app.ts:108`、
> `tools/autobalance.ts:79`（`npm run sim`）、`sim/actions.ts:307`（`beginBattle` 建波次）、
> `sim/state.ts:152,151`（`createGame` 建字池、注入 `bias`）、`ui/hud.ts:194,196`（顯示花費）、
> `ui/screens.ts:572`（`countersFor(level.bias)` 推導關卡卡片的「建議帶」標籤）。

## 這個模組解決什麼問題

四件事，四條曲線：

1. **難度曲線** — 敵人血量指數成長（`waves.ts:32`），玩家戰力也是指數成長（疊字 ×1.55／階 + 武將 `atkMul`），
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
| `BASE_HP` | **32** | `waves.ts:18` | 第 0 波的基準血量。**線性項**：整條曲線等比例上下移，所以它是抵銷「玩家整體戰力變了」的對應旋鈕（`HP_GROWTH` 管成長率、它管水位） |
| `HP_GROWTH` | **1.23** | `waves.ts:32` | 每波血量倍率。**全專案最敏感的旋鈕**，必須貼著玩家戰力的成長率 |
| `WAVE_REF` | **40** | `waves.ts:51` | 難度弧的**參考**長度：`arc = 40` 就是「走完整條弧」。也是省略 `arc` 與無盡模式的預設值 |
| `PREP_SECONDS` | 12 | `waves.ts:33` | 佈陣秒數，`createGame` 與 `checkWaveEnd` 共用 |
| `BIAS_WEIGHT` | 4 | `waves.ts:36` | 帶關卡偏好特徵的敵人／BOSS，抽取權重乘這個倍率 |
| `enemyCount` | `min(6 + ⌊wave×1.4⌋, 90)` | `waves.ts:74-76` | 每波敵數（wave 1→7、10→20、20→34、30→48、40→62），**不含 BOSS 與護衛** |
| `MAX_WAVE_ENEMIES` | 90 | `waves.ts:72` | 單波敵數上限。**只為無盡模式存在**（有限關卡最多 62 隻，碰不到），到頂後成長全交給血量指數 |
| `gap` | 0.75 秒 | `waves.ts:139` | 出怪間隔，**寫死在 `buildWave` 內的區域變數**，不是匯出常數 |
| `isBossWave` | `wave % 5 === 0` | `waves.ts:78-80` | BOSS 在第 `n×0.75 + 2` 秒追加一隻 |
| `minWave` | 0～25 | `data/enemies.ts` 各筆 | 該敵種／BOSS 最早可以出現的波次 |
| `level.hpMul` | 0.55～1.28 | `data/levels/index.ts` | 關卡難度**微調**，乘在 `buildWave` 內，**不在 `enemyBaseHp` 裡**。整個區間只值約 2 個參考波，真正決定難度的是 `arc` |
| `level.maxWave` | 12～40 或 `Infinity` | `data/levels/index.ts` | **只是關卡長度**（要打幾波）。`Infinity` = 無盡變體，改走絕對波次曲線 |
| `level.arc` | 20～41 | `data/levels/index.ts` | **難度主旋鈕**：這一關要在 `maxWave` 波之內走完幾個參考波。越大越難；預期傻 AI 中位數 ≈ `maxWave × 20 / arc` |
| `level.bias` | `EnemyTrait[]` | `data/levels/index.ts:58` | 關卡偏好；同時決定敵種比重與 UI 的推薦標籤 |

`enemyBaseHp(wave, maxWave, arc) = 32 × 1.23^(wave × arc/maxWave)`。
**指數吃的是「走完難度弧的百分比」，不是絕對波次**，所以同一關的長度與難度可以分開調：

| 走完弧的比例 | 基準血量 | 12 波 × arc 20（黃巾） | 30 波 × arc 28（巨鹿） | 40 波 × arc 41（洛陽） |
|---|---|---|---|---|
| 25% | 254 | 第 3 波 | 第 7.5 波 | 第 10 波 |
| 50% | 2010 | 第 6 波 | 第 15 波 | 第 20 波 |
| 100% | 126300 | ——（弧只走到 20，終點 1010） | ——（走到 28，終點 12300） | 第 39 波 |

走完同樣比例的弧 → 同樣的血量（`core.test.ts` 有測試鎖住）。
**難度曲線就是九關的 `arc` 遞增**（20 → 41）：傻 AI 大約死在弧上的第 20 個參考波，
所以預期中位數 ≈ `maxWave × 20 / arc`——arc 20 的教學關剛好打到底，arc 41 的洛陽只走到 45%。

⚠ **歷史（別再走回去）**：`arc` 曾經不存在，公式寫死 `WAVE_REF / maxWave`，
於是每一關都剛好走完整條弧、傻 AI 在九關都死在正中間 → **九關難度完全一樣平**，
而 12 波的教學關被壓成每波血量 ×1.99（全遊戲最陡的一段）。`npm run sim 12 all` 一次看得出來。

⚠ **`maxWave = Infinity`（無盡模式）是這條公式的邊界情況**：相對進度會恆等於 0，
血量永遠停在第 0 波。`enemyBaseHp` 因此對非有限的 `maxWave` 直接改走絕對波次
（`waves.ts` 的第一行 early return），無盡走的就是 `32 × 1.23^wave` 這條原始曲線
（等同 `arc = maxWave = WAVE_REF`，`endlessOf()` 也把 `arc` 明寫成 40）。`endless.test.ts` 有測試鎖住這件事
（若退回機制沒了，「第 20 波與第 40 波血量相同」會被抓到）。

### ★ 為什麼難度目標不能靠 `hpMul` 達成（踩過的坑）

陣亡波次是**「血量曲線」與「玩家戰力曲線」的交點**，而這兩條線幾乎平行——
實測玩家 dps 前期約 ×1.27／波、後期降到 ×1.12／波，`HP_GROWTH` 是 1.23。
兩條近乎平行的線，垂直平移（也就是 `hpMul`）只會讓交點移動一點點：

```
兩關的陣亡波次差 = ln(hpMul 比值) / ln(HP_GROWTH) × maxWave / WAVE_REF
```

在 1.23 之下，0.55～1.28 這整個 `hpMul` 區間只值 **約 2 個參考波**。
九關的傻 AI 陣亡點換算成參考波之後全部擠在 18～21，就是這個原因——
所以「這一關有多難」只能靠 `arc` 決定弧要走多長，不能靠 `hpMul`。

⚠ **不要試圖用降低 `HP_GROWTH` 來讓 `hpMul` 更有力**。試過：降到 1.10 之後
血量成長（×1.10）遠低於玩家戰力成長（×1.27），結果是**前期變成不可能、後期變成毫無威脅**
（傻 AI 撐到第 34～40 波）。`HP_GROWTH` 必須貼著玩家戰力的成長率，它不是自由參數。

**`HP_GROWTH` 的調整歷史**（註解在 `waves.ts:19-31`，改動時請一併更新）：

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
現況基準（30 局）：

| 關卡 | 黃巾 | 董卓 | 巨鹿 | 官渡 | 赤壁 | 五丈原 | 襄陽 | 漢中 | 洛陽 |
|---|---|---|---|---|---|---|---|---|---|
| 總波數 | 12 | 18 | 30 | 24 | 30 | 40 | 32 | 32 | 40 |
| 目標（一半） | 6 | 9 | 15 | 12 | 15 | 20 | 16 | 16 | 20 |
| 傻 AI 中位數 | 6 | 9 | 15 | 12 | 14 | 20 | 17 | 15 | 19 |
| 偏差 | +0% | +0% | +0% | +0% | -7% | +0% | +6% | -6% | -5% |

偏差 ±20% 內算達標。`npm run sim 16 guandu` 可指定局數與關卡。
**無盡變體**（`npm run sim 20 endless_julu`）沒有總波數，目標改成 `WAVE_REF/2 = 20`：
黃巾 22・巨鹿 21・洛陽 19。所有無盡版走同一條 40 波的弧，差異只在 `hpMul`／`lives`／字池。
⚠ **教學關不再是「傻 AI 打得完」**：黃巾現在也照同一條規則，中位數 6／12 波。
`npm run sim` 用預設 meta（無商城道具）→ 全中性 `Perks`，所以**商城道具永遠不影響難度基準**。

### 敵表：一般兵（`data/enemies.ts:64-114`，共 11 種）

`REGULARS = ENEMIES.filter(e => !e.boss)`（`enemies.ts:193`）。波次組成只從這裡抽。
平衡基準：`thief` = `hpMul` 1 / `def` 0 / `speed` 0.95 / `bounty` 1，其餘以它為 1.0 調整。
⚠ `bounty` 是最大的糧食來源（約總收入 65%），改它之前先跑 `npm run econ`。

| key | 字 | `hpMul` | `def` | `speed` | `flying` | `bounty` | `troop` | `minWave` | `traits` | 機制 |
|---|---|---|---|---|---|---|---|---|---|---|
| `thief` | 賊 | 1 | 0 | 0.95 | – | 1 | 步 | – | （無） | 基本雜兵，第 1 波就有 |
| `shield` | 盾 | 1.9 | 45 | 0.7 | – | 2 | 步 | – | `armored` | 高防（`mitigate` 只留 57%），怕貫穿與灼燒 |
| `swift` | 快 | 0.55 | 0 | 2.1 | – | 1 | 騎 | – | `fast` | 移速 2 倍以上，血薄 |
| `flyer` | 飛 | 0.9 | 10 | 1.35 | ✔ | 2 | 弓 | – | `flying` | 只有 `baseRange >= ANTI_AIR_RANGE`(2.0) 的單位打得到 |
| `shaman` | 妖 | 0.8 | 5 | 0.8 | – | 3 | 步 | 6 | `healer` | `healAura` 半徑 2.4、每秒回**目標最大血** 6%；`maxShare` 0.12。⚠ **妖道之間不互相回血**，且總回血有上限 |
| `swarmlet` | 蟻 | 0.3 | 0 | 1.5 | – | 1 | 步 | 7 | `swarm` | 血極薄成群；也是兩種分裂與 `bossSwarm` 護衛的產物 |
| `armor` | 甲 | 2.4 | 75 | 0.6 | – | 3 | 步 | 8 | `armored` | 防禦 75（普攻只留 44%）。**灼燒無視防禦，是正解** |
| `splitter` | 裂 | 1.5 | 10 | 0.85 | – | 2 | 步 | 9 | `splitter` | `splitInto` 蟻賊 ×2；純單體輸出會被拖住 |
| `gale` | 疾 | 0.7 | 0 | 2.4 | – | 2 | 騎 | 10 | `fast` | 全場最快的一般兵，且 `slowImmune`（只能定身或爆發） |
| `stone` | 磐 | 4.5 | 30 | 0.4 | – | 4 | 步 | 12 | `tanky` | 極慢極厚，考驗持續輸出總量 |
| `warden` | 幡 | 1.2 | 20 | 0.75 | – | 3 | 步 | 14 | `armored` | `buffAura` 半徑 2.2、周圍 `def` +40（有上限）；`maxShare` 0.15。妖道的「防禦版」，解法從集火換成灼燒 |

一般兵 `damage` 全部是 1。**開放時程**（`eligible()`，`waves.ts:95-100`）：

| 波次 | 新開放 | 一般兵池大小 | 無偏好時每種機率 |
|---|---|---|---|
| 1 | 賊／盾／快／飛 | 4 | 25% |
| 6 | 妖道 | 5 | 20% |
| 7 | 蟻賊 | 6 | 16.7% |
| 8 | 甲賊 | 7 | 14.3% |
| 9 | 分裂賊 | 8 | 12.5% |
| 10 | 疾風賊 | 9 | 11.1% |
| 12 | 磐石賊 | 10 | 10% |
| 14 起 | 旗賊 | 11 | 9.1% |

⚠ 上表的機率是「沒有 `maxShare` 到頂時」的值。妖道與旗賊到頂後會被**整個排除在候選池外**，
剩下的敵種機率隨之上升——這也是為什麼旗賊的 `maxShare` 不只是防呆：它決定了偏好重甲的關卡
到底是抽到甲賊還是旗賊（實測會讓漢中的抵達比例在 0.47 與 0.59 之間移動）。

### 敵表：BOSS（`data/enemies.ts:116-185`，共 13 種）

`BOSSES = ENEMIES.filter(e => e.boss)`（`enemies.ts:196`）。基準：`hpMul` 8～22、`def` 25～95、
`bounty` 10～17、`damage` 2、**全部 `ccImmune`**。設計原則是**每一隻都有一個「必須改變打法」的鉤子**，
而不是只有血量差異。

| key | 字 | `hpMul` | `def` | `speed` | `damage` | `troop` | `minWave` | 特色鉤子 |
|---|---|---|---|---|---|---|---|---|
| `boss` | 將 | 14 | 60 | 0.6 | 2 | 騎 | – | 最基本的首領。只有 `ccImmune`，是 5 波唯一候選 |
| `bossIron` | 甲 | 13 | 95 | 0.5 | 2 | 步 | 10 | `burnImmune` + `def` 95 → **封掉灼燒這條路**，只有高單擊打得動 |
| `bossGale` | 疾 | 9 | 30 | 1.7 | 2 | 騎 | 10 | `slowImmune`，速度 1.7 直接衝過防線；灼燒仍有效 |
| `bossShaman` | 巫 | 11 | 40 | 0.65 | 2 | 步 | 10 | `healAura` 半徑 3.0／每秒 9%，會把整批雜兵一起奶起來 → 必須先集火它。⚠ 它也**不會被雜兵妖道奶** |
| `bossFly` | 翼 | 10 | 35 | 1.1 | 2 | 弓 | 10 | `flying`：沒有 `baseRange >= 2` 的單位**完全打不到** |
| `bossSplit` | 裂 | 12 | 45 | 0.7 | 2 | 步 | 15 | `splitInto` 分裂賊 ×3 → 每隻再裂成 2 蟻賊（兩層分裂，共 6 隻蟻賊） |
| `bossSwarm` | 群 | 10 | 40 | 0.75 | 2 | 步 | 15 | `escort` 蟻賊 ×10，在 `buildWave` 就展開成生成條目 |
| `bossRegen` | 生 | 12 | 50 | 0.6 | 2 | 步 | 15 | `regen` 0.02（每秒回自身最大血 2%）→ 磨血永遠打不死，必須爆發 |
| `bossToxic` | 毒 | 11 | 45 | 0.8 | **3** | 步 | 15 | `damage` 3：漏一隻就扣 3 命，在 2 命關卡等於直接輸 |
| `bossStone` | 磐 | **22** | 55 | 0.35 | 2 | 步 | 20 | 全場最厚（是雜兵的 22 倍）但慢到 0.35，純粹的輸出量測驗 |
| `bossShadow` | 影 | 8 | 25 | **2.0** | 2 | 騎 | 20 | `slowImmune` + `burnImmune`：疾風將還能靠灼燒磨，這隻只能純爆發攔 |
| `bossDrum` | 鼓 | 12 | 45 | 0.9 | 2 | 步 | 20 | `buffAura` 半徑 3.2／周圍敵速 ×1.6（有上限）。與妖道首相反——妖道首拖長戰鬥，它壓縮玩家的反應時間 |
| `bossWarlord` | 霸 | 18 | 80 | 0.7 | **3** | 騎 | 25 | 高血 + 高防 + 不慢 + 3 傷，後期的綜合考驗 |

**BOSS 候選數隨波次成長**（`pickBoss`，`waves.ts:118-121`）：

| BOSS 波 | 新加入 | 候選數 |
|---|---|---|
| 5 | 賊將 | 1（`pickBoss` 仍會抽 1 次 rng） |
| 10 | 鐵甲將／疾風將／妖道首／飛將 | 5 |
| 15 | 分裂將／群將／再生將／毒將 | 9 |
| 20 | 磐石將／影將／戰鼓將 | 12 |
| 25 起 | 霸將 | 13 |

⚠ **BOSS 波不一定是 5 的倍數**：關卡可用戰場特性的 `bossEvery` 改（虎牢關是 3）。
`isBossWave(wave, every)` 的第二參數預設 `BOSS_EVERY = 5`。

### 關卡偏好（`bias`）與推薦標籤

`LevelDef.bias: EnemyTrait[]`（`data/levels/index.ts:65-73`）→ `createGame` 抄進 `state.bias`（`state.ts:160`）
→ `beginBattle` 傳給 `buildWave` 第 4 參數（`actions.ts:307`）。加權在 `weightOf`（`waves.ts:95-97`）：
敵人的 `traits` 只要**命中任一個** bias 特徵，權重就是 `BIAS_WEIGHT`(4)，否則 1。同一份權重也用在 `pickBoss`。

例：襄陽 `bias: ['swarm', 'splitter']`，第 20 波池子 10 種，蟻賊與分裂賊各 4 分、其餘 8 種各 1 分
→ 總權重 16，那兩種各 25%（無偏好時只有 10%）。

`EnemyTrait` 共 7 種（`types.ts:203`）。同一份 `traits` 經 `TRAIT_COUNTERS`（`enemies.ts:33-41`）
推導出關卡卡片上的「建議帶」標籤（`countersFor()`，`enemies.ts:205-211`；顯示在 `ui/screens.ts:572-573`）：

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
| 每波固定收入 | `4 + ⌊wave×0.6⌋`，再 ×`incomeMul` | `economy.ts:60-65`／`step.ts:366` |
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
`recruitsThisWave` 在 `checkWaveEnd`（`step.ts:388`）歸零，所以「同一波連續征兵」會越來越貴（每次 +`RECRUIT_STEP`＝3），跨波則重置。
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

`meta.loadoutActive` 為真時，`createGame`（`state.ts:148-152`）傳入 `LoadoutConfig`，
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

### `stepGame` 的完整執行順序（`step.ts:15-41`）

| # | 行 | 步驟 | 為什麼在這個位置 |
|---|---|---|---|
| 0 | 16 | `phase === 'won' \|\| 'lost'` → **return** | 遊戲結束後整棵 state 凍結，包含 `state.time` |
| 1 | 17 | `state.time += dt` | 在 prep 分支之前 → 佈陣階段時間也在走 |
| 2 | 19-24 | **prep 分支**：`prepTimer -= dt`；≤0 → `beginBattle(state)`；`stepEffects`；**return** | 佈陣期只跑特效衰減。`beginBattle`（`actions.ts:296-315`）設 `phase='battle'`、`waveTime=0`、歸零督戰水位、**`spawnQueue = buildWave(wave, rng, hpMul, bias, maxWave, arc, mods)`（消耗 rng）**。當幀立刻 return，所以第一隻敵人在下一幀才生成 |
| 3 | 26 | `state.waveTime += dt` | 生成時刻的唯一時間基準（不是 `state.time`） |
| 4 | 27 | 所有單位 `atkFlash -= dt` | 純視覺；刻意只在戰鬥階段衰減 |
| 5 | 28 | `spawnDue`（`step.ts:100-105`） | **最前面**：新生成的敵人當幀就吃狀態、會移動、會被打，不空轉一幀。生成一律走 `makeEnemy` |
| 5b | 29 | **`stepFrenzy`**（`step.ts:159-201`） | **必須在所有會讀 `state.frenzy` 的步驟之前**（回血、移動、控場都吃它）。它量的是「這一波有沒有進展」，用的是**上一幀**留下的三個水位，所以放在 `spawnDue` 之後、任何傷害結算之前最單純。詳見下方「卡波與督戰」 |
| 6 | 30 | `stepStatuses`（`step.ts:275-288`） | **必須在 `moveEnemies` 之前**：定身／減速倒數與 `moveEnemies` 的讀取同幀一致，`stun` 才能當幀生效；灼燒傷害也先結算，被燒死的敵人不會再被索敵 |
| 7 | 31 | **`stepEnemySupport`**（`step.ts:211-271`） | **必須緊接在 `stepStatuses` 之後**：灼燒先扣血、回血後補，兩者在同一幀正面對撞，淨 dps 才是玩家實際感受到的數字。更關鍵的是**順序不能反過來**——`stepEnemySupport` 用 `hp <= 0` 過濾（`step.ts:217`、`step.ts:249`），所以被灼燒燒死的敵人**不會被光環奶回來**；若放在 `stepStatuses` 之前，同一幀就會出現「先奶滿再燒」的無限拉鋸。另外它讀 `enemyPos` 算光環半徑，放在 `moveEnemies` 之前 → 用的是與 `stepStatuses` 同一組位置 |
| 8 | 32 | `moveEnemies`（`step.ts:290-318`） | 敵人先移動再讓塔索敵 → 射程判定用的是**當幀最新位置**，不是上一幀的殘影 |
| 9 | 33 | `stepCombat` | 在回血之後 → `targeting: 'strong'` 挑的是**回血後**的血量，不會被光環騙 |
| 10 | 34 | `stepSkills` | 武將主動技在普攻之後 → 技能看到的是本幀扣血後的血量（狙擊類技能選目標才正確） |
| 11 | 35 | `stepBondSkills` | 羈絆組合技排在單體技之後 |
| 12 | 36 | `stepMeteor`（`step.ts:46-70`） | 局外道具的傷害源，最後補刀 |
| 13 | 37 | `stepEffects` | 特效壽命衰減，放在所有 `pushEffect` 之後，新特效才有完整一幀壽命 |
| 14 | 38 | `cleanupDead`（`step.ts:333-353`） | 移除 `hp <= 0`（含漏過的敵人，它們被設成 `hp = 0`），**並在此處理死亡分裂**——見下節 |
| 15 | 39 | `checkWaveEnd`（`step.ts:355-391`） | **必須在 `cleanupDead` 之後**：條件是 `spawnQueue.length === 0 && enemies.length === 0`，屍體沒清掉波次永遠不會結束；分裂出的小怪也是在這之前才進場，否則波次會提早結束 |

### 敵種機制的實作位置與陷阱

這些機制分佈在三個檔案，**沒有一個是「BOSS 專屬」的路徑**——`stepEnemySupport` 與 `cleanupDead`
都只是查 `ENEMY_BY_KEY[e.defKey]`，所以一般兵（妖道、旗賊、分裂賊）與 BOSS 共用同一組鉤子。

| 機制 | `EnemyDef` 欄位 | 實作位置 |
|---|---|---|
| 回血光環 | `healAura: { radius, hps }` | `stepEnemySupport`（`step.ts:238-260`） |
| 加防／加速光環 | `buffAura: { radius, defAdd?, speedMul? }` | `stepEnemySupport`（同上） |
| 單波佔比上限 | `maxShare`（0～1） | `buildWave` 的 `shareCap`（`waves.ts:127-129`） |
| 自我再生 | `regen`（每秒比例） | `stepEnemySupport`（`step.ts:219`） |
| 死亡分裂 | `splitInto: { key, count }` | `cleanupDead`（`step.ts:333-353`） |
| 護衛 | `escort: { key, count }` | `buildWave`（`waves.ts:153-165`），**生成期展開，不是 runtime** |
| 免疫 | `burnImmune` / `slowImmune` / `ccImmune` | `makeEnemy` 複製（`step.ts:87-89`）→ `applyStatus`（`combat.ts:219-244`） |

**1. 回血與再生一律是「最大血量的比例」，不是絕對值。**
`regen`：`e.hp = min(e.maxHp, e.hp + e.maxHp × def.regen × dt)`（`step.ts:219`）；
`healAura` 同式，但用的是**被治療者自己的 `maxHp`**（`step.ts:262-266`）。
理由跟 `stepMeteor` 把傷害綁 `enemyBaseHp` 完全一樣（`step.ts:57`）：血量是 `20 × 1.23^wave` 的指數成長，
任何寫死的「每秒回 30 血」在第 10 波（雜兵 159 血）強得離譜、在第 30 波（雜兵 9958 血）等於 0。
比例制讓「再生將每秒回 2%」在任何波次都是同一個相對強度，也讓平衡只需要看一個數字。
副作用是**它跟玩家的 dps 直接對打**：`regen` 0.02 等於要求玩家對那隻的有效 dps > 該波血量的 2%。

**1b. ★ 敵方光環一律有疊加上限，而且治療者之間不互相治療。**
這一節是「卡波」的根治處（見下方「卡波與督戰」）。三條規則都在 `stepEnemySupport`：

| 規則 | 常數／位置 | 為什麼非有不可 |
|---|---|---|
| 治療者不治療其他治療者 | `step.ts:255` | N 隻妖道互奶時每隻收到 (N−1)×hps，**隨數量平方成長**——6 隻疊在一起就是每秒回 25%，任何輸出都追不上，整包妖道變成打不死的鐵板。妖道本身脆（hpMul 0.8／def 5），沒人奶它就殺得掉，「優先集火」這個設計意圖才回得來 |
| 總回血上限 `HEAL_CAP_HPS = 0.12` | `step.ts:196` | 妖道多的意義變成「覆蓋更廣、比較難一次拔掉」，而不是「回血無限疊」。妖道 `hps` 0.06 → 兩隻剛好頂到上限 |
| 加防上限 `DEF_ADD_CAP = 60`／加速上限 `SPEED_AURA_CAP = 1.8` | `step.ts:197-199` | 同理，旗賊 `defAdd` 40，兩隻到頂 |

其餘跳過條件：不奶自己（`t === s`）、不奶死人（安全性，見上一節）、不奶滿血的（省迴圈）。

⚠ 光環的實作方式是「**每幀把 `e.def` / `e.speed` 重設回敵表基準值，再疊上當下的光環**」（`step.ts:220-221`）。
所以 `Enemy.def` 與 `Enemy.speed` 是**衍生值不是狀態**，直接指派會在下一幀被蓋掉。
累加用的三個 `Float64Array` 是模組層重用的暫存區（`step.ts:207-209`），只在單次呼叫內有意義、不跨幀，
因此不影響決定性；重用而不是每幀 new 是為了省電。

⚠ `maxShare`（`data/enemies.ts`）是第二道防線：到頂的敵種**整個被排除在抽取之外**，
不是「抽到再重抽」——重抽會多消耗 rng，讓同一顆種子產出不同的一局。
妖道 0.12 的理由是不卡波；旗賊 0.15 的理由**剛好相反**：它很弱，放任它在「偏好重甲」的關卡佔到近兩成，
等於把甲賊的位置換成軟柿子，**整關反而變簡單**（實測漢中的抵達比例會從 0.47 掉到 0.59）。

**2. 死亡分裂必須在 `cleanupDead` 做，絕對不能在傷害來源那邊 push。**
`stepCombat`／`stepStatuses`／`stepSkills` 都在 `for (const e of state.enemies)` 迭代中，
當場 `push` 會讓「剛分裂出來的小怪在同一幀又被同一輪迴圈打死、再分裂」——同幀連鎖增殖。
`cleanupDead` 是每幀唯一一次、且在所有傷害結算之後的安全點（註解在 `step.ts:320-332`）。

- **允許多層分裂**：分裂將 → 分裂賊 ×3 → 蟻賊 ×2（共 6 隻蟻賊）。子代死亡是在**後續的幀**才結算，
  每一層都各自走過一次完整的傷害流程，所以不會在同一幀爆炸性增殖。
- 安全性靠**「分裂圖必須是無環的有限圖」**保證——蟻賊沒有 `splitInto`，鏈一定終止。
  ⚠ 新增 `splitInto` 時**絕對不能形成環**（A→B→A 會無限增殖）；`enemies-ext.test.ts:103` 有測試驗證無環且深度有限。
- 子代血量：`(e.maxHp / 母體 hpMul) × 子代 hpMul`（`step.ts:345`）——從母體的**出生血**反推出該波的 base，
  子代血量才會跟著波次成長。⚠ 這條反推假設 `maxHp` 永遠等於出生血；將來若加「生成後提升最大血」的機制，這裡要改。
- 子代沿路徑倒退 `0.25 × i` 散開（`step.ts:347`），避免完全重疊在一點。

**3. 漏過大營的敵人不會分裂。** `cleanupDead` 的 `e.dist >= state.board.path.length - 1` 檢查（`step.ts:341`）。
`moveEnemies` 是用 `hp = 0` 來表示「漏過了」（`step.ts:303`），跟被打死的敵人走同一條清理路徑。
若不擋這一條，分裂賊每次漏過就會**在終點刷出一批一出生就必漏的小怪**，連環扣命直到 `lives` 見底。

**4. 灼燒無視防禦，`burnImmune` 是唯一能封掉這條路的手段。**
灼燒每幀走 `damageEnemy(state, e, e.burnDps * dt)`（`step.ts:284`）——`damageEnemy`（`combat.ts:151-174`）
是純扣血，**不經過 `mitigate`**。於是 `def` 95 的鐵甲將對普攻只吃 39% 傷害，對灼燒吃 100%。
所以「高防」的設計正解是持續傷害或高單擊，而不是多打幾下（`enemies.ts:14-16` 的註解就是在講這件事）。
`bossIron` 與 `bossShadow` 帶 `burnImmune`，把這條捷徑收掉、逼玩家改帶高單擊。

`applyStatus`（`combat.ts:219-244`）的三種免疫各擋不同的東西：

| 免疫 | 擋掉 | 行 | 誰有 |
|---|---|---|---|
| `slowImmune` | `slowDur` | `combat.ts:220` | `gale`／`bossGale`／`bossShadow` |
| `burnImmune` | `onHit.burn`（`burnT`＋`burnDps`） | `combat.ts:222-225` | `bossIron`／`bossShadow` |
| `ccImmune` | `stunDur` 與 `knock` | `combat.ts:226-230` | 全部 12 隻 BOSS |
| （無） | `vulnDur`（易傷） | `combat.ts:221` | **刻意不給任何免疫** |

易傷不可免疫是設計決定：否則控場流會完全失去對 BOSS 的作用，只剩純傷害流一條路。

⚠ 免疫在 `makeEnemy` 時就從 `EnemyDef` 複製進 `Enemy`（`step.ts:87-89`），不是每次查表。
新增一種免疫要**同時**改三處：`types.ts` 的 `EnemyDef`、`types.ts` 的 `Enemy`、`makeEnemy`。
漏了 `makeEnemy` 那一行會**靜默失效**（欄位是 `undefined`，`!e.xxxImmune` 恆為真）。

**5. `escort` 是生成期展開，不是 runtime 行為**（`waves.ts:153-165`）。護衛只是被塞進 `spawnQueue` 的普通條目，
血量用「該波 base × 護衛自己的 `hpMul`」，出場時間 `at + 0.15 × i` 錯開。兩個推論：
護衛**不消耗額外 rng**；護衛**不受 `minWave` 限制**（`bossSwarm` 的 `minWave` 15 > 蟻賊的 7，
目前不會出事，但將來若讓早期 BOSS 帶後期護衛就會繞過開放時程）。

### `checkWaveEnd`（`step.ts:355-391`）的結算順序

```
0. 若 phase 已經是 'lost' → 直接 return                 ← 見下方「為什麼需要第 0 步」
1. 若 spawnQueue 或 enemies 非空 → 直接 return
2. lastIncome = { base: waveIncome(wave) × incomeMul, units: unitIncome(state) }（供 UI 顯示）
3. food += base + units
4. wave >= maxWave → phase='won'、emit('won')、return   ← 通關那一波不觸發回血
                                                          無盡的 maxWave 是 Infinity → 永遠不成立
5. 杏林春暖：wave % healEveryWaves === 0 且 lives < maxLives → lives+1（用**遞增前**的 wave 判定）
6. emit('waveClear')、wave++、recruitsThisWave=0、phase='prep'、prepTimer=PREP_SECONDS
```

**為什麼需要第 0 步**（`step.ts:362`，2026-07-30 修）：`moveEnemies` 在同一幀就可能把 phase 設成
`'lost'`，而「最後一隻敵人漏過大營並打光生命」會讓 `spawnQueue` 與 `enemies` 同時清空——
於是第 6 步把 `'lost'` 覆寫回 `'prep'`，玩家在 0 生命的狀態下繼續打，結算畫面與聲望都不出現。
修掉之後 5 關的傻 AI 中位數各降 1 波（那些局本來是死了還在打），已反映在上面的基準表。
⚠ 這個縫隙對無盡模式是致命的：那裡沒有通關出口，落敗是唯一的結束方式。

### `moveEnemies`（`step.ts:290-318`）的漏怪處理

```
stun > 0 → 當幀完全不前進
globalMul = perks.enemySpeedMul × (mods.enemySpeedMul ?? 1) × (1 + frenzy × 2)
dist += speed × (slow>0 ? SLOW_FACTOR(0.5) : 1) × globalMul × dt
dist >= path.length-1 → hp=0、dist 夾到終點、stats.leaks++、emit('leak')
                      → rng() >= leakBlockChance 時才 lives -= e.damage
                      → lives <= 0 → phase='lost'、emit('lost')
```

回魂旗擋下時**仍計 `stats.leaks`**，只是不扣命。`e.damage` 現在不只是 1：`bossToxic` 與 `bossWarlord` 是 3、
其餘 BOSS 是 2，所以在 2 命的關卡（五丈原、洛陽）漏一隻毒將就直接輸。

### ★ 卡波與督戰（`stepFrenzy`，`step.ts:159-201`）

**卡波＝整局停在同一波動不了。** 玩家回報過的實際樣子：一波裡出現太多妖道，它們互相回血於是
打不死；同時玩家的擊退把敵人一直推回去，於是它們也走不到大營、不會漏過去結束這一波。
兩件事**同時成立**時波次永遠不會結束——場上那批敵人清不掉、生命一點沒少、時間就停在那裡。

修法分三層，前兩層治成因、第三層治結果：

| 層 | 位置 | 作用 |
|---|---|---|
| 1 | `stepEnemySupport`（治療者互不治療 + 疊加上限） | 讓「打不死」很難發生 |
| 2 | `EnemyDef.maxShare`（`buildWave`） | 讓「一波裡有幾隻妖道」本身就有天花板 |
| 3 | **`stepFrenzy`（督戰）** | **與成因無關的最後保證：波次一定會結束** |

第 3 層不可省略：**只要玩家的擊退夠強，光靠「推不動」就能無限拖住**，跟治療完全無關。

判定看的是「**有沒有進展**」而不是「花了多久」——後期一波本來就可能超過 90 秒。
三個進展訊號任一動了就重新計時（`state.stallMark` / `stallKills` / `stallHp`）：

| 訊號 | 語義 | 為什麼需要它 |
|---|---|---|
| 最前方敵人的 `dist`（高水位） | 有人往前走了 | 一般情況下最直接 |
| `stats.kills` | 有人死了 | 前方那隻被殺掉時 `dist` 反而會下降 |
| 場上總血量（低水位，門檻 `HP_PROGRESS = 0.005`） | 血在掉 | **不誤傷「控住一隻高血敵人慢慢磨」的正當打法**：那時沒人死、也沒人前進 |

⚠ **沒有進展的幀不可以把血量水位往下修**。曾經每幀都跟著 `totalHp` 下修，於是「每幀掉一點點」
永遠追不上 0.5% 的門檻——水位被自己拉著走，磨血照樣被判成僵局。

連續 `STALL_GRACE = 8` 秒三個訊號都沒動 → `emit({kind:'frenzy'})` 一次，
`frenzy` 在 `FRENZY_RAMP = 6` 秒內爬到 1，效果是：

- 回血／加防／加速光環全部乘上 `(1 − frenzy)` → 歸零（`step.ts:212`）
- 敵速 ×`(1 + frenzy × 2)`，滿檔 3 倍（`FRENZY_SPEED_MUL`，`step.ts:290-318`）
- 定身與擊退乘上 `(1 − frenzy)` → 歸零（`combat.ts:226-230`）。**減速刻意不受影響**，它只讓敵人變慢、不會讓進度停住

⚠ `frenzy` 在一波之內**只升不降**（只在 `beginBattle` 與清場時歸零）。曾經讓它「一有進展就回退」，
結果是擊退鎖進入穩定震盪：frenzy 一掉，擊退立刻又把敵人推回去，敵人以極慢的速度來回爬，
波次照樣結束不了。督戰令一旦下達就不收回，才是真的保證。

⚠ 它是**保險，不是難度旋鈕**。正常對局（哪怕很慢）永遠碰不到它——`stall.test.ts` 有一組測試
專門釘住這兩面：僵局一定會被打破、正常推進與磨血一定不會觸發。

### `stepMeteor`（`step.ts:46-70`）

`perks.meteorInterval <= 0` 直接 return（未購買時零成本）。倒數 `meteorTimer` 初值＝間隔（`state.ts:200`），
歸零時用 `+=` 補回間隔（不是重設）以避免長期漂移。目標是 `dist` 最大（最前方）那隻，
對其周圍 **1.5 格**內全體造成 `0.7 × enemyBaseHp(wave) × hpMul` 傷害，並施加 3 秒、dps 為傷害 12% 的灼燒。

**傷害為什麼綁 `enemyBaseHp(wave)`**：血量是指數成長的，任何寫死的固定傷害在 10 波後就等於 0。
綁上去之後，這一發永遠等於「一隻該波雜兵的 70% 血量」，前後期威力感一致。
`hpMul` 也要乘，否則高難度關卡的相對威力會被 `level.hpMul` 稀釋。

⚠ `stepMeteor` 的灼燒**直接寫 `e.burnT`／`e.burnDps`**（`step.ts:63-64`），沒有經過 `applyStatus`，
所以**它無視 `burnImmune`**。這是目前唯一能燒到鐵甲將／影將的來源，屬於既有行為；
要改成尊重免疫的話，這裡要改走 `applyStatus`，並重跑 `npm run sim`。

## 契約與陷阱

1. **模擬固定 1/60 步長**。`stepGame` 的 `dt` 一律是 `FIXED_DT`（`core/loop.ts:5`），由 `core/loop.ts:32-36` 的累加器驅動。
   **`sim/` 內不可讀 `performance.now()`／`Date.now()`**（只有 `core/loop.ts` 可以）——否則 `npm run sim` 與單元測試（都是直接 for 迴圈呼叫 `stepGame`）會失真。
   另外掉幀保護會丟棄累加器（`loop.ts:37`），所以 `sim/` 也不可假設真實時間連續。

2. **`buildWave` 會消耗 `rng`：每波 `enemyCount(wave)` 抽（每隻敵人一抽，`waves.ts:152`），BOSS 波再多 1 抽（`pickBoss`，`waves.ts:162`）**。
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
   - `moveEnemies` 每次漏怪 1 抽，**即使 `leakBlockChance` 是 0 也會抽**（`step.ts:308`）。
   - 對照組：爆擊判定用 `critChance > 0 &&` 短路，中性值時**不**消耗（`combat.ts:187`）。這個不一致是既有行為，改任何一邊都會讓所有既有種子的對局內容改變。

4. **編隊模式一次都不消耗 rng**（`pool.ts:59` 直接 return），隨機模式則消耗 `support + generals` 抽。
   所以**同一顆種子在「有／沒有啟用編隊」下不是同一場對局**（`pool.ts:13-16`）。這不違反重現性，但回報 bug 時必須連 meta 一起說。

5. **已成為武將成員的字牌不重複計算**。同一條規則散落**三處**，任何新增的「逐單位聚合」都要跳過 `u.kind === 'glyph' && u.formIds.length > 0`，
   否則會**靜默地**重複計算（沒有測試會抓到）：
   - 產糧：`src/sim/economy.ts:45`
   - 攻擊：`src/sim/combat.ts:256`
   - 光環投射：`src/sim/state.ts:431`

   第四個聚合（例如「全場攻擊力總和」的 UI、或新的每波結算項目）必須自己加上同樣的判斷。

6. **敵種開放由各敵人的 `minWave` 決定，不是硬編碼的時程表**（`eligible()`，`waves.ts:95-100`）。
   `composition(wave)` 現在只是 `eligible(REGULARS, wave)` 的薄包裝（`waves.ts:103-105`），
   `REGULARS`／`BOSSES` 又是從 `ENEMIES` 過濾出來的（`enemies.ts:193,170`）——
   **所以新增敵種只要改 `data/enemies.ts`，不需要動 `waves.ts`**（這與擴充前的規則相反，舊文件說要改兩處）。
   要注意的反而是這幾點：
   - `traits` 是**必填**欄位（`types.ts:223`）。填空陣列（像 `thief`）代表「不受任何 `bias` 加權」；填錯會讓關卡卡片的推薦標籤撒謊。
   - `minWave` 太高會讓敵種在短關卡永遠不出現（黃巾只到 12 波，`stone` 的 `minWave` 12 只趕上最後一波）。
   - `eligible()` 有一道防呆：全部被 `minWave` 擋掉時退回 `pool[0]`（`waves.ts:99`）。
     這依賴 `ENEMIES` 的**宣告順序**——第一筆一般兵必須是 `thief`、第一筆 BOSS 必須是 `boss`，別隨意重排表格頂端。

7. **`rarity: 4` 目前是死的**（見上）。`RARITY_TABLE` 是 module-private，外部一律用 `rarityWeights()`。

8. **`level.hpMul` 只在兩個地方被乘**：`buildWave`（`waves.ts:136`）與 `stepMeteor`（`step.ts:57`）。
   `enemyBaseHp()` 本身**不含** `hpMul`——新增任何「跟著波次成長」的傷害或血量時要記得自己乘。
   分裂子代是例外中的例外：它從母體 `maxHp` 反推（`step.ts:345`），`hpMul` 已經內含在裡面，不要再乘一次。

9. **`rollGlyph` 的 pool 過濾是 `ctx.pool.includes(g.char)`**（`economy.ts:97`）：
   池子裡出現不在 `GLYPHS` 的字會被**靜默忽略**；`ctx.pool` 為空陣列時退回全表（`?.length` 的短路）。
   `pickWeighted` 在總權重為 0 時會回傳**最後一個**候選（`core/rng.ts:31-40`），不會拋錯——
   新增 rarity 時別讓某一波的所有權重同時為 0。同一個 `pickWeighted` 也用在敵種抽取，
   所以 `weightOf` 也不能回傳 0（目前最小是 1，安全）。

10. **perks 的介入點清單**（`Perks` 定義在 `types.ts:372`，由 `data/shop.ts` 的 `perksFrom()` 推導，`createGame` 注入一次、整局固定）。
    本模組只碰這幾個，其餘（`atkMul`／`apsMul`／`critChance`／`splashMul`／`bountyMul`／`rangeMul`／`cdMul`）在 combat／state 那一層：

    | perk | 介入點 | 中性值 |
    |---|---|---|
    | `costMul` | `recruitCost`（`economy.ts:23`）、`rerollCost`（`economy.ts:121`） | 1 |
    | `familiarBoostMul` | `rollGlyph`（`economy.ts:100`），與 `FAMILIAR_BOOST` 相乘 | 1 |
    | `recruitEliteChance` | `recruit`（`actions.ts:49`） | 0 |
    | `incomeMul` | `checkWaveEnd`（`step.ts:366`），**只影響固定收入、不影響產糧** | 1 |
    | `healEveryWaves` | `checkWaveEnd`（`step.ts:378-385`） | 0 |
    | `enemySpeedMul` | `moveEnemies`（`step.ts:301`） | 1 |
    | `leakBlockChance` | `moveEnemies`（`step.ts:308`） | 0 |
    | `meteorInterval` | `stepMeteor`（`step.ts:47-50`） | 0 |
    | `extraLives` | `createGame`（`state.ts:175-176`） | 0 |

    **新增 perk 的鐵則**：中性值必須讓行為與「沒有這個 perk」逐位元相同（倍率 1／機率 0／間隔 0），
    否則 `npm run sim` 的難度基準與所有既有種子都會漂移。
    ⚠ 敵方的回血／再生**刻意沒有對應的 perk**——沒有「減少敵人回血」的道具，玩家只能用 dps 硬碰。

11. **`sim/` 不得 import render/ui/input/DOM**（`step.ts:3` 的註解就是在講這件事）。
    音效與粒子一律用 `emit(state, ...)` 推事件（`step.ts:67,160,167,219,230`），由 app 層每幀 drain；
    `pushEffect` 是 sim 內的視覺佇列，有 240 上限保護（`combat.ts:248`）。
    ⚠ **分裂與回血刻意不 emit 任何事件**：分裂一次可能生出 6 隻、回血是每幀發生，
    emit 會把事件佇列與音效淹掉。要加音效的話請只在 `cleanupDead` 對「母體」emit 一次，不要對每隻子代 emit。

12. `checkWaveEnd` 的通關判定在回血之前（`step.ts:373-377`），所以**通關那一波不會觸發杏林春暖**；
    回血用的是遞增**前**的 `state.wave`。改這段時注意別把 `wave++` 移到前面。

13. **`data/enemies.ts` 的檔頭與 BOSS 區段註解各自抄了一份數字**（`enemies.ts:2` 的 `HP_GROWTH`、
    `enemies.ts:115` 的 BOSS 基準區間）。它們只是導讀，**唯一真相是 `waves.ts:32` 與敵表本身**；
    調 `HP_GROWTH` 或新增落在區間外的 BOSS 時要順手同步這兩行，否則下一個讀者會照著錯的基準配數值。

## 我想改 X → 動哪裡

| 想改什麼 | 動哪裡 | 注意 |
|---|---|---|
| **單關太硬／太軟** | 該關的 `maxWave`（`data/levels/index.ts`） | ★ 第一順位。`maxWave` 同時是長度與弧的陡度，中位數會自動跟著變成新的一半 |
| 整體難度（全部關卡一起） | `HP_GROWTH`（`waves.ts:32`） | 指數項，動 0.01 就很有感。**但它必須貼著玩家戰力的成長率**，不是自由參數（見上面的坑）。改完跑 `npm run sim` 九關並更新歷史註解與基準表 |
| 單關的最後微調 | 該關的 `hpMul` | 整個區間只值約 2 個參考波，只拿來修 ±20% 以內的偏差 |
| **玩家整體戰力變了**（例如新增大量配方） | 反向動 `BASE_HP`（`waves.ts:24`） | 它是線性項，整條曲線等比例移動，正好抵銷「每一波都變強」這種水位變化。配方從 17 擴到 43 種時就是靠它把 20 → 32 |
| 前期難度 | `BASE_HP`（`waves.ts:18`）或 `level.startFood`／`lives` | `BASE_HP` 是線性項，前期影響大、後期被指數吃掉 |
| 單關難度 | `data/levels/index.ts` 的 `hpMul`／`maxWave`／`lives` | 只影響一關，是最安全的旋鈕 |
| 敵人數量／出怪節奏 | `enemyCount`（`waves.ts:74-76`）、`gap`（`waves.ts:139`） | `gap` 是區域變數；縮小它會同時縮短整波長度與玩家的反應窗口 |
| BOSS 頻率 | `isBossWave`（`waves.ts:78-80`） | 也決定 `pickBoss` 的呼叫頻率，改它會移動整條 rng 流 |
| BOSS 強度／組成 | `data/enemies.ts` 的 BOSS 那一段（`enemies.ts:116-185`） | 現在是**隨機挑一隻**，所以「BOSS 有多強」是分布而非單值。調某一隻只影響它出現的那些波 |
| **新增敵種（一般兵）** | 只改 `data/enemies.ts` 的 `ENEMIES`（一般兵區段） | **不用改 `waves.ts`**——`REGULARS` 自動收（`enemies.ts:193`）。`traits` 必填、設好 `minWave`；`troop` 決定相剋；`flying` 需要 `baseRange >= 2` 才打得到 |
| **新增 BOSS** | 同一張表，加 `boss: true` + `minWave` | `BOSSES` 自動收（`enemies.ts:196`）。基準：`hpMul` 8～22、`ccImmune: true`、`damage` 2+。**請給它一個機制鉤子**（免疫／光環／分裂／護衛），只加血量等於沒加內容 |
| **調整關卡偏好** | `data/levels/index.ts` 的 `bias` | 同時改變敵種比重**與**關卡卡片的「建議帶」標籤（`ui/screens.ts:572`）——不要另外手寫推薦清單 |
| 偏好的強度 | `BIAS_WEIGHT`（`waves.ts:36`） | 4 的意思是「帶該特徵的敵人比重 ×4」。調高會讓關卡個性更鮮明但變化更少 |
| 新增 `EnemyTrait` | `types.ts:203` ＋ `TRAIT_COUNTERS`（`enemies.ts:33-41`）＋ `TRAIT_LABEL`（`enemies.ts:52-60`） | 後兩者是 `Record<EnemyTrait, …>`，漏填 tsc 會擋下來（這是刻意的） |
| 新增 `CounterKind`（推薦手段） | `types.ts:206` ＋ `COUNTER_LABEL`（`enemies.ts:43-50`） | 只影響 UI 文案，不影響模擬 |
| 敵種的解鎖時程 | 各敵人的 `minWave` | 短關卡（黃巾 12 波）看不到高 `minWave` 的敵種；別把第一筆 `thief`／`boss` 加上 `minWave`（`eligible` 的防呆依賴它們） |
| 回血／再生強度 | `healAura.hps`、`regen`（`data/enemies.ts`） | 兩者都是「每秒最大血量比例」，等於直接對玩家 dps 設門檻。刻意沒有反制的 perk |
| 死亡分裂 | `splitInto`（`data/enemies.ts`） | ⚠ **不能形成環**（`enemies-ext.test.ts:103` 會擋）。子代血量由母體反推（`step.ts:345`），不要另外乘 `hpMul` |
| BOSS 護衛 | `escort`（`data/enemies.ts`） | 在 `buildWave` 展開（`waves.ts:153-165`），不消耗 rng、**不受 `minWave` 限制** |
| 灼燒能不能打穿高防 | 不要改 `damageEnemy`；用 `burnImmune` | 「灼燒無視防禦」是全局設計前提，改它會連帶影響所有火系字與技能的定位 |
| 對空門檻 | `ANTI_AIR_RANGE`（`enemies.ts:199`） | 比對的是 `u.baseRange`（未乘 `RANGE_MUL`），刻意如此（`combat.ts:96-101`） |
| 在主迴圈插入「敵人自己做的事」 | `stepEnemySupport`（`step.ts:211-271`） | 已經在正確的位置（`stepStatuses` 後、`moveEnemies` 前）。新行為記得跳過 `hp <= 0`，否則會把本幀燒死的敵人救回來 |
| 征兵／重抽花費 | `economy.ts:43-49`、`economy.ts:120-122` | 一次征兵填滿所有空格，改花費等於改「手牌大小的價值」 |
| **一波能征幾次兵** | `waveIncome` 的斜率（`economy.ts:60-65`）與 `recruitCost` 的斜率（`economy.ts:43-49`）**成對調** | ★ 設計目標 1～2 次，用 `npm run econ` 驗收。單獨調一邊會破壞比值 |
| 擊殺獎勵的份量 | `data/enemies.ts` 的 `bounty` | 佔總收入約 65%，是「滾雪球速度」的主力旋鈕 |
| 每波收入／產糧 | `waveIncome`（`economy.ts:60-65`）、字表的 `income`（`data/glyphs.ts`）、`屯田` 的 `income`（`generals.ts:228`） | 經濟字產出是 `income × 品質階級`（線性，`state.ts:258`），不是指數 |
| 抽卡稀有度曲線 | `RARITY_TABLE`（`economy.ts:60-65`） | 每列合計必須是 100（有測試）。第 4 欄無效 |
| 抽卡收斂強度 | `FAMILIAR_BOOST`（`economy.ts:76`）、`WISH_BOOST`（`economy.ts:82`） | 兩者相乘。調高會讓對局更容易滾雪球 |
| 每局字池大小 | `data/levels/index.ts` 的 `pool: { support, generals }` | `generals` 是「幾組配方」，不是幾個字（一組 2～3 字） |
| 哪些字永遠在池內 | `ALWAYS`／`SUPPORT`（`pool.ts:48-49`），改的是 `category` 的分類 | 新增 `category` 時要同時檢查這兩行與 `NAMED_RECIPES` 的判斷 |
| 編隊行為 | `buildLoadoutPool`（`pool.ts:75-93`）、`data/loadout.ts` | 別加「保證有攻擊單位」的安全網（刻意的設計決定，見 `pool.ts:84-89`） |
| 佈陣秒數 | `PREP_SECONDS`（`waves.ts:33`） | 同時影響 `createGame` 初值與每波結算 |
| 在主迴圈插入新步驟 | `stepGame`（`step.ts:26-39`） | 對照上面的順序表挑位置：讀敵人狀態的放 `stepStatuses` 之後、`cleanupDead` 之前；`cleanupDead` 之後看不到本幀死亡、漏過與剛分裂出來的敵人 |
| 波次預覽／關卡地圖預告 | **不要**直接呼叫 `buildWave` | 見陷阱 2 的兩種正確做法 |
| 新增局外被動 | `data/shop.ts` 的 `SHOP` + `NEUTRAL_PERKS`（`shop.ts:230`）+ `types.ts` 的 `Perks`，再在本模組的介入點讀取 | 中性值必須零影響（陷阱 10） |

## 相關頁面

- `04-combat-and-skills.md` — 索敵、`dealDamage`／`damageEnemy` 的差別、相剋與控場、主動技與組合技
- `05-meta.md` — 兵書、商城（`Perks` 的來源）、編隊 UI、聲望與圖鑑
- `06-roadmap.md` — 波次預覽等未實作方向（敵種擴充已於 2026-07-29 完成，見該頁「已完成」）
- `../01-architecture.md` — 分層與依賴方向、字牌與武將的關係
- `../02-data-tables.md` — 字表／配方表／敵表的欄位語意與平衡基準
- `../04-invariants.md` — 七條不可違反的規則全文與已知陷阱總表
