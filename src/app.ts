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
import { saveMeta } from './core/save'
import { LEVEL_ORDER } from './data/levels'
import { buyUpgrade } from './data/upgrades'
import { buyItem } from './data/shop'
import { Input } from './input/pointer'
import { Renderer } from './render/renderer'
import { qualityColor } from './render/theme'
import { recruit, rerollHand, sellGlyph, smelt, startWaveNow, toggleWish } from './sim/actions'
import { createGame, formsAt, glyphAt, recalcUnits, renownFor, type MetaProgress } from './sim/state'
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
  /** 選取的是格子（一格上可能同時有字牌與一到兩個武將） */
  private selectedCell: number | null = null
  private speedIndex = 0
  private lastFrame = performance.now()
  private metaDirty = false
  private saveTimer = 0
  /** 本局是否已結算聲望，避免每幀重複加 */
  private renownPaid = false

  constructor(canvas: HTMLCanvasElement, private meta: MetaProgress) {
    this.state = createGame('huangjin', newSeed(), meta)
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

    const key = this.state.levelKey
    const reached = this.state.wave
    // 第 1 波還沒打完就不算成績，否則一進關卡就會顯示「最佳 1 波」
    if (reached > 1 && (meta.best[key] ?? 0) < reached) {
      meta.best[key] = reached
      this.metaDirty = true
    }
    if (this.state.phase === 'won' && !meta.cleared.includes(key)) {
      meta.cleared.push(key)
      this.metaDirty = true
    }

    // 聲望結算：一局只結一次
    const over = this.state.phase === 'won' || this.state.phase === 'lost'
    if (over && !this.renownPaid) {
      this.renownPaid = true
      const gain = renownFor(this.state.wave, this.state.stats.kills, this.state.phase === 'won')
      meta.renown += gain
      this.metaDirty = true
      this.hud.toast(`獲得聲望 +${gain}（兵書可花用）`)
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
    this.selectedCell = null
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
    this.screens.show(screen)
    this.loop.setPaused(screen !== null)
  }
  startLevel(key: string): void {
    this.state = createGame(key, newSeed(), this.meta)
    recalcUnits(this.state)
    this.selectedCell = null
    this.mode = 'normal'
    this.renownPaid = false
    this.renderer.particles.clear()
    this.wishPanel.hide()
    this.hud.onLevelChanged()
    this.renderer.resize(this.state)
    this.show(null)
    // 讓玩家知道這一局的字池能湊出什麼，抽卡才有方向感
    const list = this.state.poolGenerals.filter((n) => n.length > 1).slice(0, 4)
    if (list.length) this.hud.toast(`本局可湊：${list.join('、')}…`)
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
    if (m !== 'normal') this.selectedCell = null
  }
  getSelectedGlyph(): Unit | null {
    return this.selectedCell === null ? null : glyphAt(this.state, this.selectedCell) ?? null
  }
  getSelectedForms(): Unit[] {
    return this.selectedCell === null ? [] : formsAt(this.state, this.selectedCell)
  }
  select(cell: number | null): void {
    this.selectedCell = cell
    // 心願面板與資訊面板都占畫面底部，不能同時開
    if (cell !== null) this.wishPanel.hide()
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
    this.selectedCell = null
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
