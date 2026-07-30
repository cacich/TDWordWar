/**
 * 應用層：把 sim / render / ui / input 接起來。
 * 這是唯一同時知道全部四層的檔案，其他模組彼此不直接依賴。
 */
import { Audio, type SfxName } from './core/audio'
import {
  devAddFood,
  devAddRenown,
  devClearBoard,
  devClearEnemies,
  devFullHeal,
  devGiveGlyph,
  devUnlockCodex,
} from './core/devtools'
import { startLoop, type LoopHandle } from './core/loop'
import { clearRun, loadRun, saveMeta, saveRun } from './core/save'
import { ACHIEVEMENTS, claimAchievements } from './data/achievements'
import { dailyChallenge, dateKeyOf, type DailyChallenge } from './data/daily'
import { LEVELS, LEVEL_ORDER } from './data/levels'
import { setLoadoutActive, toggleLoadoutGeneral, toggleLoadoutGlyph } from './data/loadout'
import { buyUpgrade } from './data/upgrades'
import { buyItem } from './data/shop'
import { Input } from './input/pointer'
import { Renderer } from './render/renderer'
import { qualityColor } from './render/theme'
import { recruit, rerollHand, sellGlyph, smelt, startWaveNow, toggleWish } from './sim/actions'
import { restoreRun, snapshotRun } from './sim/persist'
import { DEFAULT_META, createGame, formsAt, glyphAt, recalcUnits, renownFor, type MetaProgress } from './sim/state'
import { stepGame } from './sim/step'
import type { FxKind, GameState, Unit } from './sim/types'
import { Hud, type HudHost, type Mode } from './ui/hud'
import { Screens, type ScreenName, type ScreensHost } from './ui/screens'
import { WishPanel } from './ui/wish'
import type { PointerHost } from './input/pointer'

const SPEEDS = [1, 2, 3]
const TARGETINGS: Unit['targeting'][] = ['front', 'near', 'strong']

export class App implements HudHost, PointerHost, ScreensHost {
  state: GameState
  renderer: Renderer
  hud: Hud
  screens: Screens
  wishPanel: WishPanel
  input: Input
  audio: Audio
  private loop: LoopHandle
  private mode: Mode = 'normal'
  /**
   * 選取的格子（一格上可能同時有字牌與一到兩個武將）。**只負責棋盤上的選取框**。
   * 刻意與 `infoCell` 分開：放置／搬移後要標出落點，但不該彈出詳情面板——
   * 連續放置時每次都得先關掉面板才能繼續操作。
   */
  private selectedCell: number | null = null
  /** 詳情面板要顯示哪一格。**只有真正點擊字牌才會設定**（見 input/pointer.ts 的 onUp） */
  private infoCell: number | null = null
  private speedIndex = 0
  private lastFrame = performance.now()
  private metaDirty = false
  private saveTimer = 0
  /** 本局是否已結算聲望，避免每幀重複加 */
  private renownPaid = false
  /** 成就檢查倒數：24 個成就要掃場上單位，不必每幀跑 */
  private achieveTimer = 0
  /** 本局的種子。續玩存檔要靠它重建棋盤，所以必須跟著 state 一起記住 */
  private seed = 0
  /** 本局若是每日挑戰，記下它的 dateKey；一般對局為 null */
  private dailyKey: string | null = null
  /** 上一次寫局內存檔時的波次，用來做到「一波只存一次」 */
  private savedWave = -1

  constructor(canvas: HTMLCanvasElement, private meta: MetaProgress) {
    this.seed = newSeed()
    this.state = createGame('huangjin', this.seed, meta)
    recalcUnits(this.state)
    this.renderer = new Renderer(canvas)
    this.renderer.resize(this.state)
    this.hud = new Hud(this)
    this.screens = new Screens(this)
    this.wishPanel = new WishPanel(this)
    this.input = new Input(this)
    this.audio = new Audio(loadMuted())
    // 瀏覽器要求音訊必須由使用者手勢啟動
    const unlock = () => this.audio.unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })

    const onResize = () => {
      this.syncUiScale()
      this.renderer.resize(this.state)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    // 手機切到背景／關分頁時不會有 unload，pagehide 才是可靠的最後一刻
    window.addEventListener('pagehide', () => this.persistRun())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.persistRun()
    })
    // canvas 的 CSS 尺寸會因為浮層／鍵盤／瀏覽器工具列而改變，光靠 window resize 不夠
    new ResizeObserver(onResize).observe(canvas)
    const appEl = document.getElementById('app')
    if (appEl) new ResizeObserver(() => this.syncUiScale()).observe(appEl)
    this.syncUiScale()

    this.loop = startLoop(
      (dt) => {
        if (this.screens.visible) return // 開著選單／圖鑑時凍結模擬
        stepGame(this.state, dt)
      },
      () => {
        const now = performance.now()
        const frameDt = Math.min((now - this.lastFrame) / 1000, 0.25)
        this.lastFrame = now
        this.renderer.view.selectedCell = this.selectedCell
        this.drainEvents()
        this.renderer.draw(this.state, frameDt)
        this.hud.update(frameDt)
        if (this.wishPanel.visible) this.wishPanel.update()
        this.syncProgress(frameDt)
      },
    )

    this.show('menu')
  }

  /**
   * 依 #app 的實際大小算出 UI 基準字級 --ui，所有 DOM 尺寸都是它的倍數。
   * 同時吃寬與高：只看寬度的話，在矮而寬的視窗裡文字會壓到棋盤。
   */
  private syncUiScale(): void {
    const app = document.getElementById('app')
    if (!app) return
    const r = app.getBoundingClientRect()
    const ui = Math.max(9.5, Math.min(18, Math.min(r.width / 27, r.height / 56)))
    document.documentElement.style.setProperty('--ui', `${ui.toFixed(2)}px`)
    // 極窄視窗（小於一般手機寬度）塞不下狀態列的全部資訊 → 隱藏次要項目
    app.dataset.compact = r.width < 320 ? 'true' : 'false'
  }

  // ── 進度與圖鑑 ──────────────────────────────────────
  /**
   * 每幀掃一次手牌與場上單位，把新看到的字／武將寫進圖鑑。
   * 放在 app 層而不是 sim 層，是為了維持 sim 不知道存檔的存在。
   */
  private syncProgress(dt: number): void {
    if (this.screens.visible) return
    const meta = this.meta
    for (const h of this.state.hand) {
      if (h && !meta.seenGlyphs.includes(h.char)) {
        meta.seenGlyphs.push(h.char)
        this.metaDirty = true
      }
    }
    for (const u of this.state.units) {
      if (u.kind === 'glyph') {
        if (!meta.seenGlyphs.includes(u.defKey)) {
          meta.seenGlyphs.push(u.defKey)
          this.metaDirty = true
        }
      } else if (!meta.seenGenerals.includes(u.defKey)) {
        meta.seenGenerals.push(u.defKey)
        this.metaDirty = true
      }
    }
    // 敵人圖鑑：只要在場上出現過就算見過（不必打死，否則被漏過的敵種永遠不會登錄）
    for (const e of this.state.enemies) {
      if (!meta.seenEnemies.includes(e.defKey)) {
        meta.seenEnemies.push(e.defKey)
        this.metaDirty = true
      }
    }

    const key = this.state.levelKey
    const reached = this.state.wave
    // 第 1 波還沒打完就不算成績，否則一進關卡就會顯示「最佳 1 波」
    if (reached > 1 && (meta.best[key] ?? 0) < reached) {
      meta.best[key] = reached
      this.metaDirty = true
    }
    // 每日挑戰的成績記在自己的欄位，不跟一般對局的 best 混在一起
    if (this.dailyKey && reached > 1 && (meta.daily[this.dailyKey] ?? 0) < reached) {
      meta.daily[this.dailyKey] = reached
      this.metaDirty = true
    }

    // 局內存檔：每波開始時寫一次。放在佈陣階段是因為那是天然的檢查點
    // （戰鬥中途存檔也能還原，但每幀寫 localStorage 太貴）
    if (this.state.phase === 'prep' && this.state.wave !== this.savedWave) {
      this.savedWave = this.state.wave
      this.persistRun()
    }
    if (this.state.phase === 'won' && !meta.cleared.includes(key)) {
      meta.cleared.push(key)
      this.metaDirty = true
    }

    // 聲望結算：一局只結一次
    const over = this.state.phase === 'won' || this.state.phase === 'lost'
    if (over && !this.renownPaid) {
      this.renownPaid = true
      const won = this.state.phase === 'won'
      const gain = renownFor(this.state.wave, this.state.stats.kills, won)
      meta.renown += gain
      // 跨局累計只在這裡加一次（中途離開回選單的那一局不算，否則同一局會被重複累加）
      meta.totals.runs++
      if (won) meta.totals.wins++
      meta.totals.kills += this.state.stats.kills
      meta.totals.waves += this.state.wave
      this.metaDirty = true
      this.hud.toast(`獲得聲望 +${gain}（兵書可花用）`)
      // 「通關且沒掉命」這類成就只有結束的這一刻成立，不能等下一次輪詢
      this.checkAchievements()
    }

    // 成就輪詢：0.5 秒一次就足夠即時，又不必每幀掃全場單位
    this.achieveTimer -= dt
    if (this.achieveTimer <= 0) {
      this.achieveTimer = 0.5
      this.checkAchievements()
    }

    // 存檔節流：最多每 2 秒寫一次 localStorage
    if (!this.metaDirty) return
    this.saveTimer -= dt
    if (this.saveTimer > 0) return
    this.saveTimer = 2
    this.metaDirty = false
    saveMeta(meta)
  }

  /**
   * 檢查成就並發放獎勵。解鎖是**立即存檔**的——成就多半在一局結束的那一刻達成，
   * 而玩家常常馬上回選單，等 2 秒的節流會來不及寫入。
   */
  private checkAchievements(): void {
    const got = claimAchievements(this.meta, this.state)
    if (!got.length) return
    saveMeta(this.meta)
    this.metaDirty = false
    this.audio.play('combineBig')
    // toast 只有一格、後蓋前（見 ui/hud.ts），所以一次解鎖多項要合併成一則，
    // 否則玩家只會看到最後一項，前面幾項像是沒發生過
    const gain = got.reduce((n, a) => n + a.renown, 0)
    this.hud.toast(
      got.length === 1
        ? `成就達成：${got[0].name}（聲望 +${gain}）`
        : `成就達成 ${got.length} 項：${got.map((a) => a.name).join('、')}（聲望 +${gain}）`,
    )
  }

  /**
   * 把 sim 這一幀吐出的事件轉成音效與粒子，然後清空佇列。
   * sim 只負責產生事件資料，完全不知道 Web Audio 或 canvas 的存在。
   */
  private drainEvents(): void {
    const evs = this.state.events
    if (!evs.length) return
    const ps = this.renderer.particles
    for (const ev of evs) {
      switch (ev.kind) {
        case 'place':
          this.audio.play('place')
          break
        case 'merge': {
          this.audio.play('merge')
          const g = this.state.units.find((u) => u.kind === 'glyph' && u.chars[0] === ev.char)
          if (g) {
            const cols = this.state.board.cols
            ps.merge((g.cells[0] % cols) + 0.5, Math.floor(g.cells[0] / cols) + 0.5, qualityColor(ev.level))
          }
          break
        }
        case 'combine':
          this.audio.play(ev.tier === 'legendary' || ev.tier === 'mythic' ? 'combineBig' : 'combine')
          this.particleAtCells(ev.cells, (x, y) => ps.combine(x, y, ev.tier))
          break
        case 'dissolve':
          this.audio.play('dissolve')
          break
        case 'attack':
          this.audio.play(attackSfx(ev.fx), 0.9)
          break
        case 'kill':
          this.audio.play('kill', 0.8)
          ps.kill(ev.x, ev.y)
          break
        case 'skill':
          this.audio.play('skill')
          ps.skill(ev.x, ev.y)
          break
        case 'combo': {
          this.audio.play('combo')
          const c = this.state.board.camp
          ps.combo(c % this.state.board.cols + 0.5, Math.floor(c / this.state.board.cols) + 0.5)
          this.hud.toast(`組合技：${ev.name}`)
          break
        }
        case 'leak': {
          this.audio.play('leak')
          const cols = this.state.board.cols
          const camp = this.state.board.camp
          ps.leak((camp % cols) + 0.5, Math.floor(camp / cols) + 0.5)
          break
        }
        case 'waveClear':
          this.audio.play('wave')
          break
        case 'won':
          this.audio.play('win')
          break
        case 'lost':
          this.audio.play('lose')
          break
      }
    }
    evs.length = 0
  }

  private particleAtCells(cells: number[], emit: (x: number, y: number) => void): void {
    const cols = this.state.board.cols
    let x = 0
    let y = 0
    for (const c of cells) {
      x += (c % cols) + 0.5
      y += Math.floor(c / cols) + 0.5
    }
    emit(x / cells.length, y / cells.length)
  }

  // ── 心願單 ──────────────────────────────────────────
  openWishPanel(): void {
    this.audio.play('ui')
    this.select(null)
    this.wishPanel.show()
  }
  closeWishPanel(): void {
    this.wishPanel.hide()
  }
  toggleWish(char: string): void {
    const res = toggleWish(this.state, char)
    this.audio.play(res.ok ? 'ui' : 'deny')
    if (res.msg) this.hud.toast(res.msg)
  }

  // ── 音效開關 ────────────────────────────────────────
  getArmedHand(): number | null {
    return this.input.getArmedHand()
  }
  isMuted(): boolean {
    return this.audio.muted
  }
  toggleMute(): void {
    this.audio.unlock()
    this.audio.setMuted(!this.audio.muted)
    saveMuted(this.audio.muted)
    if (!this.audio.muted) this.audio.play('ui')
  }

  // ── ScreensHost ─────────────────────────────────────
  getMeta(): MetaProgress {
    return this.meta
  }
  /** 成就畫面的進度條資料。在這裡算好，ui/screens.ts 就不必認識 GameState */
  achieveProgress(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const a of ACHIEVEMENTS) out[a.key] = a.progress(this.state, this.meta)
    return out
  }
  buyUpgrade(key: string): void {
    const res = buyUpgrade(this.meta, key)
    this.audio.play(res.ok ? 'combine' : 'deny')
    saveMeta(this.meta)
    this.screens.renderForge()
    this.hud.toast(res.msg)
  }
  buyItem(key: string): void {
    const res = buyItem(this.meta, key)
    this.audio.play(res.ok ? 'combine' : 'deny')
    saveMeta(this.meta)
    this.screens.renderShop()
    this.hud.toast(res.msg)
  }

  // ── 編隊（見 data/loadout.ts） ────────────────────────
  setLoadoutActive(active: boolean): void {
    setLoadoutActive(this.meta, active)
    this.audio.play('ui')
    saveMeta(this.meta)
    this.screens.renderLoadout()
  }
  toggleLoadoutGlyph(char: string): void {
    const res = toggleLoadoutGlyph(this.meta, char)
    this.audio.play(res.ok ? 'ui' : 'deny')
    if (res.ok) saveMeta(this.meta)
    this.screens.renderLoadout()
    if (res.msg) this.hud.toast(res.msg)
  }
  toggleLoadoutGeneral(name: string): void {
    const res = toggleLoadoutGeneral(this.meta, name)
    this.audio.play(res.ok ? 'ui' : 'deny')
    if (res.ok) saveMeta(this.meta)
    this.screens.renderLoadout()
    if (res.msg) this.hud.toast(res.msg)
  }

  // ── 開發密技（僅供測試，見 core/devtools.ts） ────────
  devAddRenown(amount: number): void {
    devAddRenown(this.meta, amount)
    saveMeta(this.meta)
    this.hud.toast(`聲望 +${amount}`)
  }
  devAddFood(amount: number): void {
    devAddFood(this.state, amount)
    this.hud.toast(`糧 +${amount}`)
  }
  devFullHeal(): void {
    devFullHeal(this.state)
    this.hud.toast('生命全滿')
  }
  devClearBoard(): void {
    devClearBoard(this.state)
    this.hud.toast('已清空棋盤字牌')
  }
  devClearEnemies(): void {
    devClearEnemies(this.state)
    this.hud.toast('已清空敵人')
  }
  devUnlockCodex(): void {
    devUnlockCodex(this.meta)
    saveMeta(this.meta)
    this.hud.toast('圖鑑已全部解鎖')
  }
  devGiveGlyph(char: string): void {
    const res = devGiveGlyph(this.state, char)
    this.hud.toast(res.msg)
  }
  show(screen: ScreenName): void {
    // syncProgress 在選單畫面會早退，所以「在選單裡才達成」的成就（例如把兵書買滿）
    // 只能靠切換畫面時補檢查一次。放在 screens.show 之前，剛解鎖的項目當場就畫得出來。
    this.checkAchievements()
    this.screens.show(screen)
    this.loop.setPaused(screen !== null)
  }
  // ── 續玩存檔 ────────────────────────────────────────
  /**
   * 把目前這一局寫進 localStorage。已分出勝負就改成清掉存檔——
   * 打完的局沒有續玩的必要，留著只會讓選單一直顯示「繼續上一局」。
   */
  private persistRun(): void {
    const p = this.state.phase
    if (p === 'won' || p === 'lost') {
      clearRun()
      return
    }
    saveRun(snapshotRun(this.state, this.seed, this.dailyKey ?? undefined))
  }

  /** 有沒有可以續玩的存檔（給選單決定要不要顯示續玩卡片） */
  savedRun(): { levelName: string; wave: number; maxWave: number; daily: boolean } | null {
    const snap = loadRun()
    if (!snap) return null
    const lv = LEVELS[snap.levelKey]
    if (!lv) return null
    return { levelName: lv.name, wave: snap.wave, maxWave: lv.maxWave, daily: !!snap.dailyKey }
  }

  /** 放棄存檔。清掉之後重繪選單，續玩卡片才會消失 */
  dropRun(): void {
    clearRun()
    this.savedWave = -1
    this.audio.play('ui')
    this.screens.show('menu')
    this.hud.toast('已放棄上一局的存檔')
  }

  /** 續玩。存檔壞掉或關卡已不存在時，誠實告訴玩家並清掉，不要靜默跳回選單 */
  resumeRun(): void {
    const snap = loadRun()
    const restored = snap && restoreRun(snap, this.meta)
    if (!snap || !restored) {
      clearRun()
      this.screens.show('menu')
      this.hud.toast('存檔已失效，無法續玩')
      return
    }
    this.state = restored
    this.seed = snap.seed
    this.dailyKey = snap.dailyKey ?? null
    this.savedWave = this.state.wave
    this.afterRunStart()
    this.hud.toast(`續玩：${this.state.levelName} 第 ${this.state.wave} 波`)
  }

  // ── 每日挑戰 ────────────────────────────────────────
  /** 今天的挑戰。日期在 app 層取（sim 與 data 都不碰 Date） */
  todayChallenge(): DailyChallenge {
    return dailyChallenge(dateKeyOf(new Date()))
  }

  /**
   * 開始每日挑戰。**一律用中性 meta**（不吃兵書／商城／編隊）——
   * 這不只是公平，更是重現性的必要條件：手牌格數與精兵符都會改變 rng 的消耗量，
   * 任何一項不同，同一顆種子就會長出不同的對局（見 data/daily.ts 的檔頭）。
   */
  startDaily(): void {
    const c = this.todayChallenge()
    this.seed = c.seed
    this.dailyKey = c.dateKey
    this.savedWave = -1
    this.state = createGame(c.levelKey, c.seed, DEFAULT_META)
    recalcUnits(this.state)
    this.afterRunStart()
    this.hud.toast(`每日挑戰 ${c.dateKey}：${this.state.levelName}`)
  }

  startLevel(key: string): void {
    this.seed = newSeed()
    this.dailyKey = null
    this.savedWave = -1
    this.state = createGame(key, this.seed, this.meta)
    recalcUnits(this.state)
    this.afterRunStart()
    // 讓玩家知道這一局的字池能湊出什麼，抽卡才有方向感
    const list = this.state.poolGenerals.filter((n) => n.length > 1).slice(0, 4)
    if (list.length) this.hud.toast(`本局可湊：${list.join('、')}…`)
  }

  /**
   * 換上一局新的 `state` 之後共通的收尾。開新局、每日挑戰與續玩三條路徑共用，
   * 漏掉任何一項都會留下上一局的殘留（選取框、粒子、心願面板、畫布尺寸）。
   */
  private afterRunStart(): void {
    this.select(null)
    this.mode = 'normal'
    this.renownPaid = false
    this.renderer.particles.clear()
    this.wishPanel.hide()
    this.hud.onLevelChanged()
    this.renderer.resize(this.state)
    this.show(null)
  }
  /** 目前關卡在流程中的下一關（沒有就回傳 null） */
  nextLevelKey(): string | null {
    const i = LEVEL_ORDER.indexOf(this.state.levelKey as (typeof LEVEL_ORDER)[number])
    return i >= 0 && i + 1 < LEVEL_ORDER.length ? LEVEL_ORDER[i + 1] : null
  }

  // ── HudHost / PointerHost ───────────────────────────
  getState(): GameState {
    return this.state
  }
  getMode(): Mode {
    return this.mode
  }
  setMode(m: Mode): void {
    this.mode = m
    if (m !== 'normal') this.select(null)
  }
  getSelectedGlyph(): Unit | null {
    return this.infoCell === null ? null : glyphAt(this.state, this.infoCell) ?? null
  }
  getSelectedForms(): Unit[] {
    return this.infoCell === null ? [] : formsAt(this.state, this.infoCell)
  }
  select(cell: number | null): void {
    this.selectedCell = cell
    this.infoCell = cell
    // 心願面板與資訊面板都占畫面底部，不能同時開
    if (cell !== null) this.wishPanel.hide()
  }
  /**
   * 標記落點但不開詳情。放置／搬移後走這條路。
   * 順手把面板關掉：剛放下新字，還開著上一個字的詳情只會造成誤讀。
   */
  highlight(cell: number): void {
    this.selectedCell = cell
    this.infoCell = null
  }
  isPaused(): boolean {
    return this.loop.paused
  }
  getSpeed(): number {
    return SPEEDS[this.speedIndex]
  }
  toast(msg: string): void {
    this.hud.toast(msg)
  }
  onCombined(names: string[]): void {
    this.hud.toast(names.length > 1 ? `同時成將：${names.join('、')}` : `成將：${names[0]}`)
  }
  beginHandDrag(index: number, ev: PointerEvent): void {
    this.input.beginHandDrag(index, ev)
  }

  recruit(): void {
    const res = recruit(this.state)
    if (res.msg) this.hud.toast(res.msg)
  }
  reroll(): void {
    const res = rerollHand(this.state)
    if (res.msg) this.hud.toast(res.msg)
  }
  smeltHand(index: number): void {
    const res = smelt(this.state, index)
    if (res.msg) this.hud.toast(res.msg)
  }
  startWave(): void {
    const res = startWaveNow(this.state)
    if (res.msg) this.hud.toast(res.msg)
  }
  togglePause(): void {
    this.loop.setPaused(!this.loop.paused)
  }
  cycleSpeed(): void {
    this.speedIndex = (this.speedIndex + 1) % SPEEDS.length
    this.loop.setSpeed(SPEEDS[this.speedIndex])
  }
  sellSelected(): void {
    const g = this.getSelectedGlyph()
    if (!g) return
    const res = sellGlyph(this.state, g.id)
    if (res.msg) this.hud.toast(res.msg)
    this.select(null)
  }
  /** 索敵模式套在「實際會出手的單位」上：有武將就改武將，否則改字牌 */
  cycleTargeting(): void {
    const forms = this.getSelectedForms()
    const targets = forms.length ? forms : this.getSelectedGlyph() ? [this.getSelectedGlyph()!] : []
    if (!targets.length) return
    const next = TARGETINGS[(TARGETINGS.indexOf(targets[0].targeting) + 1) % TARGETINGS.length]
    for (const t of targets) t.targeting = next
  }
  restart(): void {
    this.startLevel(this.state.levelKey)
  }
  openMenu(): void {
    this.show('menu')
  }
}

/** 每局換一顆種子；要重現對局就把這裡改成固定值 */
function newSeed(): number {
  return Date.now() >>> 0
}

/** 攻擊音效依特效種類分流，讓聽覺也能分辨是誰在打 */
function attackSfx(fx: FxKind): SfxName {
  switch (fx) {
    case 'blade':
    case 'thrust':
      return 'attackBlade'
    case 'arrow':
      return 'attackArrow'
    case 'fire':
    case 'venom':
      return 'attackFire'
    case 'bolt':
      return 'attackBolt'
    default:
      return 'attackSoft'
  }
}

const MUTE_KEY = 'tdwordwar.muted'

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function saveMuted(m: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0')
  } catch {
    /* 隱私模式忽略 */
  }
}
