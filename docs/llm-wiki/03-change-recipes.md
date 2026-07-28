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

## 4. 新增敵人

1. `src/data/enemies.ts` 加一筆 `EnemyDef`
2. `src/sim/waves.ts` 的 `composition(wave)` 決定它從第幾波開始出現

```ts
function composition(wave: number): string[] {
  const pool = ['thief']
  if (wave >= 3) pool.push('swift')
  if (wave >= 9) pool.push('myNewEnemy')   // ← 加這行
  return pool
}
```

## 5. 新增關卡

**只改 `src/data/levels/index.ts`**：在 `LEVELS` 加一筆，再把 key 放進 `LEVEL_ORDER`
（順序就是解鎖順序，選單會自動長出卡片）。

固定地圖：

```ts
myLevel: {
  key: 'myLevel', name: '街亭', subtitle: '窄路，落點極少',
  startFood: 24, lives: 3, maxWave: 20, hpMul: 1.1,
  map: ['S########', 'PPPPPPPP#', '#########', /* … 每列長度必須一致 */],
}
```

隨機地形：把 `map` 換成 `gen`，其他都一樣。

```ts
gen: { cols: 9, rows: 14, minPathLen: 44, blockRate: 0.1 }
```

調隨機地形的手感：`minPathLen` 拉高 → 路更長更繞；`blockRate` 拉高 → 可放置的地更零碎。
改完跑 `npm test`（mapgen 測試會用 180 張地圖驗證連通性）與 `npm run sim 16 myLevel`。

## 6. 調整難度

| 想要的效果 | 改哪裡 |
|---|---|
| 整體變難／變簡單 | `sim/waves.ts` 的 `HP_GROWTH`（最有效，1.18 → 1.20 差很多） |
| 敵人變多 | `sim/waves.ts` 的 `enemyCount()` |
| 前期太窮 | `sim/economy.ts` 的 `recruitCost()` 常數 8、`waveIncome()` |
| 抽不到好字 | `sim/economy.ts` 的 `RARITY_TABLE`（每列總和要 100） |
| 佈陣時間 | `sim/waves.ts` 的 `PREP_SECONDS` |
| 塔打得到的範圍 | `sim/combat.ts` 的 `RANGE_MUL`（全域射程倍率，越大越簡單）／`GENERAL_RANGE_BONUS`（武將額外） |

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
2. `sim/combat.ts` 的 `applyStatus()` 寫入（會不會被 `ccImmune` 擋掉在這裡決定）
3. `sim/step.ts` 的 `stepStatuses()` 倒數並生效
4. `sim/state.ts` 的 `mergeOnHit()` 加一行，武將才會繼承
5. `render/renderer.ts` 的狀態小圓點 + `render/theme.ts` 的 `STATUS_COLOR` 加顏色
6. `ui/hud.ts` 的 `onHitText()` 加一行，資訊面板才看得到

這六處都要改，漏掉任何一處都會安靜地失效（例如漏 4 就只有字牌有效、武將沒有）。

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

```bash
npm run sim 100      # 跑 100 局統計，比手動試玩快得多
npm test -- combine  # 只跑組詞相關測試
```

要重現特定對局：`src/app.ts` 裡把 `createGame('julu', Date.now() >>> 0, meta)` 的種子換成固定數字。
