# 呈現與操作層（app / loop / render / ui / input）

> **負責檔案**
>
> | 檔案 | 規模 | 職責 |
> |---|---|---|
> | `src/app.ts` | 701 行 | 唯一同時認識四層的接線層：建 state、跑 loop、drainEvents、syncProgress、syncUiScale、實作三個 Host 介面 |
> | `src/core/loop.ts` | 60 行 | 固定步長模擬 + 可變渲染，掉幀保護、倍速、暫停 |
> | `src/core/audio.ts` | 199 行 | Web Audio 即時合成 19 種音效（專案零音檔），含手勢解鎖與攻擊音節流 |
> | `src/core/pwa.ts` | 28 行 | Service Worker 註冊（僅 production）＋ `isStandalone()` |
> | `src/render/renderer.ts` | 555 行 | Canvas 2D 主繪製：地形 → 提示 → 單位三趟 → 敵人 → 特效 → 粒子 → 拖曳影 |
> | `src/render/theme.ts` | 99 行 | 水墨配色、階級／品質／提示／狀態色表、`glyphFont()`、`roundRect()` |
> | `src/render/fx.ts` | 225 行 | 10 種 `FxKind` 的攻擊特效畫法與顏色 |
> | `src/render/particles.ts` | 193 行 | 極簡粒子（上限 240 顆，固定種子偽隨機） |
> | `src/ui/hud.ts` | 547 行 | DOM HUD：狀態列、手牌、操作列、羈絆條、資訊面板、羈絆詳情、toast |
> | `src/ui/screens.ts` | 822 行 | 九個全螢幕畫面（menu／codex／forge／shop／loadout／achieve／daily／endless／dev） |
> | `src/ui/wish.ts` | 85 行 | 心願單挑選面板（列本局字池，不是全字表） |
> | `src/input/pointer.ts` | 281 行 | Pointer Events：拖放、點選待放置、鏟除、疊合、交換 |
> | `index.html` | 239 行 | 全部 DOM 節點（HUD 與九個 `.screen` 都寫死在這裡，JS 只填內容） |
> | `src/style.css` | 1364 行 | 全部尺寸都是 `calc(var(--ui) * k)` 的等比 UI |
>
> **上游依賴**：`sim/`（讀 `GameState`、呼叫 `sim/actions.ts`）、`data/`（顯示名稱、配方、商城／兵書／編隊表）、`core/save.ts`
> **下游使用者**：只有 `src/main.ts`（建 `App`、註冊 SW、掛 `__game` / `__dev`）

## 這個模組解決什麼問題

把純資料的 `GameState` 變成畫面、聲音與可操作介面，**同時讓 `sim/` 完全不知道瀏覽器存在**。
`sim/` 能在 Node 裡跑（`npm run sim`、172 個單元測試）全靠這一層把所有副作用攔在外面。

## 核心概念

### 1. 四層只在 `app.ts` 交會

`app.ts:5-34` 是全專案唯一同時 import `core/` + `data/` + `sim/` + `render/` + `ui/` + `input/` 的地方。
其他模組**彼此不直接依賴**：

- `ui/hud.ts`、`ui/screens.ts`、`input/pointer.ts` 都不 import `app.ts`，而是定義自己的 Host 介面讓 app 實作
- `render/` 只讀 `GameState`，不寫（`renderer.ts:1-4` 的契約）
- `sim/`、`data/` 不 import 任何 render／ui／input／DOM

要新增「某個 UI 動作要改遊戲狀態」時，**唯一正確的路線**是：在對應 Host 介面加一個方法 → `App` 實作它並呼叫 `sim/actions.ts`。不要讓 ui 直接 import `sim/actions`（現況 `hud.ts` / `screens.ts` / `wish.ts` 都只 import `data/` 與 `render/theme`，請維持）。

### 2. ★ 事件佇列：`sim` 說發生了什麼，app 決定聽起來／看起來怎樣

`sim/` 只呼叫 `emit(state, ev)`（`sim/events.ts:9`）把純資料塞進 `state.events`，上限 `MAX_EVENTS = 64`（`sim/types.ts:318`），超量直接丟棄。
app 每幀 `drainEvents()`（`app.ts:258-320`）翻譯成音效與粒子，最後 `evs.length = 0`（`app.ts:319`）清空。

**目前 12 種 `SimEvent`（定義在 `sim/types.ts:303-315`）與各自的呈現**：

| 事件 | 音效 | 粒子／其他 | 程式碼 |
|---|---|---|---|
| `place {char}` | `place`（節流 0.04s） | — | app.ts:264 |
| `merge {char, level}` | `merge` | `ps.merge(格心, qualityColor(level))`；座標靠 `char` 反查場上第一個同字 glyph | app.ts:267-275 |
| `combine {name, tier, cells}` | `tier` 為 `legendary`/`mythic` → `combineBig`，否則 `combine` | `ps.combine(cells 形心, tier)`（粒子數與顏色依 tier） | app.ts:276-279 |
| `dissolve {name}` | `dissolve` | — | app.ts:280 |
| `attack {fx, x, y}` | `attackSfx(fx)`，音量 0.9 | 無粒子——攻擊的視覺走 `state.effects` + `render/fx.ts` | app.ts:283-285 |
| `kill {x, y, bounty}` | `kill`，音量 0.8（節流 0.05s） | `ps.kill(x, y)` 墨點 | app.ts:286-289 |
| `skill {name, x, y}` | `skill` | `ps.skill(x, y)` 金色火花 | app.ts:290-293 |
| `combo {name}` | `combo` | `ps.combo(大營格心)` + `hud.toast('組合技：…')` | app.ts:294-300 |
| `leak` | `leak` | `ps.leak(大營格心)` 紅色潑濺 | app.ts:301-307 |
| `waveClear {wave}` | `wave` | — | app.ts:308-309 |
| `won` | `win` | — | app.ts:311 |
| `lost` | `lose` | — | app.ts:314 |

`attackSfx()`（`app.ts:668-683`）把 10 種 `FxKind` 收斂成 5 個攻擊音：`blade`/`thrust` → `attackBlade`、`arrow` → `attackArrow`、`fire`/`venom` → `attackFire`、`bolt` → `attackBolt`、其餘（`gale`/`plan`/`charge`/`none`）→ `attackSoft`。

未被消費的 payload：`kill.bounty`、`waveClear.wave`、`dissolve.name`、`skill.name`、`combine.name`——想加飄字或提示直接拿來用，不必改 sim。

### 3. 兩種「特效」不要搞混

| | `state.effects`（`Effect[]`） | `Particles` |
|---|---|---|
| 誰產生 | `sim/`（`pushEffect()`，`sim/combat.ts:240`） | app 層 drainEvents |
| 誰推進 | `sim/`（`stepEffects()`，`sim/combat.ts:341`，固定步長） | `Particles.step(frameDt)`，在 `renderer.draw()` 裡（`renderer.ts:122`） |
| 誰畫 | `renderer.drawEffects()`（`renderer.ts:477`）＋ `render/fx.ts` | `particles.draw()`（`renderer.ts:123`） |
| 上限 | 240（`combat.ts:242`） | 240（`particles.ts:10`，`add()` 在 47-50 直接 return） |
| 在 Node 模擬時 | 會被建立與遞減（純資料，無害） | 完全不存在 |

兩邊超量都直接丟棄而非覆蓋：**特效只是視覺，少畫幾個沒人看得出來；但無上限成長會讓 `npm run sim` 的記憶體與 GC 爆掉**。

### 4. 三個 Host 介面

| 介面 | 定義處 | 邊界 |
|---|---|---|
| `HudHost` | `ui/hud.ts:14-47` | 讀狀態（`getState` / `getMode` / `isPaused` / `getSpeed` / `getArmedHand` / `isMuted` / `isAuto` / `getSelectedGlyph` / `getSelectedForms`）＋ 觸發玩家指令（`recruit` / `reroll` / `smeltHand` / `startWave` / `togglePause` / `cycleSpeed` / `toggleAuto` / `restart` / `sellSelected` / `cycleTargeting` / `select` / `setMode` / `beginHandDrag` / `openMenu` / `openWishPanel` / `closeWishPanel` / `toggleWish` / `toggleMute`） |
| `PointerHost` | `input/pointer.ts:18-28` | 只要 `getState` / `renderer`（做座標換算）/ `getMode` / `setMode` / `select` / `toast` / `onCombined`。**注意它直接持有 `renderer`**，因為要用 `cellFromPoint()` 與寫 `renderer.view.drag` |
| `ScreensHost` | `ui/screens.ts:43-76` | 局外事務：`getMeta` / `achieveProgress` / `startLevel` / `startDaily` / `startEndless` / 三個續玩方法 / `show` / `buyUpgrade` / `buyItem` / 三個 loadout 方法 / 七個 dev 方法。**完全不碰 `GameState`**——成就畫面要的進度是 app 層算好成 `Record<key, number>` 再交過來，就是為了守住這個性質 |

`App` 一次實作三個（`app.ts:39`）。`WishHost`（`ui/wish.ts:10-14`）是第四個小介面，只要 `getState` / `toggleWish` / `closeWishPanel`。

### 5. `--ui` 等比縮放

`syncUiScale()`（`app.ts:130-138`）：

```
ui = clamp(9.5, 18, min(#app 寬 / 27, #app 高 / 56))   // app.ts:134
```

**同時吃寬與高**：只看寬度時，矮而寬的視窗（橫置手機、桌面把視窗壓扁）會讓文字放大到壓掉棋盤區。
寫到 `document.documentElement.style` 的 `--ui`，`style.css` 全檔用 `calc(var(--ui) * k)`（`style.css:1-15` 的規則：**不准在 CSS 裡寫死 px 字級**）。

`#app.dataset.compact = 寬 < 320`（`app.ts:144`）→ `style.css` 在極窄視窗把讀數區的間距與內距壓到最小。想加更多 compact 降級項就照這條 selector 疊。

觸發時機（`app.ts:88-103`）：`window resize`、`orientationchange`、canvas 的 `ResizeObserver`、`#app` 的 `ResizeObserver`。canvas 的 CSS 尺寸會因浮層／軟鍵盤／瀏覽器工具列改變，**光靠 window resize 會漏**。

### 6. 狀態列是「三區」，關卡名靠實測決定要不要顯示

`#topbar`（`index.html:27-48`）分成三區而不是把元素平鋪一排：

```
[☰ ❚❚]   [ 糧 47 │ ♥ 3 │ 黃巾之亂 波 15/32 ]   [代管 1× ♪]
 .bar-side          .bar-stats（有底色的讀數區）      .bar-side
```

為什麼要分區：早期版本九個元素並列，按鈕與數字交錯，一到手機寬度就分不出哪些是資訊、哪些可以按。
中間區給一塊淡底色＋圓角邊框，它就讀得出來是「儀表」。生命也從 `♥.repeat(lives)` 改成
**一顆心 + 數字**（`hud.ts:237-238`）——心數會隨兵書升級成長，平鋪時六顆以上根本數不出來，還吃掉半條狀態列。

`.bar-stats` 內的三個讀數 **`flex: 0 0 auto`（不准壓縮）**，唯一可犧牲的是 `#level-name`。
要不要顯示它由 `Hud.fitLevelName()`（`hud.ts:141-147`）**實測溢出**決定，不是寬度斷點：
關卡名長度 2～7 字（`巨鹿` ～ `黃巾之亂・無盡`）、糧 1～4 位數、波數 2～5 字元，任何斷點都會在某個組合下失準。
做法是先把名字設回可見再量 `scrollWidth > clientWidth`（先還原才量，否則變寬之後永遠放不回來），
並用 `lastFitKey`（讀數區寬度＋糧位數＋波數字串長度）節流，避免每幀強制 reflow。
實測結果：375px 寬（`--ui ≈ 13.9`）塞不下 4 字關卡名，560px 塞得下。

### 7. 三個底部浮層互斥

`#infopanel`（字牌／武將詳情）、`#wishpanel`（心願單）、`#bondpanel`（羈絆詳情）疊在棋盤底部**同一塊空間**，
共用 `style.css` 的同一組樣式。互斥規則寫在 `hud.ts`：

- 開羈絆詳情 → `showBond()`（`hud.ts:223-231`）先 `host.select(null)` + `host.closeWishPanel()`
- 點棋盤 → `updateBondPanel()`（`hud.ts:374-398`）看到 `!info.hidden` 就把 `openBond` 清掉（字牌詳情優先）
- 羈絆被拆掉 → 同一個函式找不到對應的 `activeBond` 就收面板，不會停在一份已失效的說明上

羈絆詳情的內容由 `bondDetailHtml()`（`hud.ts:467-504`）從 `BONDS`（`data/bonds.ts`）＋ `ActiveBond` 現算，
拆成**條件／加成／組合技**三段：條件列出「誰在撐著這條羈絆」（tag 型還印 `6/4` 這種現況比門檻）、
加成把倍率翻成 `+30%` / `−25%`、組合技印 desc 與剩餘冷卻。刻意不直接印 `bond.desc` 了事——
那句話把條件與加成混在一起，玩家沒辦法比較兩個羈絆誰值得湊。

## 主要流程

### 啟動

`main.ts:11` `new App(canvas, loadMeta())` → `app.ts:72-124` 建 state / renderer / hud / screens / wishPanel / input / audio → 掛手勢解鎖與 resize 監聽 → `startLoop(...)` → `this.show('menu')`（`app.ts:123`，開場一定停在選單）。`main.ts:12` 才註冊 SW，`main.ts:21-40` 掛 `__dev`。

### 每幀（`core/loop.ts:26-41`）

```
elapsed = min(now - last, 0.25s)          // loop.ts:27 分頁切回來不要一次補算幾百步
acc += elapsed * speed                     // 倍速就是往累加器多灌時間
while (acc >= 1/60 && steps < 8) step(1/60) // loop.ts:32-36
if (steps === 8) acc = 0                    // loop.ts:37 掉幀保護：放棄補算
render(acc / FIXED_DT)                      // loop.ts:39 每幀恰好一次
```

- **為什麼固定步長**：`sim/` 的行為必須與畫面幀率脫鉤，否則同一顆種子在 60Hz 與 144Hz 機器上會跑出不同結果，`npm run sim` 與單元測試（都用 `stepGame(s, 1/60)` 迴圈）也就不再能代表真實對局。
- **為什麼要 `MAX_STEPS_PER_FRAME = 8`**：慢機器上若堅持補完落後的步數，每幀的模擬時間會越長 → 落後更多 → 死亡螺旋。上限 8 步（約 133ms 模擬）之後把 `acc` 歸零，寧可讓遊戲「慢動作」也不要卡死。
- `render` 收到的 `alpha`（插值係數）**目前沒被使用**：`app.ts:110-120` 的 render callback 自己用 `performance.now()` 算 `frameDt`（同樣 clamp 0.25s，`app.ts:112`）餵給粒子與 toast 計時。沒有做位置插值——格狀塔防的視覺誤差看不出來。

render callback 的固定順序（`app.ts:110-120`）：寫入 `renderer.view.selectedCell` → `drainEvents()` → `renderer.draw(state, frameDt)` → `hud.update(frameDt)` → `wishPanel.update()`（僅開啟時）→ `syncProgress(frameDt)`。
**`drainEvents()` 必須在 `draw()` 之前**：粒子要在同一幀就被 `particles.step()` 推進與畫出。

### 畫面切換與凍結

`App.show(screen)`（`app.ts:440-446`）= `screens.show(screen)` + `loop.setPaused(screen !== null)`。
`Screens.show()`（`ui/screens.ts:167-288`）把八個 `.screen` 的 `hidden` 全設好（一次只顯示一個）再呼叫對應的 render 方法。`screen === null` 代表回對局。
雙重保險：`step` callback 另外檢查 `this.screens.visible`（`app.ts:107`），`syncProgress` 也在畫面開著時直接 return（`app.ts:146`）。
`dev` 畫面的入口是彩蛋：選單標題 2.5 秒內連點 7 下（`ui/screens.ts:156-165`）。

### 渲染分層（`renderer.ts:109-125`）

```
clearRect + 紙底 → drawTiles → drawHintCells(拖曳落點) → drawRangeIndicator
→ drawUnits（三趟）→ drawEnemies → drawEffects → particles.step + draw → drawDrag
```

`drawUnits()`（`renderer.ts:224-249`）刻意分三趟：

1. **武將底板** `drawFormBody`（`renderer.ts:291`）：`TIER_TINT[tier]` 的一整塊圓角矩形鋪在最底，把多格連起來
2. **字牌** `drawGlyphUnit`（`renderer.ts:251`）：成員字牌套武將底色且**不描邊**（`renderer.ts:266`），否則兩字之間會出現分隔線
3. **武將外框** `drawFormFrame`（`renderer.ts:326`）：`TIER_COLOR` 粗框、開火閃光、主動技冷卻條（`renderer.ts:353-360`）

**為什麼**：一個多格武將要讀起來是「一塊」，而不是幾張零散白卡；但字牌又必須各自保留可升級／可被拖走的視覺（等級角標、品質色）。一個字可同時屬於橫向與縱向兩個武將，所以兩個框用不同 `inset`（縱向 0.16、橫向 0.02，`renderer.ts:296-297`、`331-332`）錯開才看得出有兩個。

### 每幀重建的兩張衍生查表

- `memberTier`（`renderer.ts:60`，建於 226-233）：字牌格 → 所屬武將的**最高**階級，決定成員字牌底色
- `hintKind`（`renderer.ts:61`，建於 234-238）：消費 `state.hintCells`（`sim/types.ts:460-471`），一格同時可升級與可湊將時 **upgrade 優先**（更直接可做）

`drawHintHalo`（`renderer.ts:308-320`）用 `Math.sin(performance.now() / 320)` 做脈動描邊 + 柔光。顏色來自 `HINT_COLOR`（`render/theme.ts:51-54`）：

- `upgrade = '#1fb6c9'`（青）——**刻意避開二階品質色的綠 `#3f8f4f`**（`QUALITY_COLOR[1]`，`theme.ts:57`）。原本用綠色時，二階字牌自己的綠描邊與提示光暈疊在一起完全分不清
- `combine = '#d9a520'`（金，同 `THEME.gold`）

`performance.now()` 只出現在呈現層（`renderer.ts:310`、`app.ts:58/88`、`screens.ts:157`、`loop.ts` 內）。**`sim/` 內禁用**。

### 進度與存檔：`syncProgress()`（`app.ts:145-232`）

每幀做四件事，全在 app 層而**不在 sim 層——這樣 `sim/` 完全不知道 localStorage 與 `MetaProgress` 的存在**，`npm run sim` 也就不會污染玩家存檔：

1. 掃 `state.hand` 與 `state.units` 寫入 `meta.seenGlyphs` / `seenGenerals`（`app.ts:148-164`）
2. `meta.best[levelKey]`，**只在 `wave > 1` 才記**（`app.ts:175`），否則一進關卡就顯示「最佳 1 波」
3. `phase === 'won'` 時補 `meta.cleared`（`app.ts:195-198`）
4. 聲望結算：`renownPaid` 旗標保證一局只結一次（`app.ts:201-223`），數值由 `renownFor()`（`sim/state.ts:137`）算，並 toast 通知。`startLevel()` 會把旗標重設（`app.ts:555`）

寫檔節流：只有 `metaDirty` 時才倒數 `saveTimer`，**最多每 2 秒一次 `saveMeta()`**（`app.ts:226-231`）。局外操作（買升級／道具／改編隊）則走各自的 handler 立即存檔（`app.ts:372-407`）。

### 音效解鎖

瀏覽器自動播放政策：`AudioContext` 必須在使用者手勢後才建立。`app.ts:83-86` 用 `pointerdown` / `keydown` 各掛一個 `{ once: true }` 的 `unlock`；`Audio.unlock()`（`core/audio.ts:133-157`）建 ctx、master gain（0.9）與一段固定種子白噪音 buffer，已建立則只 `resume()` suspended 的 ctx。`toggleMute()`（`app.ts:354-360`）也會先呼叫 `unlock()`——玩家點喇叭本身就是有效手勢。
`Audio.play()` 在 ctx 還沒建立前呼叫是**安全的 no-op**（`audio.ts:160`），所以不需要在 drainEvents 裡判斷。
攻擊音節流表在 `audio.ts:102-110`（同名音效在該秒數內只播一次）：後期每秒 20 次攻擊全播會變成噪音牆。

### PWA

`registerServiceWorker()`（`core/pwa.ts:7-17`）：`if (!import.meta.env.PROD) return`。
`sw.js` 是 build 時由 `vite.config.ts` 的 `pwaPlugin()` 在 `generateBundle` 階段產生的（precache 清單要含 Vite 加了 hash 的檔名，所以不能手寫），**dev 模式沒有這個檔案**。

> 測離線／安裝必須 `npm run build && npm run preview`。`npm run dev` 永遠不註冊 SW。

註冊用相對路徑 `'./sw.js'` + `scope: './'`，因為 `base` 是 `'./'`（部署到 GitHub Pages 之類的子目錄也要能用）。失敗靜默忽略（http 非 localhost 環境會失敗，不該影響遊玩）。

## 契約與陷阱

1. **`sim/` 不可 import render／ui／input／DOM，`render/` 不可修改 `GameState`。** 想在 sim 裡播音效或噴粒子 → 加一種 `SimEvent`，在 `drainEvents()` 接。
2. **`renderer.view.drag` 是 input 寫、render 讀的共享可變狀態**（`renderer.ts:14-26`）。`input/pointer.ts` 直接 `Object.assign(this.drag, {...})`。取消拖曳一定要走 `cancel()`（`pointer.ts:230-236`），否則會留下永久的拖曳影。
3. **`input/` 唯一碰 DOM 的地方是 `handIndexAtPoint()`**（`pointer.ts:279-284`，用 `document.elementFromPoint` 找 `.card[data-index]`）。這也代表 `hud.buildHand()` 產生的卡片**必須帶 `data-index`**（`hud.ts:157`），否則「拖手牌到另一張手牌上疊合」會靜默失效。
4. **手牌卡片的 `pointerdown` 要 `setPointerCapture`**（`hud.ts:165-172`）：卡片內容每幀可能被重繪，不鎖指標的話手指移出卡片就收不到 move/up。
5. **HUD 的差異更新靠 `dataset.sig`**（手牌 `hud.ts:298`、心願列 `hud.ts:269`、羈絆條 `hud.ts:333`、羈絆詳情 `hud.ts:387`）。清空卡片時**必須 `delete card.dataset.sig`**（`hud.ts:288-293`），否則下次抽到同字同階會被誤判「沒變動」而不重繪。加新的視覺狀態（例如新角標）就要把它併進 sig 字串。
6. ★ **「選取框」與「詳情面板」是兩個獨立的狀態**（`app.ts` 的 `selectedCell` 與 `infoCell`）。
   `select(cell)` 兩者都設，**只有「真的點擊字牌」這條路徑會呼叫它**（`input/pointer.ts` 的 `onUp`，
   `src.kind === 'unit' && !this.moved`）；放置與搬移改走 `highlight(cell)`，只標落點、不開面板。
   ⚠ 這是刻意分開的：以前放置後會一併 `select()`，於是**連續放置時每放一張都會彈出詳情，
   玩家得先關掉才能繼續操作**。改動這一段時不要把兩者合回去。

7. **`getSelectedForms()` 可能回傳 0 個以上的武將**（上限不是 2，見 [modules/01](modules/01-state-and-units.md)），`getSelectedGlyph()` 可能為 null 而 forms 非空（字牌被鏟後不會發生，但邏輯上要處理）。所有面板都以「格子」為單位而非單位（`hud.ts:404-458`）。
7. **`--ui` 只由 `syncUiScale()` 寫。** 不要在 CSS 裡寫死 px 字級，也不要在 JS 別處覆蓋它。
8. **`index.html` 是 DOM 的唯一定義處。** `hud.ts:72-76` / `screens.ts:93-97` / `wish.ts:16-20` 的 `el()` 找不到節點會直接 `throw`，所以刪 HTML 節點會讓整個 App 建構失敗。加畫面要同時：`index.html` 加 `<section class="screen" hidden>`、`ScreenName` 加字面值（`screens.ts:31`）、`Screens.show()` 加 `hidden` 切換與 render 呼叫。
9. **`hidden` 屬性靠 `style.css:23-25` 的 `[hidden] { display: none !important }` 生效**，元件自己的 `display` 會壓過它。新元件用 `hidden` 而不要自己發明 `.is-open`。
10. **三個底部浮層（資訊／心願／羈絆詳情）不能同時開**（都占畫面底部，見核心概念第 7 段）：`select()` 會 `wishPanel.hide()`（`app.ts:607-612`），`openWishPanel()` 會清 `selectedCell`（`app.ts:341-345`），`showBond()` 兩個都關（`hud.ts:223-231`）。
11. **`startLevel()` 的重設清單**（`app.ts:537-562`）：`selectedCell` / `mode` / `renownPaid` / `particles.clear()` / `wishPanel.hide()` / `hud.onLevelChanged()` / `renderer.resize()`。新增任何「跨局會殘留」的 app 層欄位都要加進這裡。
12. **`newSeed()` 是 `Date.now()`**（`app.ts:663`）。要重現 bug 就把它改成固定值——這是唯一的隨機來源入口，`sim/` 內禁用 `Math.random()`（`particles.ts:27-33` 與 `audio.ts:151-154` 也都用固定種子的 LCG，讓畫面／音色在同機器上可重現）。
13. **`renderer.resize()` 的 dpr 上限是 2**（`renderer.ts:73`）：3x 螢幕全開會讓填充率變成 2.25 倍而幾乎看不出差別。
14. **`Effect.kind === 'ring'` 用 `toX - fromX` 攜帶半徑**（`renderer.ts:500-501`，產生端見 `sim/skills.ts`）。這是個省欄位的約定，改 `Effect` 結構時別忘了它。
15. **`FX_COLOR['none'] = 'transparent'`**（`fx.ts:23`）：圖鑑／編隊／心願面板拿 fx 當字色時必須排除 `none`，否則字會消失（`screens.ts:623`、`screens.ts:455`、`wish.ts:63` 都寫了 `g.fx !== 'none'` 的 fallback）。
16. **`drainEvents()` 依賴當幀 `state` 仍與事件一致**：`merge` 事件靠 `char` 反查場上單位取座標（`app.ts:269`），找不到就不噴粒子。不要把 drain 延後到下一幀。

## 我想改 X → 動哪裡

| 想改什麼 | 動哪裡 | 注意 |
|---|---|---|
| 新增一種 sim 事件的音效／粒子 | `sim/types.ts:303` 加 `SimEvent` 變體 → sim 內 `emit()` → `app.ts:262` 的 switch | switch 沒 `default`，漏接是靜默的；粒子要新方法就加在 `particles.ts` |
| 改某個音效的音色 | `core/audio.ts:46-99` 的 `RECIPES` | 只改這張表就好；新增音效名要同時加進 `SfxName`（`audio.ts:10-29`） |
| 攻擊音太吵／太稀疏 | `core/audio.ts:102-110` 的 `THROTTLE` | 秒數越大越安靜 |
| 新增一種攻擊特效 `FxKind` | `sim/types.ts` 的 `FxKind` → `render/fx.ts:13` 的 `FX_COLOR` → `fx.ts:56` 的 switch → `app.ts:668` 的 `attackSfx()` | 三處都要加，`FX_COLOR` 漏了會 undefined 導致整幀繪製異常 |
| 改階級／品質／提示／狀態顏色 | `render/theme.ts`（`TIER_COLOR:29` / `TIER_TINT:38` / `HINT_COLOR:51` / `QUALITY_COLOR:57` / `STATUS_COLOR:63`） | 提示色與品質色要保持可辨（見核心概念第 5 段的青綠衝突事故） |
| 改棋盤上某個東西的畫法 | `render/renderer.ts` 對應的 `drawXxx` | 保持三趟順序；不要在 draw 裡改 state |
| 加／改一個 HUD 元素 | `index.html` 加節點 → `hud.ts:79-110` 加 `el()` 欄位 → `hud.ts:231` 的 `update()` 寫值 | 高頻更新的請用 `dataset.sig` 差異比對 |
| 加一個 HUD 按鈕觸發遊戲動作 | `HudHost`（`hud.ts:14`）加方法 → `hud.ts:181` 的 `bind()` 綁 click → `App` 實作並呼叫 `sim/actions.ts` | 別讓 `hud.ts` 直接 import `sim/actions` |
| 往狀態列再加一個讀數 | `index.html` 的 `.bar-stats` 加 `.stat` → `hud.ts` 的 `update()` 寫值 | 讀數區在 375px 已接近塞滿（見核心概念第 6 段的實測）。再加一項就得先讓出別的東西，別靠壓縮字級硬塞 |
| 改羈絆詳情顯示的內容 | `bondDetailHtml()`（`hud.ts:467-504`） | 加成一律用 `pct()` 翻成 ±%；新增 `BondDef` 欄位要記得補進這裡，否則玩家看不到 |
| 加一個全螢幕畫面 | `index.html` 加 `.screen` → `ScreenName`（`screens.ts:31`）→ `Screens` 加 DOM 欄位、`show()` 的 `hidden` 切換與 `renderXxx()` → 需要動 meta 就在 `ScreensHost` 加方法 | 畫面開著時模擬會凍結（`app.ts:445`），這是刻意的。最近一例：無盡畫面（`screens.ts` 的 `renderEndless`） |
| 選單再加一個入口 | `index.html` 的 `.nav-grid` 加按鈕 → `style.css` 加 `.nav-xxx` 底色 | 網格是 3 欄；第 7 個入口用 `.nav-row`（`grid-column: 1/-1`）獨占一整列，否則第三列會只有一格看起來像漏了東西 |
| 在新畫面裡放關卡卡片 | 直接用 `.level-card`（`renderEndless`／`renderDaily` 都是） | ⚠ `.codex-body` 是**純 block 容器**：`<button>` 會 shrink-to-fit，卡片寬度隨文字長短參差、右側 `.lv-meta` 被壓成兩行擠在一起。`.level-card { width: 100% }` 與 `.codex-body .level-card + .level-card` 的 `margin-top` 就是在補這件事（在 flex 的 `.level-list` 裡是 no-op）。說明文字（`.codex-detail`）一律放**卡片之後**——手機一頁只看得到約 4 張卡 |
| 改選關卡／圖鑑／兵書／商城／編隊的呈現 | `ui/screens.ts` 對應 `renderXxx()` | 資料表本身在 `data/`（見 [02-data-tables.md](../02-data-tables.md)） |
| 改 UI 整體大小或斷點 | `app.ts:134` 的除數（27 / 56）與 clamp（9.5 / 18）、`app.ts:137` 的 320px | 改除數會同時影響所有 DOM 尺寸 |
| 極窄視窗要隱藏更多東西 | `style.css:166` 的 `#app[data-compact='true']` 區塊 | 不要改成 media query：斷點看的是 `#app` 而非視窗（`#app` 有 `max-width: 560px`） |
| 改倍速選項 | `app.ts:36` 的 `SPEEDS` | 倍速只是往累加器多灌時間，太高會頂到 `MAX_STEPS_PER_FRAME` 而變慢動作 |
| 改掉幀容忍度 | `core/loop.ts:6` 的 `MAX_STEPS_PER_FRAME` | 改大 → 慢機器可能死亡螺旋；改小 → 掉幀時遊戲變慢 |
| 改粒子上限／密度 | `render/particles.ts:10` 的 `MAX` 與各方法的迴圈次數 | 超量丟棄是刻意的 |
| 改拖放手感 | `input/pointer.ts:17` 的 `TAP_SLOP`、`evalTarget()`（`pointer.ts:239`） | 「點一下手牌 → 點一下空地」的 armed 流程（`pointer.ts:102-115`、`174-184`、`214-225`）是手機主要放置方式，別破壞 |
| 改 PWA 快取策略／圖示 | `vite.config.ts` 的 `pwaPlugin()`、`public/manifest.webmanifest`、`public/icons/` | 驗證一律 `npm run build && npm run preview` |
| 加開發密技 | `core/devtools.ts` 加函式 → `ScreensHost`（`screens.ts:64-71`）加方法 → `App` 實作 → `screens.ts:382-389` 的 actions 陣列 | 密技繞過 `sim/actions.ts` 的驗證，僅供測試 |

## 相關頁面

- [../01-architecture.md](../01-architecture.md) — 分層與依賴方向、`GameState` 全貌、字牌與武將的關係（`Unit.cells`、`glyphAt()` / `formsAt()`）
- [../03-change-recipes.md](../03-change-recipes.md) — 「我想改 X → 動哪個檔案」的總表，含新增技能／控場狀態的步驟
- [../04-invariants.md](../04-invariants.md) — 七條不可違反的規則全文、已知陷阱、未實作項目
- [../02-data-tables.md](../02-data-tables.md) — 字／武將／敵人／羈絆／關卡／商城／兵書的欄位意義與平衡基準
- [../05-glossary.md](../05-glossary.md) — 中文術語 ↔ 識別字對照（字牌 = `glyph`、武將 = `general`／`form`）
