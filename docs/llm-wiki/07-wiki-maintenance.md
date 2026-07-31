# 07. Wiki 維護規則（回寫機制）

這份 wiki 的存在目的只有一個：**讓後續每一次程式碼改動所需的 token 盡量少**。

要達成這件事，wiki 必須「活著」——文件一旦跟程式碼脫節，
它就從資產變成負債（讀了還要驗證，比不讀更貴）。
本頁定義**改完程式碼後要回寫什麼**，讓維護成本內建在開發流程裡。

---

## 設計原則

這份 wiki 是**寫給 LLM agent 讀的**，不是給人類新手的教學文件。因此：

| 原則 | 具體做法 |
|---|---|
| **一次改動只讀 1～2 頁** | [00-index.md](00-index.md) 是路由表，用「任務類型」直接指到單一頁面。不要求讀者建立全局理解 |
| **可跳轉，不需搜尋** | 所有敘述都附 `檔案:行號`。agent 讀到就能直接跳，省下 grep 的往返 |
| **寫「為什麼」** | 「做什麼」讀程式碼就知道；「為什麼這樣做」「為什麼不能那樣做」才是文件的價值 |
| **陷阱優先** | 每頁都有「契約與陷阱」節。會讓人踩坑的事寫在最前面，不要藏在敘述裡 |
| **零重複** | 同一件事只在一個地方講，其餘用交叉引用。重複的內容一定會不同步 |
| **無鋪陳** | 不要「本專案是一個創新的…」這類句子。資訊密度優先 |

---

## 模組頁模板

新增 `modules/` 頁面時**必須**照這個結構，讓 agent 能預期資訊的位置：

```markdown
# <頁面標題>

> **負責檔案**
>
> | 檔案 | 規模 | 職責 |
> |---|---|---|
>
> **上游依賴**：（本模組 import 誰）
> **下游使用者**：（誰 import 本模組）

## 這個模組解決什麼問題
（3～6 行，講存在的理由，不是功能列表）

## 核心概念
（關鍵資料結構與心智模型，附 file:line）

## 主要流程
（呼叫鏈／生命週期，附 file:line）

## 契約與陷阱
（改動時必須遵守什麼、常見誤解）

## 我想改 X → 動哪裡
| 想改什麼 | 動哪裡 | 注意 |

## 相關頁面
```

---

## 改了程式碼 → 要回寫哪裡

**這張表是本頁的核心。** 改動後請對照它更新對應文件。

| 你改了 | 必須回寫 |
|---|---|
| `data/glyphs.ts`（字表） | [02-data-tables.md](02-data-tables.md) 的內容量與分類統計、[CLAUDE.md](../../CLAUDE.md) 的內容量 |
| `data/generals.ts`（武將） | 同上，另加 [02](02-data-tables.md) 的階級分布 |
| `data/bonds.ts`（羈絆） | [02](02-data-tables.md) 的羈絆數、[modules/04](modules/04-combat-and-skills.md)、`docs/game-design.md` §5.5 的羈絆表 |
| `data/enemies.ts`（敵人／BOSS） | [modules/05](modules/05-economy-and-waves.md) 的敵表、[02](02-data-tables.md) 的敵種數與 traits 表、`docs/game-design.md` §7.4、[00-index](00-index.md) 的內容量 |
| `data/enemies.ts` 的 `TRAIT_COUNTERS`（新增 trait） | 同上，**並確認 `TRAIT_LABEL` 與 `COUNTER_LABEL` 都補齊**（`enemies-ext.test.ts` 會檢查） |
| `data/levels/index.ts` 的 `mods`（戰場特性） | [modules/03](modules/03-board-and-mapgen.md) 的 `LevelDef` 欄位表與「`mods` 一個欄位驅動兩件事」、[CLAUDE.md](../../CLAUDE.md) 的「戰場特性」段。⚠ 新增旋鈕要同時補：`LevelMods`（types.ts）、讀它的那一處 sim、`modTags()` 的說明、`level-mods.test.ts` 的中性預設值測試 |
| `sim/step.ts` 的 `stepFrenzy`／`stepEnemySupport`（卡波防線） | [modules/05](modules/05-economy-and-waves.md) 的「卡波與督戰」與「敵方光環一律有疊加上限」、[CLAUDE.md](../../CLAUDE.md) 的「卡波」段。⚠ **三層缺一不可**（互不治療／疊加上限／督戰），改前先讀那兩節為什麼 |
| `data/levels/index.ts`（關卡／`bias`） | [modules/03](modules/03-board-and-mapgen.md) 的關卡表、[02](02-data-tables.md) 的關卡表、`docs/game-design.md` §8.1、**並更新各關 sim 中位數** |
| `data/shop.ts` / `upgrades.ts` | [modules/06](modules/06-meta-progression.md)，若改價格要更新總價與局數估算 |
| `data/achievements.ts`（成就） | [modules/06](modules/06-meta-progression.md) 的成就節、[00-index](00-index.md) 的內容量、`docs/game-design.md` §8.2 的分區表；**改獎勵要重算總額**（目前 2130，須夾在兵書 1230 與商城 13590 之間，有守護測試） |
| `data/loadout.ts` | [modules/06](modules/06-meta-progression.md) |
| `data/daily.ts`（每日挑戰） | [modules/06](modules/06-meta-progression.md) 的每日挑戰節、`docs/game-design.md` §8.2 |
| `data/levels/index.ts` 的**無盡節** | [modules/03](modules/03-board-and-mapgen.md) 的「無盡變體」（關卡側）＋ [modules/06](modules/06-meta-progression.md) 的「獨立的高分榜」（局外側）、`docs/game-design.md` §8.2 |
| `sim/persist.ts` 的 `RunSnapshot` | [modules/06](modules/06-meta-progression.md) 的續玩節、[04-invariants](04-invariants.md)。⚠ **新增 `GameState` 可變欄位時要一併加進快照**，漏了會靜默遺失 |
| `sim/skills.ts`（技能／組合技） | [modules/04](modules/04-combat-and-skills.md) 的原型清單與註冊表數量、[02](02-data-tables.md) |
| `sim/combat.ts` 的常數 | [modules/04](modules/04-combat-and-skills.md)、[02](02-data-tables.md) 的公式區、[03-change-recipes.md](03-change-recipes.md) 的難度旋鈕表 |
| `sim/waves.ts`（`HP_GROWTH` 等） | [modules/05](modules/05-economy-and-waves.md)、`docs/game-design.md` §7.5，**並更新各關 sim 中位數**。⚠ 若整條曲線一起偏移，要改的是 `tools/autobalance.ts` 的 `DEATH_REF`，不是各關的 `arc` |
| `sim/economy.ts` | [modules/05](modules/05-economy-and-waves.md)、`docs/game-design.md` §6，**並跑 `npm run econ` 確認「一波征兵 1～2 次」仍成立** |
| `data/enemies.ts` 的 `bounty` | 同上——它佔總收入約 65%，是經濟的主力旋鈕，改它一定要跑 `npm run econ` |
| `data/glyphs.ts` 的 `atk`（整批縮放） | [02](02-data-tables.md) 的平衡基準（「刀」那把尺）、**並跑 `npm run sim 16 all`** |
| `level.arc`（難度弧長度＝**難度主旋鈕**） | 更新 [modules/03](modules/03-board-and-mapgen.md) 與 [02](02-data-tables.md) 的關卡表（含「比例」欄）、`docs/game-design.md` §8.1、[CLAUDE.md](../../CLAUDE.md) 的難度儀表板段，並重跑 `npm run sim 16 all` |
| `level.maxWave` | 它現在**只是關卡長度**（難度看 `arc`）。仍要更新上面那些關卡表，因為預期中位數 = `maxWave × 20 / arc` 會跟著變 |
| `sim/state.ts` 的 `recalcUnits` / `MetaProgress` | [modules/01](modules/01-state-and-units.md)、若動 `MetaProgress` 還要看 [modules/06](modules/06-meta-progression.md) 與 `core/save.ts` 的遷移 |
| `sim/actions.ts`（新增操作） | [modules/02](modules/02-actions-and-combine.md) |
| `sim/types.ts` 的 `Perks` | [modules/06](modules/06-meta-progression.md) 的 Perks 對應表 |
| `sim/autoplay.ts` 的旋鈕（`TUNE` / `THINK_INTERVAL`） | [CLAUDE.md](../../CLAUDE.md) 的「AI 代管」段，**並跑 `npm run ai` 前後對照**：同時記下各關波數中位數與**耗時**（耗時就是手機的發熱量表，改決策頻率一定要看它） |
| `sim/autoplay.ts` 的估值函式（`Cov`／`Geom.runs`／`defInfo`） | 這些是**純快取**，行為必須完全不變：跑 `npm run ai` 對照各關中位數（數字要一樣）與耗時（要更低）。[CLAUDE.md](../../CLAUDE.md) 的「AI 代管」段有現況耗時 |
| `core/loop.ts` 的 `MIN_FRAME`／`render/renderer.ts` 的地形快取／`ui/hud.ts` 的 `setText` | [modules/07](modules/07-presentation.md)（每幀、渲染分層、契約 5）。這三處都是**省電**設計，改動前先確認理解「為什麼不能每幀重畫」 |
| `ui/hud.ts` / `index.html` / `style.css`（HUD 版面） | [modules/07](modules/07-presentation.md) 的檔案規模表（行數）、核心概念的狀態列／底部浮層兩段，**並校對「契約與陷阱」裡所有 `hud.ts:行號`**——HUD 是行號最密集的一頁 |
| 新增檔案到 `src/` | [00-index.md](00-index.md) 的檔案地圖 **＋** 對應的 `modules/` 頁；若是新子系統，照模板開新頁 |
| 新增／移除測試檔 | [04-invariants.md](04-invariants.md) 的測試涵蓋清單與測試總數 |
| 任何**增減行數**的改動（不只改值） | **回頭校對所有引用該檔的頁面的 `檔案:行號`**。`sim/types.ts`／`state.ts`／`step.ts`／`combat.ts` 被 [modules/01](modules/01-state-and-units.md)、[02](modules/02-actions-and-combine.md)、[04](modules/04-combat-and-skills.md)、[05](modules/05-economy-and-waves.md)、[06](modules/06-meta-progression.md)、[07](modules/07-presentation.md) 大量引用，改一次就會同時弄髒六頁。做法見下方「怎麼驗證文件沒失效」 |
| `npm test` 的測試數變了 | [04-invariants.md](04-invariants.md) 的測試總數 **＋ [CLAUDE.md](../../CLAUDE.md) 指令區塊的註解** |
| 完成 [06-roadmap.md](06-roadmap.md) 的項目 | 把該項移到 roadmap 的「已完成」區並註明日期 |

---

## 常犯的文件錯誤（歷史教訓）

這些都是真的發生過、造成後續改動踩坑的案例：

| 錯誤類型 | 實例 |
|---|---|
| **把契約掛在錯的函式上** | 曾把「橫向縱向各回傳一個」寫在 `findCombination`（單數，測試專用）上，實際正式路徑是 `findCombinations`。照文件接新 action 會**靜默**失去十字成雙 |
| **指向沒有效果的位置** | 曾說武將戰力公式在 `makeGeneralUnit`，實際在 `recomputeForm`——改前者完全沒有作用 |
| **範例缺必填欄位** | 新增關卡的範例漏了 `pool`，照抄直接 TS 編譯錯誤 |
| **函式改名沒同步** | `moveUnit`／`sellUnit` 實際是 `moveGlyph`／`sellGlyph` |
| **數字沒跟著改** | 內容量、測試數、`HP_GROWTH`、商城總價都曾各自過時 |
| **資料表數字被誤當實戰值** | 資料表的 `range` 還要經過 `RANGE_MUL` 等疊乘，規格書長期直接把它當實戰射程 |
| **平衡註解沒重算** | 商城總價註解寫 9000，實際 13590（漏算每級成長項） |
| **修好的 bug 還被寫成現存陷阱** | 組合技 cdMax 少乘 `perks.cdMul` 修好後，模組頁仍把它列為待修陷阱。**修 bug 時要一起搜尋文件裡對它的描述** |
| **自己的修正讓行號位移** | 改 `sim/bonds.ts` 後，模組頁 9 處 `bonds.ts:NN` 全部失效。動過的檔案要回頭校對引用它的頁面 |
| **只回寫「主場」頁面，忘了旁邊四頁** | 敵種擴充只動了 `data/enemies.ts` 與 `sim/waves.ts` 的**內容**，但順手在 `state.ts:160` 插了一行 `bias`、在 `types.ts` 插了 33 行——結果 modules/01・04・06・07 共約 90 個 `檔案:行號` 全部位移一格到三十三格，全部指到錯的地方。**回寫時先問「我增減了哪些檔案的行數」，再問「誰引用了那些檔案」** |

**共通模式**：出錯的幾乎都是「數字」與「函式名」。回寫時優先檢查這兩類。

---

## 怎麼驗證文件沒失效

改完後跑這幾個檢查：

```bash
npm test          # 資料表完整性、技能註冊表對得上、羈絆門檻相容性都有測試把關
npm run typecheck
npm run sim 16 all # 改任何數值後必跑；主線各關的「比例」要一路遞減（1.00 → 0.35）
npm run econ      # 改經濟數值後必跑；征兵次數目標 1～2 次/波
```

**內容量數字**不要手數，用程式算（避免再出現數錯的情況）：

```bash
npx tsx -e "
import { GLYPHS } from './src/data/glyphs';
import { GENERALS } from './src/data/generals';
import { BONDS } from './src/data/bonds';
import { SKILLS, COMBOS } from './src/sim/skills';
const c = {}; for (const g of GLYPHS) c[g.category] = (c[g.category] ?? 0) + 1;
const t = {}; for (const g of GENERALS) t[g.tier] = (t[g.tier] ?? 0) + 1;
console.log('字', GLYPHS.length, c);
console.log('武將', GENERALS.length, t);
console.log('羈絆', BONDS.length, '主動技', Object.keys(SKILLS).length, '組合技', Object.keys(COMBOS).length);
"
```

**測試數**請以 `npm test` 的輸出為準，**不要用 grep 數 `it(` 的數量**——
`shop.test.ts` 與 `roster-ext.test.ts` 用迴圈產生測試案例，靜態計數會少算約 29 個。

**行號**是最容易失效的部分，而且**不要用抽查**——抽查抓不到「整頁一起位移一格」。
把該頁所有引用一次印出來對照才可靠（bash，把 `<頁面>` 換掉）：

```bash
grep -o -E '(state|types|step|combat|actions|waves|economy|pool|skills|bonds)\.ts:[0-9]+' <頁面> \
  | sort -u | while IFS=: read -r f n; do
      p=$(ls src/sim/$f src/data/$f 2>/dev/null | head -1)
      printf '%-12s %-5s | %s\n' "$f" "$n" "$(sed -n "${n}p" "$p")"
    done
```

輸出的每一行都應該長得像該頁對它的描述；對不上的就是位移了。
**動過任何 `src/` 檔案的行數之後，對每個引用它的頁面各跑一次**。

---

## 有測試把關的不變量（不必靠人記）

這些規則已經寫成測試，違反會直接紅燈——這是比文件更可靠的防線：

| 不變量 | 守護測試 |
|---|---|
| `SKILLS` 的鍵都對應真實武將名 | `core.test.ts` |
| `COMBOS` 的鍵都對應有 `comboSkill` 的羈絆 | `core.test.ts` |
| 地圖每列長度 == cols、路徑連通 | `core.test.ts` / `mapgen.test.ts` |
| 隨機地圖的走廊不變量（可走格數 == 路徑長度） | `mapgen.test.ts` |
| 字池不含湊不成配方的孤兒姓名字 | `pool.test.ts` |
| `perksFrom` 等級 0 時全部欄位為中性值 | `shop.test.ts` |
| 每種商城道具只影響自己負責的 `Perks` 欄位 | `shop.test.ts` |
| 羈絆門檻不超過編隊武將上限（否則永遠湊不齊） | `loadout.test.ts` |
| 13 種 BOSS 的機制指紋互不相同（不能只是血量差異） | `enemies-ext.test.ts` |
| 治療者之間不互相治療、敵方光環疊加有上限、單波敵種佔比有上限 | `stall.test.ts` |
| **僵局一定會被督戰打破**（波次不會永遠卡住），而正常推進與磨血不會誤觸發 | `stall.test.ts` |
| 戰場特性 `mods` 的每個欄位省略時完全等同舊行為（中性預設值） | `level-mods.test.ts` |
| 死亡分裂圖無環、單次分裂總量有上限 | `enemies-ext.test.ts` |
| 每個用到的 `EnemyTrait` 都有對應的應對手段與中文標籤 | `enemies-ext.test.ts` |
| 關卡 `bias` 都是合法 trait 且有敵人帶該 trait | `enemies-ext.test.ts` |
| 血量指數吃「相對進度」：同進度百分比 → 同血量 | `core.test.ts` |
| `maxWave = Infinity`（無盡）時弧長退回 `WAVE_REF`，且永遠不會通關 | `endless.test.ts` |
| 無盡變體都由原關推導，且不在 `LEVEL_ORDER` 裡 | `endless.test.ts` |
| `buildWave` 有把 `maxWave` 傳進血量計算 | `core.test.ts` |
| 同種子產生同一場對局 | `core.test.ts` / `enemies-ext.test.ts` |
| 續玩還原後走出完全相同的一局 | `persist.test.ts` |
| 每日挑戰的日期 → 挑戰是決定性的 | `persist.test.ts` |

**新增機制時請一併補測試**——尤其是 `sim/` 裡的純函式，它們是本專案最便宜的保險，
也讓文件不必承擔「記住所有規則」的責任。
