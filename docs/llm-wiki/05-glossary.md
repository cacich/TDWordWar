# 術語對照

討論用中文，程式碼用英文。這張表避免兩邊對不上。

| 中文 | 程式碼 | 說明 |
|---|---|---|
| 字牌 | `Unit` with `kind: 'glyph'` | 棋盤上的單字，一格。組成武將後仍然存在 |
| 武將 | `Unit` with `kind: 'general'` | 疊在字牌上的一層框，屬性由成員字牌現算 |
| 成員／所屬 | `memberIds` / `formIds` | 武將↔字牌的雙向連結；一個字可屬於兩個武將 |
| 解除武將 | `dissolveFormsOf()` | 成員被搬走或鏟除時觸發 |
| 十字成雙 | `findCombinations()` 回傳兩筆 | 橫向與縱向同時命中配方 |
| 每局字池 | `state.pool` / `sim/pool.ts` | 一局只啟用部分字，姓名字成組加入 |
| 熟悉度加權 | `FAMILIAR_BOOST` | 已擁有的字抽到權重 ×3 |
| UI 基準字級 | CSS `--ui` / `syncUiScale()` | 所有 DOM 尺寸的倍數基準 |
| 心願單 | `state.wishes` / `toggleWish()` | 玩家指定的字，抽取權重 ×5 |
| 事件佇列 | `state.events` / `emit()` / `drainEvents()` | sim 對外回報「發生了什麼」，音效與粒子的來源 |
| 聲望 | `MetaProgress.renown` / `renownFor()` | 局外貨幣，每局結束結算 |
| 兵書 | `data/upgrades.ts` / `buyUpgrade()` | 花聲望買永久升級 |
| 粒子 | `render/particles.ts` | 純呈現層，由事件驅動 |
| 音效 | `core/audio.ts` | Web Audio 即時合成，零音檔 |
| PWA | `public/manifest.webmanifest` + `core/pwa.ts` | 可安裝、離線可玩 |
| Service Worker | `dist/sw.js`（build 產生） | 產生器是 `vite.config.ts` 的 `pwaPlugin()` |
| 字表 | `GLYPHS` / `GlyphDef` | `data/glyphs.ts` |
| 配方 | `recipe` / `RECIPE_INDEX` | `['張','飛']`，正讀順序 |
| 配方表 | `GENERALS` / `GeneralDef` | `data/generals.ts` |
| 組詞／成將 | **`findCombinations`**（複數）/ `tryCombine` | 判定在 `sim/combine.ts`，執行在 `sim/actions.ts`。⚠ 單數版 `findCombination` 只給測試用，會丟掉第二個方向 |
| 品質階級 | `Unit.level` / `HandCard.level` | 一階～五階，同字同階疊合可升階 |
| 疊合 | merge（`placeFromHand` / `moveGlyph` / `mergeHand`） | 棋盤上或手牌之間都可以 |
| 控場 | `OnHit` + `Enemy` 上的秒數欄位 | 灼燒 burn / 減速 slow / 定身 stun / 易傷 vuln / 擊退 knock / 連鎖 chain |
| 光環 | `Aura` | 影響半徑內其他單位，「陣」「令」 |
| 主動技 | `GeneralDef.skill` + `SKILLS[名]` | 宣告在 data、實作在 `sim/skills.ts` |
| 兵種 | `Troop` | 騎／弓／步／none，三向相剋 |
| 免疫控場 | `ccImmune` | 只免疫定身與擊退 |
| 重抽 | `rerollHand()` | 熔爐旁的按鈕，整手換新 |
| 經濟字 | `GlyphDef.income` | 糧田屯商；每波產糧 = income × 品質階級 |
| 隨機地形 | `LevelDef.gen` + `sim/mapgen.ts` | 走廊先畫、地形後填，保證無死路 |
| 走廊 | induced path | 非相鄰的路徑格不貼邊，因此沒有捷徑 |
| 攻擊特效 | `FxKind` + `render/fx.ts` | sim 給語義、render 決定顏色與形狀 |
| 開火閃光 | `Unit.atkFlash` | 攻擊者外框閃同色，用來辨識「誰打的」 |
| 圖鑑 | `MetaProgress.seenGlyphs` / `seenGenerals` | 由 `app.ts` 的 `syncProgress()` 記錄 |
| 選關／解鎖 | `LEVEL_ORDER` + `MetaProgress.cleared` | 前一關通關才解鎖下一關 |
| 階級 | `tier` | common 普通 / fine 精良 / epic 史詩 / legendary 傳說 / mythic 神話 |
| 羈絆 | `BondDef` / `ActiveBond` / `computeBonds` | `data/bonds.ts` + `sim/bonds.ts` |
| 組合技 | `comboSkill` + `COMBOS[羈絆名]` | 羈絆解鎖的多人合擊 |
| 糧 | `state.food` | 唯一的局內資源 |
| 生命 | `state.lives` | 敵人抵達大營就扣 |
| 波 | `state.wave` | |
| 佈陣階段 | `phase: 'prep'` | 波與波之間的 12 秒 |
| 戰鬥階段 | `phase: 'battle'` | |
| 征兵 | `recruit()` | 花糧抽滿手牌 |
| 熔爐 | `smelt()` | 分解手牌換糧 |
| 鏟子／鏟除 | `sellGlyph()` | 移除場上字牌，相關武將由 `dissolveFormsOf()` 一併解除 |
| 搬動字牌 | `moveGlyph()` | 一律搬字牌而非整個武將 |
| 手牌 | `state.hand` | 長度 = `handSize` |
| 空地 | `TileKind: 'plot'` | 可放置 |
| 路 | `TileKind: 'path'` | 敵人走的格子 |
| 障礙 | `TileKind: 'block'` | 不可放置，不阻擋射線 |
| 出兵口／寨 | `TileKind: 'spawn'` | |
| 大營 | `TileKind: 'camp'` | 玩家的血條所在 |
| 賊 | `EnemyDef` key `thief` | 其他：`shield` 盾賊、`swift` 快賊、`flyer` 飛賊、`boss` 賊將 |
| 射程 | `range` | 單位是格 |
| 攻速 | `aps` | attacks per second |
| 攻擊型態 | `shape` | single 單體 / pierce 穿透 / splash 濺射 |
| 索敵 | `targeting` | front 最前 / near 最近 / strong 最強 |
| 特效 | `Effect` | 純資料，`render` 負責畫 |
| 局外養成 | `MetaProgress` | 定義在 `sim/state.ts`：手牌格數、初始糧／生命、心願格、聲望、圖鑑進度、通關記錄、商城道具等級、編隊設定 |
| 聲望 | `meta.renown` | 局外貨幣，兵書與商城共用；每局結束依抵達波次結算 |
| 兵書 | `UPGRADES`（`data/upgrades.ts`） | 4 種數值養成，效果直接寫進 `MetaProgress` |
| 商城 | `SHOP`（`data/shop.ts`） | 16 種可升級被動道具，每種 3 級 |
| 局外道具效果 | `Perks`（`sim/types.ts`） | 由 `perksFrom()` 依道具等級推導，`createGame` 注入 `state.perks`。等級 0 必須是中性值 |
| 編隊 | `data/loadout.ts` + `meta.loadout*` | 手動挑選字池內容（8 字 + 5 武將）；姓名字只能透過武將帶入 |
| 圖鑑 | `meta.seenGlyphs` / `seenGenerals` | 由 app 層的 `syncProgress()` 每幀累積 |
| 開發密技 | `core/devtools.ts` | 選單標題連點 7 下開啟，測試後門、不經 `actions.ts` 驗證 |
| 提示光暈 | `state.hintCells` | `recalcUnits` 的衍生值：可疊合＝青、可湊將＝金 |
