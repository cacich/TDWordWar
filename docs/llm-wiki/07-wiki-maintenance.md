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
| `data/enemies.ts`（敵人） | [modules/05](modules/05-economy-and-waves.md) 的敵表、`docs/game-design.md` §7.4 |
| `data/levels/index.ts`（關卡） | [modules/03](modules/03-board-and-mapgen.md)、`docs/game-design.md` §8.1 |
| `data/shop.ts` / `upgrades.ts` | [modules/06](modules/06-meta-progression.md)，若改價格要更新總價與局數估算 |
| `data/loadout.ts` | [modules/06](modules/06-meta-progression.md) |
| `sim/skills.ts`（技能／組合技） | [modules/04](modules/04-combat-and-skills.md) 的原型清單與註冊表數量、[02](02-data-tables.md) |
| `sim/combat.ts` 的常數 | [modules/04](modules/04-combat-and-skills.md)、[02](02-data-tables.md) 的公式區、[03-change-recipes.md](03-change-recipes.md) 的難度旋鈕表 |
| `sim/waves.ts`（`HP_GROWTH` 等） | [modules/05](modules/05-economy-and-waves.md)、`docs/game-design.md` §7.5，**並更新各關 sim 中位數** |
| `sim/economy.ts` | [modules/05](modules/05-economy-and-waves.md)、`docs/game-design.md` §6 |
| `sim/state.ts` 的 `recalcUnits` / `MetaProgress` | [modules/01](modules/01-state-and-units.md)、若動 `MetaProgress` 還要看 [modules/06](modules/06-meta-progression.md) 與 `core/save.ts` 的遷移 |
| `sim/actions.ts`（新增操作） | [modules/02](modules/02-actions-and-combine.md) |
| `sim/types.ts` 的 `Perks` | [modules/06](modules/06-meta-progression.md) 的 Perks 對應表 |
| 新增檔案到 `src/` | [00-index.md](00-index.md) 的檔案地圖 **＋** 對應的 `modules/` 頁；若是新子系統，照模板開新頁 |
| 新增／移除測試檔 | [04-invariants.md](04-invariants.md) 的測試涵蓋清單與測試總數 |
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

**共通模式**：出錯的幾乎都是「數字」與「函式名」。回寫時優先檢查這兩類。

---

## 怎麼驗證文件沒失效

改完後跑這幾個檢查：

```bash
npm test          # 資料表完整性、技能註冊表對得上、羈絆門檻相容性都有測試把關
npm run typecheck
npm run sim       # 改任何數值後必跑
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

**行號**是最容易失效的部分。抽查方式：隨機挑幾個 `檔案:行號` 引用，確認該行仍是所描述的內容。
若某頁大幅改動過，優先重新驗證該頁的行號。

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
| 同種子產生同一場對局 | `core.test.ts` |

**新增機制時請一併補測試**——尤其是 `sim/` 裡的純函式，它們是本專案最便宜的保險，
也讓文件不必承擔「記住所有規則」的責任。
