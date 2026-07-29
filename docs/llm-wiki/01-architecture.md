# 架構

## 分層與依賴方向

```
        data/ ─────┐  純資料表，沒有邏輯
                   ↓
        sim/  ─────┤  純邏輯，不認識瀏覽器
                   ↓
   render/ ui/ input/  呈現與操作
                   ↓
        app.ts        唯一的接線層
```

- `sim/` 與 `data/` **不得 import** render / ui / input / DOM。這讓遊戲能在 Node 執行 → 單元測試與 `npm run sim` 才成立。
- `render/` 只讀 state，不改 state。
- `input/` 與 `ui/` 只透過 `sim/actions.ts` 改變狀態。
- `app.ts` 是唯一知道全部四層的檔案；要加跨層功能就加在這裡。

## 一幀的生命週期

`core/loop.ts` 的 `startLoop(step, render)`：

```
requestAnimationFrame
  ├─ acc += 實際經過時間 × 速度倍率(1/2/3×)
  ├─ while (acc >= 1/60)  →  stepGame(state, 1/60)      ← 模擬，固定步長
  └─ render()
       ├─ renderer.draw(state)   畫棋盤／單位／敵人／特效／拖曳
       └─ hud.update(frameDt)    更新 DOM
```

固定步長的理由：不同裝置行為一致、`npm run sim` 的結果可重現、bug 可用種子重播。
掉幀超過 8 步就放棄補算（`MAX_STEPS_PER_FRAME`），避免卡頓雪球。

## `stepGame` 內部順序（src/sim/step.ts）

```
phase === 'prep'   → prepTimer 遞減 → 歸零則 beginBattle()
                   → stepEffects() → return（佈陣階段只推進特效）
phase === 'battle' → spawnDue()          依 spawnQueue[].at 生成敵人
                   → stepStatuses()      控場倒數與灼燒持續傷害
                   → stepEnemySupport()  敵方回血光環與自我再生
                   → moveEnemies()       沿 path 前進；抵達 camp 扣生命
                   → stepCombat()      索敵、傷害、特效
                   → stepSkills()      武將主動技
                   → stepBondSkills()  羈絆組合技
                   → stepMeteor()        流星火雨（局外道具）
                   → stepEffects()       特效壽命
                   → cleanupDead()       移除 hp<=0，並展開死亡分裂
                   → checkWaveEnd()      隊列與場上皆空 → 結算收入、進下一波
```

**順序有意義**：
- 先生成再移動，剛生成的敵人當幀就能被打
- `stepStatuses` 在 `moveEnemies` **之前**，定身才能當幀生效
- `stepEnemySupport`（回血）緊接在 `stepStatuses`（灼燒）之後，讓兩者在同一幀正面對撞
- `cleanupDead` 在所有傷害來源之後，才不會有 hp<=0 的敵人被重複結算；
  **死亡分裂也只能在這裡做**，在傷害來源那邊 push 會造成同幀連鎖分裂

詳細逐步說明見 [modules/05-economy-and-waves.md](modules/05-economy-and-waves.md)。

## GameState 形狀（權威定義在 src/sim/types.ts）

```ts
GameState {
  board: { cols, rows, tiles[], path[], spawn, camp }   // path 是 cell 索引序列
  rng: () => number                    // ⚠ 閉包。內部狀態其實只是一個 uint32（core/rng.ts）
  units: Unit[]        // 場上所有字牌與武將（★ 一格可能有多個）
  enemies: Enemy[]     // 位置用 dist（沿 path 的浮點進度）表示，不存 x/y
  effects: Effect[]    // 純資料，render 負責畫
  events: SimEvent[]   // 事件佇列，app 層每幀 drain 成音效與粒子
  hand: (HandCard|null)[]   // 長度 = handSize（5，局外養成可到 8）
  food, lives, maxLives, wave, maxWave, phase, prepTimer, spawnQueue[], waveTime
  pool: string[], poolGenerals: string[]   // 本局字池（見 sim/pool.ts）
  wishes: string[], wishSlots               // 心願單
  perks: Perks         // 局外道具推導出的被動效果（見 data/shop.ts），整局固定
  meteorTimer          // 流星火雨倒數（runtime）
  recruitsThisWave, smeltFreeLeft, lastIncome
  // ── 以下皆為衍生值，由 recalcUnits() 重算，不要手動改 ──
  activeBonds[], bondCds{}, cdMul, hints[], hintCells[]
  stats: { kills, foodEarned, leaks }
}
```

權威定義在 `sim/types.ts`；欄位語意與生命週期見
[modules/01-state-and-units.md](modules/01-state-and-units.md)。

**座標系統**：`sim/` 一律以「格」為單位（cell 索引或浮點格座標）；換算成畫布 px 只發生在 `render/renderer.ts`。
敵人位置是 `dist`（沿 path 的進度），`sim/combat.ts` 的 `enemyPos()` 才插值出格座標——這讓「穿透」等機制可以直接比較 `dist`。

## 衍生值與 recalcUnits

`Unit` 同時存基礎值與實效值：

| 欄位 | 意義 |
|---|---|
| `baseAtk` / `baseAps` / `baseRange` | 不含羈絆的值，建立單位時算好就不再變 |
| `atk` / `aps` / `range` | 實效值，`recalcUnits()` 用羈絆倍率覆寫 |

所以**任何改動 units 或 hand 的地方都必須呼叫 `recalcUnits(state)`**，
否則羈絆加成與 UI 的「可組成」提示會停在舊值。`sim/actions.ts` 裡的每個 action 都已經自己呼叫。

## ★ 字牌與武將的關係（最重要的模型認知）

**武將不會取代字牌，而是疊在字牌上的一層。** `state.units` 同時包含兩者，格子會重疊：

```
state.units = [
  { kind:'glyph',   chars:['張'], cells:[12], level:2, formIds:[4,5] },  ← 同時屬於兩個武將
  { kind:'glyph',   chars:['遼'], cells:[13], level:1, formIds:[4]   },
  { kind:'glyph',   chars:['飛'], cells:[21], level:1, formIds:[5]   },
  { kind:'general', defKey:'張遼', cells:[12,13], memberIds:[…] },
  { kind:'general', defKey:'張飛', cells:[12,21], memberIds:[…] },
]
```

因此：

- **不可以假設「一格一個 unit」**。要取用請用 `glyphAt(state, cell)` 與 `formsAt(state, cell)`
- 武將的屬性一律由 `recomputeForm()` 從成員字牌**現算**，所以字牌升階後武將立刻變強
- 已成為武將成員的字牌（`formIds.length > 0`）**不參與**：`stepCombat` 的攻擊、
  `recalcUnits` 的光環投射、`unitIncome` 的產糧 —— 這三處都要跳過，否則會重複計算
- 搬動與鏟除的對象一律是字牌；相關武將由 `dissolveFormsOf()` 解除

## 組詞判定的合約

> ### ⚠ 先看這個：有兩個名字很像的函式，只有一個是正式路徑
>
> | 函式 | 回傳 | 誰在用 |
> |---|---|---|
> | **`findCombinations()`（複數）** | 橫向與縱向**各一個**結果 | ✅ **正式路徑**：`sim/actions.ts` 的 `tryCombine()` |
> | `findCombination()`（單數） | 複數版的薄 wrapper，用 `betterThan` 把兩個方向 **reduce 成一個** | 只有 `combine.test.ts` 與 `tools/autobalance.ts` 的傻 AI 落點評分 |
>
> **把新 action 接到單數版，會靜默失去「十字同時成兩將」**——型別檢查與現有測試都不會報錯。
> 一律用 `tryCombine()`（它內部呼叫複數版）。

`sim/combine.ts` 的 `findCombinations(board, units, changedCell)`：

1. 只掃 `changedCell` 所在的**一列與一欄**（其他位置的組合在它們自己被放置時就判定過了）
2. 只有 `kind === 'glyph'` 的單位參與；武將不再參與組詞（設計決定 #3）
3. 取包含 `changedCell` 的連續字牌序列，比對 `RECIPE_INDEX`（`data/generals.ts` 建立的 `Map<'張飛', GeneralDef>`）
4. **橫向與縱向各回傳一個最佳結果**（同方向多個命中時先比階級 `TIER_ORDER`、再比字數）
   → 所以一次放置最多同時成兩將
5. 已經存在的武將（同名 + 同格子）會被跳過，不會重複產生
6. **純函式**，不改 state。真正的建立發生在 `sim/actions.ts` 的 `tryCombine()`

呼叫時機：`placeFromHand()`、`moveGlyph()`（含疊合升級後）。
新增任何會改變棋盤配置的 action 時，記得也要接上 `tryCombine()`。
細節見 [modules/02-actions-and-combine.md](modules/02-actions-and-combine.md)。

## UI 的三處契約

改版面時這三個地方必須同步，否則會在執行期拋「缺少 DOM 節點 #xxx」：

1. `index.html` — DOM 結構與 **id**（id 就是契約）
2. `src/style.css` — 樣式
3. `src/ui/hud.ts` — `el('id')` 取節點、每幀更新內容

`ui/hud.ts` 透過 `HudHost` 介面跟 `app.ts` 溝通，不直接 import App（避免循環依賴）。
`input/pointer.ts` 同理，用 `PointerHost` 介面。
