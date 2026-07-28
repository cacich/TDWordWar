# 不變量、陷阱、尚未實作

## 不可違反的架構約束

| # | 約束 | 為什麼 | 違反後的症狀 |
|---|---|---|---|
| 1 | `src/sim/` 與 `src/data/` 不 import render/ui/input/DOM | 讓遊戲邏輯能在 Node 跑 | `npm test`、`npm run sim` 直接爆 `document is not defined` |
| 2 | 不用 `Math.random()`，一律 `state.rng` | 同種子＝同對局，bug 可重播 | 平衡模擬結果每次不同，測試變 flaky |
| 3 | 改 `units` / `hand` 後呼叫 `recalcUnits(state)` | 羈絆倍率與組詞提示是衍生值 | 羈絆加成沒生效、提示卡在舊資料 |
| 4 | 玩家操作只經由 `sim/actions.ts` | 單一入口才好測試與加回饋 | 規則被繞過（例如把字放到路上） |
| 5 | `Unit.cells` 依正讀順序 | 組詞與武將渲染都依賴 | 武將字序顛倒、組詞判定錯誤 |
| 5b | 不可假設「一格一個 unit」 | 武將疊在字牌上，格子會重疊 | 拿到錯的單位；用 `glyphAt()` / `formsAt()` 取代 |
| 5c | 武將成員字牌不重複計算 | 攻擊／光環／產糧都由武將那一層代表 | 傷害或收入變兩倍 |
| 6 | `sim/` 內不讀 `performance.now()` / `Date.now()` | 固定步長模擬必須純粹 | 模擬不可重現 |
| 7 | 只有 `kind === 'glyph'` 參與組詞 | 設計決定 #3：武將不再融合 | 配方規則爆炸、玩家無法預期 |

## 已知陷阱（踩過的坑，別再踩）

### `[hidden]` 需要 `display:none !important`
CSS 裡任何元件自己的 `display: grid/flex` 會蓋掉 HTML 的 `hidden` 屬性。
`style.css` 開頭已有全域 `[hidden] { display: none !important; }`，**不要移除**，否則結算橫幅與資訊面板會一直卡在畫面上。

### HUD 手牌的 `dataset.sig` 快取
`ui/hud.ts` 用 `card.dataset.sig`（`'字:等級'`）避免每幀重建 DOM。
清空格子時**必須 `delete card.dataset.sig`**，否則下次抽到同字同級會被誤判為「沒變動」而不重繪 → 手牌看起來是空的，但 state 裡有字。

### GameState 不可 `JSON.stringify`
`state.rng` 是閉包。要做局內存檔必須改成存 `{ seed, rngCallCount }`，載入時重播 rng 到同一個位置。
目前 `core/save.ts` **只存局外 meta 進度**，這是刻意的。

### canvas 需要 ResizeObserver
只監聽 `window.resize` 不夠——浮層、瀏覽器工具列、軟鍵盤都會改變 canvas 的 CSS 尺寸而不觸發 window resize，
結果內部 buffer 尺寸沒跟上、畫面被拉伸。`app.ts` 已掛 `ResizeObserver`。

### `tsconfig` 開了 `noUnusedLocals`
多餘的 import 會讓 `npm run build` 失敗（不只警告）。

### 地圖每列長度必須相等
`parseMap()` 會拋錯。手寫地圖字串時很容易少一個字元，有測試把關但仍請自己數。

### 技能失敗不可重設冷卻
`SkillFn` 回傳 `false` 時 `stepSkills()` **不會**設定 `skillCd`。這是刻意的：沒有目標時不該浪費冷卻。
寫新技能若忘記回傳 false，會出現「技能一直在空放」的難查 bug。

### 技能名稱是字串鍵，打錯不會報錯
`SKILLS['張遼']` 與 `data/generals.ts` 的武將名必須完全一致（含全形字）。
`core.test.ts` 有兩個測試把關（鍵對得上武將、有實作的必須也宣告 `skill`），別把它們刪掉。

### 控場狀態要改六個地方
新增一種狀態時漏改任一處都會安靜失效，清單見
[03-change-recipes.md §10b](03-change-recipes.md#10b-新增一種控場狀態)。

### 光環在羈絆之後結算
`recalcUnits()` 的順序是「羈絆 → 光環 → 技能冷卻上限」，兩者相乘。
若把光環算在羈絆之前，數值會不一致（光環來源自己也會被羈絆放大）。

### Service Worker 存快取前要重建 headers（踩過兩次的坑）
`vite.config.ts` 的 `store()` 只保留 `content-type`，其餘 header 全部丟掉。**不要改成直接
`cache.put(url, res)`**，會踩到兩個很難查的問題：

1. `content-encoding: gzip` —— `fetch()` 回來的 body 已經被瀏覽器解壓縮，但 header 還留著。
   SW 把它回給子資源載入器時會再解壓一次純文字 → `net::ERR_FAILED`。
2. `transfer-encoding: chunked`（連同 `connection` / `keep-alive`）是 hop-by-hop header，
   不該出現在合成的 Response 上。`<script type="module">` 的檢查很嚴，看到它就拒絕載入。

**症狀特徵**：離線時 HTML 出得來、畫面有內容但沒有樣式、`window.__game` 是 undefined。
而且從 console 手動 `fetch()` 同一個檔案是 200 —— 因為 JS 層的 fetch 不會再做一次解碼檢查，
所以「手動 fetch 正常」不能證明快取是好的。要看 DevTools 的 Network 面板。

### Service Worker 的版本號要涵蓋 SW 自己的程式碼
`pwaPlugin()` 的 version 是對「檔名清單 + SW 原始碼模板」一起做 hash。
如果只 hash 檔名清單，改了 SW 邏輯但資源 hash 沒變時快取名不會變 → 舊的壞快取會一直留著。

### 可拖曳的元素一定要 `touch-action: none`
`html, body` 設的是 `touch-action: manipulation`，會被子元素繼承。手牌卡片繼承到它之後，
手機上「從卡片開始的觸控拖曳」會被瀏覽器判定成捲動手勢，直接發 `pointercancel`
把拖曳殺掉 —— 症狀是**手機完全無法把字拖到棋盤上，但棋盤上已放的字反而拖得動**
（因為 canvas 本來就有 `touch-action: none`）。

所以 `.card` 明確設了 `touch-action: none` 與 `-webkit-touch-callout: none`（後者防 iOS 長按跳選單）。
**以後新增任何可拖曳的 DOM 元素都要記得加。**

另外兩層防護：
- `pointerdown` 時 `setPointerCapture()`，手指移出卡片範圍或卡片內容被重繪都不會斷
- 收到 `pointercancel` 時不讓操作消失，而是退化成「點選待放置」（`Input.armedHand`）

### 桌機測不到觸控問題
這個 bug 在滑鼠上完全正常，是使用者在手機上才發現的。要在開發機驗證觸控路徑，
可以用合成事件（`new PointerEvent('pointerdown', { pointerType: 'touch', pointerId, ... })`）
跑過 pointerdown → pointermove → pointerup 與 pointercancel 兩條路徑。
但注意合成事件**不會重現瀏覽器自己的手勢搶奪行為**，所以 `touch-action` 這類問題還是要靠實機。

### 音效必須節流，且只能由事件佇列觸發
攻擊音在後期每秒可能被觸發 20 次以上。`core/audio.ts` 的 `THROTTLE` 表就是為此存在，
新增高頻音效時一定要加進去。另外 `sim/` 不可直接播音效——一律 `emit()` 事件，由 app 層 drain。

### AudioContext 必須由使用者手勢建立
瀏覽器自動播放政策會讓事前建立的 context 停在 suspended。`app.ts` 綁了一次性的
`pointerdown` / `keydown` 來 `unlock()`。靜音設定存在 `localStorage` 的 `tdwordwar.muted`。

### 心願單只在池內有效
`toggleWish()` 會擋掉池外的字。若移除這個檢查，玩家會許一個永遠不會出現的願而毫無反饋。

### 字牌升階必須「就地」保留 id 與 formIds
`actions.ts` 的 `levelUpGlyph()` 會建立一個新的 unit 物件，但**必須把 `id` 與 `formIds` 複製過去**
再換掉陣列裡的舊物件。武將是用 `memberIds`（id 陣列）找成員的，
一旦 id 變了，武將會找不到成員 → `recomputeForm()` 直接 return，屬性凍結在舊值且不會報錯。

### UI 尺寸不要寫死 px
`style.css` 的所有字級／間距都是 `calc(var(--ui) * k)`，`--ui` 由 `app.ts` 的 `syncUiScale()`
依 `#app` 實際大小算出。直接寫 px 會讓那個元件在視窗縮放時比例失衡（這正是當初的 bug）。

### 隨機地圖的死路是「由構造排除」，不是靠檢查
`sim/mapgen.ts` 先畫走廊再填地形，所以一定連通。**不要改成「隨機生成後再檢查連通性」**——
那會退化成隨機重試，而且很容易在某些種子下卡住。
另外走廊維持 induced path（非相鄰的走廊格不貼邊），這保證 BFS 最短路 == 生成的走廊；
若破壞這個性質，敵人會走出設計者沒預期的捷徑，而且塔的射程規劃會失準。
（曾經試過 DFS 亂挖，在 9×14 上常常只挖出 38 格、達不到門檻，幾乎每次都退回保險版型。）

### 武將的 fx 繼承只看「明確宣告」的 fx
`inheritFx()` 讀的是 `GLYPH_BY_CHAR[char].fx`（字表上寫死的），不是 `Unit.fx`（可能是推導值）。
姓氏／名字字沒有宣告 fx，會被 `deriveGlyphFx()` 補成 `'blade'`；
如果繼承時把這個填充值算進去，黃忠就會拿到 blade 而不是 arrow。有測試把關。

### 圖鑑與通關進度由 app 層維護
`sim/` 不知道存檔的存在。`app.ts` 的 `syncProgress()` 每幀掃手牌與場上單位補進 `MetaProgress`，
節流成最多每 2 秒寫一次 localStorage。選單開著時不記錄（否則一進關卡就會出現「最佳 1 波」）。
存檔 key 是 `tdwordwar.meta.v3`，會依序往回讀 v2 / v1 做遷移（新欄位補預設值）。

### `ccImmune` 只擋定身與擊退
賊將仍會吃灼燒、減速、易傷。這是刻意的平衡設計（控場流不該完全癱瘓 BOSS，
但也不該對 BOSS 完全無效），改動前請先想清楚。

## 尚未實作（別以為壞了）

| 項目 | 現況 | 規劃 |
|---|---|---|
| 藏書閣（解鎖新字） | **刻意不做**。每局字池已從另一個方向解決字太發散的問題，再加一層解鎖只會讓前期更貧乏 | — |
| 被動能力 | 沒有獨立的 passive 系統；目前用 `onHit` 與 `aura` 兩種資料驅動形式代替 | 視需要 |
| 局內存檔續玩 | 只存局外進度；`GameState` 含 rng 閉包不可序列化 | 視需要 |
| 背景音樂 | 只有音效，沒有 BGM。若要做，同樣用 Web Audio 合成 | 視需要 |
| PWA 的 512px PNG 圖示 | 只有 `icon.svg`（可縮放）與 `icon-192.png`。Android 的啟動畫面會把 192 放大，略糊 | 用 `tools/make-icons.html` 產生 512 後補進 manifest |
| 更新提示 | SW 用 skipWaiting + clients.claim，下次開啟自動套用新版，但不會主動提示「有新版本」 | 視需要 |

已於 M3 完成：主動技（6 原型／19 名武將全部有實作）、羈絆組合技（4 個）、
控場狀態（灼燒／減速／定身／易傷／擊退／連鎖）、光環、兵種三向相剋、熔爐重抽、手牌疊合。

已於 M4 完成：6 關卡 + 循序解鎖選單、3 關隨機地形、圖鑑（字／武將兩頁 + 收集進度）、
經濟字（糧田屯商 + 屯田）、攻擊特效區隔（10 種 fx + 命中點標籤 + 來源閃光）。

已於 M5 完成：心願單、兵書（4 種永久升級 + 聲望結算）、Web Audio 合成音效（19 種 + 靜音開關）、
粒子系統、UI 等比縮放（`--ui`）。

已於 M6 完成：PWA —— manifest、可縮放 SVG 圖示、自製 Service Worker（build 時由
`vite.config.ts` 的 `pwaPlugin()` 產生，precache 清單自動對上帶 hash 的檔名）、
safe-area 內距。實測關掉伺服器後重新整理仍可完整遊玩。

## 測試涵蓋範圍

`npm test` 目前 135 個測試：

- `combine.test.ts` — 組詞：橫向、縱向、逆序不成立、不相鄰不成立、階級優先、武將不參與
- `actions.test.ts` — 放置合法性、疊合升階、合成、品質繼承、移動觸發合成、經濟
- `core.test.ts` — 地圖解析與路徑連通（含全部固定關卡）、資料表完整性、技能註冊表對得上、傷害／成本／權重公式、種子確定性、整局模擬
- `m3.test.ts` — 品質階級與手牌疊合、兵種相剋、控場狀態（含 BOSS 免疫）、光環、主動技（含失敗不重設冷卻）、羈絆組合技、三字配方、熔爐重抽
- `mapgen.test.ts` — 180 張隨機地圖的連通性、走廊不變量（可走格數 == 路徑長度）、可放置空地下限、種子可重現
- `m4.test.ts` — 經濟字產出（線性成長、屯田合成、每波結算）、fx 指派與武將繼承、`atkFlash` 與特效攜帶的辨識資訊
- `actions.test.ts`（M4b 段）— 組將後字牌保留、繼續疊字使武將同步變強、拖走成員解除武將並可改組、
  十字同時成兩將、鏟除共用字同時解除兩將
- `pool.test.ts` — 字池不含孤兒姓名字、兵器兵種永遠在池、池子大小隨關卡、熟悉度加權確實提高重複率
- `m5.test.ts` — 心願單（池外擋下、格數上限、加權確實生效）、事件佇列（產生與上限保護）、
  聲望結算與兵書升級（價格、上限、對開局狀態的影響）
- `range.test.ts` — 射程全域倍率（單字牌、武將加成、多格中心補償）、直立與橫向合成射程一致、對空資格不受放大影響
- `shop.test.ts` — 商城購買與升級（扣聲望、記錄等級、聲望不足／已滿級擋下、價格逐級遞增）、
  `perksFrom` 等級 0 全中性且每種道具只影響自己負責的 `Perks` 欄位（16 種全覆蓋）、
  16 種道具個別在對局中生效（爆擊、擊殺收入、敵速、漏怪防護、花費打折、生命上限、射程、
  冷卻縮短、熟悉度加權…）

**新增機制時請一併補測試**，尤其是 `sim/` 裡的純函式——它們是本專案最便宜的保險。
