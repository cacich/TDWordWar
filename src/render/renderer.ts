/**
 * 主繪製。輸入為 GameState + ViewState，不修改任何遊戲狀態。
 * 座標系統：sim 用「格」為單位，此檔負責換算成畫布 px。
 */
import { TIER_ORDER } from '../data/generals'
import { cellCol, cellRow, cellIndex } from '../sim/board'
import { enemyPos, unitCenter } from '../sim/combat'
import type { GameState, Tier, Unit } from '../sim/types'
import { FX_COLOR, drawAttack, splashColor } from './fx'
import { Particles } from './particles'
import { FONT_STACK, HINT_COLOR, STATUS_COLOR, THEME, TIER_COLOR, TIER_TINT, glyphFont, qualityColor, roundRect } from './theme'

export interface DragState {
  active: boolean
  /** 來源：手牌索引或場上單位 id */
  source: { kind: 'hand'; index: number } | { kind: 'unit'; id: number } | null
  char: string
  level: number
  px: number
  py: number
  targetCell: number
  targetValid: boolean
  targetMerge: boolean
  /** 落點已有無法疊合的字牌，放下去會與它交換位置 */
  targetSwap: boolean
}

export interface ViewState {
  cell: number
  ox: number
  oy: number
  w: number
  h: number
  /** 選取的是「格子」而不是單位：一格上可能同時有字牌與一到兩個武將 */
  selectedCell: number | null
  drag: DragState
}

export function emptyDrag(): DragState {
  return {
    active: false,
    source: null,
    char: '',
    level: 1,
    px: 0,
    py: 0,
    targetCell: -1,
    targetValid: false,
    targetMerge: false,
    targetSwap: false,
  }
}

export class Renderer {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  view: ViewState
  readonly particles = new Particles()
  /** 每幀重建的衍生查表：字牌格 → 所屬武將的最高階級（決定成員字牌底色） */
  private memberTier = new Map<number, Tier>()
  /** 每幀重建的衍生查表：字牌格 → 提示種類（來自 state.hintCells） */
  private hintKind = new Map<number, 'upgrade' | 'combine'>()

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('無法取得 2D context')
    this.ctx = ctx
    this.view = { cell: 32, ox: 0, oy: 0, w: 0, h: 0, selectedCell: null, drag: emptyDrag() }
  }

  resize(state: GameState): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = this.canvas.getBoundingClientRect()
    const w = Math.max(1, Math.floor(rect.width))
    const h = Math.max(1, Math.floor(rect.height))
    this.canvas.width = Math.floor(w * dpr)
    this.canvas.height = Math.floor(h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const pad = 6
    const cell = Math.floor(
      Math.min((w - pad * 2) / state.board.cols, (h - pad * 2) / state.board.rows),
    )
    this.view.cell = cell
    this.view.ox = Math.floor((w - cell * state.board.cols) / 2)
    this.view.oy = Math.floor((h - cell * state.board.rows) / 2)
    this.view.w = w
    this.view.h = h
  }

  /** 畫布 px → cell 索引，超出棋盤回傳 -1 */
  cellFromPoint(state: GameState, px: number, py: number): number {
    const { cell, ox, oy } = this.view
    const c = Math.floor((px - ox) / cell)
    const r = Math.floor((py - oy) / cell)
    if (c < 0 || c >= state.board.cols || r < 0 || r >= state.board.rows) return -1
    return cellIndex(state.board, c, r)
  }

  private gx(x: number): number {
    return this.view.ox + x * this.view.cell
  }
  private gy(y: number): number {
    return this.view.oy + y * this.view.cell
  }

  /** dt 只給粒子用；模擬本身是固定步長，與這裡無關 */
  draw(state: GameState, dt = 0): void {
    const ctx = this.ctx
    const { w, h } = this.view
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = THEME.paper
    ctx.fillRect(0, 0, w, h)

    this.drawTiles(state)
    this.drawHintCells(state)
    this.drawRangeIndicator(state)
    this.drawUnits(state)
    this.drawEnemies(state)
    this.drawEffects(state)
    this.particles.step(dt)
    this.particles.draw(this.ctx, (x) => this.gx(x), (y) => this.gy(y), this.view.cell)
    this.drawDrag()
  }

  private drawTiles(state: GameState): void {
    const ctx = this.ctx
    const { cell } = this.view
    const b = state.board
    for (let i = 0; i < b.tiles.length; i++) {
      const c = cellCol(b, i)
      const r = cellRow(b, i)
      const x = this.gx(c)
      const y = this.gy(r)
      const kind = b.tiles[i]

      if (kind === 'plot') {
        ctx.fillStyle = Math.floor(r / 3) % 2 === 0 ? THEME.plotA : THEME.plotB
        ctx.fillRect(x, y, cell, cell)
        ctx.strokeStyle = THEME.plotLine
        ctx.lineWidth = 1
        ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1)
      } else if (kind === 'path') {
        ctx.fillStyle = THEME.path
        ctx.fillRect(x, y, cell, cell)
        ctx.strokeStyle = THEME.pathDash
        ctx.lineWidth = 1
        ctx.setLineDash([3, 5])
        ctx.beginPath()
        ctx.moveTo(x, y + cell * 0.5)
        ctx.lineTo(x + cell, y + cell * 0.5)
        ctx.stroke()
        ctx.setLineDash([])
      } else if (kind === 'block') {
        ctx.fillStyle = THEME.block
        ctx.fillRect(x, y, cell, cell)
        ctx.strokeStyle = THEME.inkSoft
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(x + cell * 0.2, y + cell * 0.75)
        ctx.lineTo(x + cell * 0.45, y + cell * 0.3)
        ctx.lineTo(x + cell * 0.7, y + cell * 0.75)
        ctx.stroke()
      } else if (kind === 'spawn' || kind === 'camp') {
        ctx.fillStyle = kind === 'camp' ? THEME.camp : THEME.spawn
        ctx.fillRect(x, y, cell, cell)
        ctx.fillStyle = '#fff8e8'
        ctx.font = glyphFont(cell * 0.6)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(kind === 'camp' ? '營' : '寨', x + cell / 2, y + cell / 2 + 1)
      }
    }
  }

  /** 拖曳中的落點提示 */
  private drawHintCells(state: GameState): void {
    const d = this.view.drag
    if (!d.active || d.targetCell < 0) return
    const ctx = this.ctx
    const { cell } = this.view
    const x = this.gx(cellCol(state.board, d.targetCell))
    const y = this.gy(cellRow(state.board, d.targetCell))
    ctx.fillStyle = !d.targetValid
      ? THEME.hintRed
      : d.targetMerge
        ? THEME.hintMerge
        : d.targetSwap
          ? THEME.hintSwap
          : THEME.hintGreen
    ctx.fillRect(x, y, cell, cell)
  }

  /** 選取格子上「實際會出手」的單位射程：有武將就畫武將的，否則畫字牌的 */
  private drawRangeIndicator(state: GameState): void {
    const cell = this.view.selectedCell
    if (cell === null) return
    const forms = state.units.filter((u) => u.kind === 'general' && u.cells.includes(cell))
    const glyph = state.units.find((u) => u.kind === 'glyph' && u.cells[0] === cell)
    const shown = forms.length ? forms : glyph && glyph.formIds.length === 0 ? [glyph] : []
    const ctx = this.ctx
    for (const u of shown) {
      if (u.range <= 0) continue
      const c = unitCenter(state.board, u)
      ctx.strokeStyle = 'rgba(60,90,160,0.55)'
      ctx.fillStyle = 'rgba(90,130,200,0.10)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.arc(this.gx(c.x), this.gy(c.y), u.range * this.view.cell, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  /**
   * 三趟畫法，讓「武將是一整塊」比舊版的細框更明顯，同時保留字牌各自可升級／可拆分：
   *   1. 武將底板（鋪在最底，把多格連成一塊）
   *   2. 字牌（成員字牌套用武將底色，看起來像同一單位的一部分）
   *   3. 武將外框、開火閃光、技能冷卻條（疊在最上）
   */
  private drawUnits(state: GameState): void {
    // 先建立衍生查表：每個字牌格屬於哪個階級的武將、有沒有場上動作提示
    this.memberTier.clear()
    for (const u of state.units) {
      if (u.kind !== 'general') continue
      for (const c of u.cells) {
        const prev = this.memberTier.get(c)
        if (prev === undefined || TIER_ORDER[u.tier] > TIER_ORDER[prev]) this.memberTier.set(c, u.tier)
      }
    }
    this.hintKind.clear()
    for (const h of state.hintCells) {
      // 一格同時可升級與可湊將時，升級優先（更直接可做）
      if (this.hintKind.get(h.cell) !== 'upgrade') this.hintKind.set(h.cell, h.kind)
    }

    for (const u of state.units) {
      if (u.kind === 'general') this.drawFormBody(state, u)
    }
    for (const u of state.units) {
      if (u.kind === 'glyph') this.drawGlyphUnit(state, u)
    }
    for (const u of state.units) {
      if (u.kind === 'general') this.drawFormFrame(state, u)
    }
  }

  private drawGlyphUnit(state: GameState, u: Unit): void {
    const ctx = this.ctx
    const { cell } = this.view
    const x = this.gx(cellCol(state.board, u.cells[0]))
    const y = this.gy(cellRow(state.board, u.cells[0]))
    const pad = Math.max(1, cell * 0.06)
    const qc = qualityColor(u.level)
    const member = u.formIds.length > 0
    const tier = member ? this.memberTier.get(u.cells[0]) : undefined

    // 成員字牌鋪武將底色（與武將底板連成一塊）；單獨字牌維持素白卡
    ctx.fillStyle = tier ? TIER_TINT[tier] : '#fffdf6'
    roundRect(ctx, x + pad, y + pad, cell - pad * 2, cell - pad * 2, cell * 0.12)
    ctx.fill()
    // 單獨字牌自己描邊（品質越高越粗越亮）；成員字牌不描邊，才不會在兩字之間留分隔線——外框由武將負責
    if (!member) {
      ctx.strokeStyle = u.level > 1 ? qc : THEME.ink
      ctx.lineWidth = u.level > 1 ? 2.2 : 1.4
      ctx.stroke()
      // 剛開火 → 用該單位的特效色閃一下外框，讓玩家對得上是誰打的（成員的開火閃光由武將框代表）
      if (u.atkFlash > 0) this.drawAtkFlash(x, y, cell, cell, pad, u)
    }

    ctx.fillStyle = tier ? (tier === 'common' ? THEME.ink : TIER_COLOR[tier]) : u.level > 2 ? qc : THEME.ink
    ctx.font = glyphFont(cell * 0.6)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(u.chars[0], x + cell / 2, y + cell / 2 + 1)

    if (u.aura && !member) this.drawAuraRing(state, u)
    if (u.level > 1) this.drawLevelBadge(x + cell - pad, y + pad, u.level, qc)
    // 場上動作提示：可疊合升級（綠）／可湊將（金）的字牌畫脈動光暈，單位一多也能一眼分辨
    const hint = this.hintKind.get(u.cells[0])
    if (hint) this.drawHintHalo(x + pad, y + pad, cell - pad * 2, cell - pad * 2, HINT_COLOR[hint])
    if (this.view.selectedCell === u.cells[0]) {
      this.drawSelection(x + pad, y + pad, cell - pad * 2, cell - pad * 2)
    }
  }

  /** 武將底板：鋪在字牌下方的一整塊淡色，把多格連成一個單位（配合成員字牌同底色） */
  private drawFormBody(state: GameState, u: Unit): void {
    const ctx = this.ctx
    const { cell } = this.view
    const cols = u.cells.map((c) => cellCol(state.board, c))
    const rows = u.cells.map((c) => cellRow(state.board, c))
    const vertical = new Set(cols).size === 1 && u.cells.length > 1
    const inset = cell * (vertical ? 0.16 : 0.02)
    const x = this.gx(Math.min(...cols)) + inset
    const y = this.gy(Math.min(...rows)) + inset
    const w = (Math.max(...cols) - Math.min(...cols) + 1) * cell - inset * 2
    const h = (Math.max(...rows) - Math.min(...rows) + 1) * cell - inset * 2
    ctx.fillStyle = TIER_TINT[u.tier]
    roundRect(ctx, x, y, w, h, cell * 0.14)
    ctx.fill()
  }

  /** 場上動作提示光暈：脈動描邊 + 柔光，畫在可疊合／可湊將的字牌外緣 */
  private drawHintHalo(x: number, y: number, w: number, h: number, color: string): void {
    const ctx = this.ctx
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 320)
    ctx.save()
    ctx.globalAlpha = 0.35 + pulse * 0.4
    ctx.strokeStyle = color
    ctx.lineWidth = 2 + pulse * 1.4
    ctx.shadowColor = color
    ctx.shadowBlur = this.view.cell * (0.18 + pulse * 0.12)
    roundRect(ctx, x - 1.5, y - 1.5, w + 3, h + 3, this.view.cell * 0.14)
    ctx.stroke()
    ctx.restore()
  }

  /**
   * 武將外框：疊在字牌上方，與底板一起把成員框成一整塊。
   * 一個字可能同時屬於橫向與縱向兩個武將，所以框要用不同內縮量錯開才看得出有兩個。
   */
  private drawFormFrame(state: GameState, u: Unit): void {
    const ctx = this.ctx
    const { cell } = this.view
    const cols = u.cells.map((c) => cellCol(state.board, c))
    const rows = u.cells.map((c) => cellRow(state.board, c))
    const vertical = new Set(cols).size === 1 && u.cells.length > 1
    const inset = cell * (vertical ? 0.16 : 0.02)
    const x = this.gx(Math.min(...cols)) + inset
    const y = this.gy(Math.min(...rows)) + inset
    const w = (Math.max(...cols) - Math.min(...cols) + 1) * cell - inset * 2
    const h = (Math.max(...rows) - Math.min(...rows) + 1) * cell - inset * 2
    const color = TIER_COLOR[u.tier]

    ctx.save()
    if (u.skillFlash > 0) {
      ctx.shadowColor = color
      ctx.shadowBlur = cell * 0.6
    }
    ctx.strokeStyle = color
    ctx.lineWidth = u.tier === 'common' ? 2.8 : 3.6
    roundRect(ctx, x, y, w, h, cell * 0.14)
    ctx.stroke()
    ctx.restore()

    if (u.atkFlash > 0) this.drawAtkFlash(x, y, w, h, 0, u)

    // 主動技冷卻條
    if (u.skillCdMax > 0) {
      const ready = 1 - Math.max(0, u.skillCd) / u.skillCdMax
      const bh = Math.max(2, cell * 0.055)
      ctx.fillStyle = 'rgba(0,0,0,0.14)'
      ctx.fillRect(x + 2, y + h - bh - 2, w - 4, bh)
      ctx.fillStyle = ready >= 1 ? THEME.gold : color
      ctx.fillRect(x + 2, y + h - bh - 2, (w - 4) * ready, bh)
    }

    if (u.aura) this.drawAuraRing(state, u)
    if (this.view.selectedCell !== null && u.cells.includes(this.view.selectedCell)) {
      ctx.save()
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 1.4
      ctx.setLineDash([3, 3])
      roundRect(ctx, x - 3, y - 3, w + 6, h + 6, cell * 0.16)
      ctx.stroke()
      ctx.restore()
    }
  }

  /** 開火閃光：用單位自己的特效色描邊，跟飛出去的特效同色 */
  private drawAtkFlash(x: number, y: number, w: number, h: number, pad: number, u: Unit): void {
    const ctx = this.ctx
    const t = Math.max(0, Math.min(1, u.atkFlash / 0.18))
    ctx.save()
    ctx.globalAlpha = t * 0.9
    ctx.strokeStyle = FX_COLOR[u.fx]
    ctx.lineWidth = 3.2
    roundRect(ctx, x + pad - 1, y + pad - 1, w - pad * 2 + 2, h - pad * 2 + 2, this.view.cell * 0.14)
    ctx.stroke()
    ctx.restore()
  }

  /** 光環範圍：常駐淡圈，讓玩家看得出「陣」「令」影響到誰 */
  private drawAuraRing(state: GameState, u: Unit): void {
    const ctx = this.ctx
    const c = unitCenter(state.board, u)
    ctx.strokeStyle = 'rgba(180,120,40,0.35)'
    ctx.fillStyle = 'rgba(210,170,90,0.10)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(this.gx(c.x), this.gy(c.y), u.aura!.radius * this.view.cell, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  private drawLevelBadge(rightX: number, topY: number, level: number, color?: string): void {
    const ctx = this.ctx
    const s = this.view.cell * 0.26
    ctx.fillStyle = color ?? THEME.enemyHp
    ctx.beginPath()
    ctx.arc(rightX - s * 0.5, topY + s * 0.5, s * 0.62, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = glyphFont(s * 0.95)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(level), rightX - s * 0.5, topY + s * 0.5 + 0.5)
  }

  private drawSelection(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx
    ctx.strokeStyle = THEME.gold
    ctx.lineWidth = 2.4
    ctx.setLineDash([4, 3])
    roundRect(ctx, x - 2, y - 2, w + 4, h + 4, this.view.cell * 0.16)
    ctx.stroke()
    ctx.setLineDash([])
  }

  private drawEnemies(state: GameState): void {
    const ctx = this.ctx
    const { cell } = this.view
    for (const e of state.enemies) {
      const p = enemyPos(state.board, e)
      const cx = this.gx(p.x)
      const cy = this.gy(p.y)
      const s = cell * 0.78

      ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : 'rgba(255,252,244,0.9)'
      roundRect(ctx, cx - s / 2, cy - s / 2, s, s, s * 0.2)
      ctx.fill()
      ctx.strokeStyle = e.flying ? '#4a6fb5' : THEME.enemy
      ctx.lineWidth = e.defKey === 'boss' ? 2.4 : 1.2
      ctx.stroke()

      ctx.fillStyle = e.defKey === 'boss' ? THEME.enemyHp : THEME.enemy
      ctx.font = glyphFont(s * 0.72)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(e.char, cx, cy + 1)

      // 血條
      const bw = s * 0.95
      const bh = Math.max(2.5, cell * 0.075)
      const by = cy - s / 2 - bh - 2
      ctx.fillStyle = THEME.enemyHpBg
      ctx.fillRect(cx - bw / 2, by, bw, bh)
      ctx.fillStyle = THEME.enemyHp
      ctx.fillRect(cx - bw / 2, by, bw * Math.max(0, e.hp / e.maxHp), bh)

      // 狀態小圓點：灼燒／減速／定身／易傷
      const pips: string[] = []
      if (e.burnT > 0) pips.push(STATUS_COLOR.burn)
      if (e.slow > 0) pips.push(STATUS_COLOR.slow)
      if (e.stun > 0) pips.push(STATUS_COLOR.stun)
      if (e.vuln > 0) pips.push(STATUS_COLOR.vuln)
      if (pips.length) {
        const r = Math.max(1.6, cell * 0.055)
        const step = r * 2.6
        let px = cx - ((pips.length - 1) * step) / 2
        for (const color of pips) {
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(px, cy + s / 2 + r + 1.5, r, 0, Math.PI * 2)
          ctx.fill()
          px += step
        }
      }
    }
  }

  private drawEffects(state: GameState): void {
    const ctx = this.ctx
    const { cell } = this.view
    for (const f of state.effects) {
      const t = f.life / f.maxLife
      const x1 = this.gx(f.fromX)
      const y1 = this.gy(f.fromY)
      const x2 = this.gx(f.toX)
      const y2 = this.gy(f.toY)

      if (f.kind === 'attack') {
        drawAttack(ctx, f, { x1, y1, x2, y2, cell }, t)
      } else if (f.kind === 'splash') {
        const r = cell * 1.3 * (1 - t)
        ctx.save()
        ctx.globalAlpha = 0.75 * t
        ctx.strokeStyle = splashColor(f.fx)
        ctx.lineWidth = cell * 0.07
        ctx.beginPath()
        ctx.arc(x1, y1, r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      } else if (f.kind === 'ring') {
        // toX − fromX 帶著半徑資訊（見 sim/skills.ts 的 ring()）
        const radius = (f.toX - f.fromX) * cell
        ctx.save()
        ctx.globalAlpha = t
        ctx.strokeStyle = f.color ?? '#c85a28'
        ctx.lineWidth = cell * 0.09
        ctx.beginPath()
        ctx.arc(x1, y1, Math.max(cell * 0.2, radius * (1.15 - t * 0.15)), 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      } else if (f.kind === 'beam') {
        ctx.save()
        ctx.globalAlpha = t
        ctx.strokeStyle = f.color ?? '#8a4fd4'
        ctx.lineWidth = cell * 0.16
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
        ctx.restore()
      } else if (f.kind === 'text') {
        ctx.save()
        ctx.globalAlpha = Math.min(1, t * 1.4)
        ctx.fillStyle = f.color ?? '#2f7a3c'
        ctx.font = `700 ${Math.round(cell * (f.color ? 0.38 : 0.32))}px ${FONT_STACK}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(f.text ?? '', x1, y1 - (1 - t) * cell * 0.9)
        ctx.restore()
      }
    }
  }

  private drawDrag(): void {
    const d = this.view.drag
    if (!d.active) return
    const ctx = this.ctx
    const cell = this.view.cell
    const s = cell * 0.95
    ctx.save()
    ctx.globalAlpha = 0.85
    ctx.fillStyle = '#fffdf6'
    roundRect(ctx, d.px - s / 2, d.py - s / 2, s, s, s * 0.12)
    ctx.fill()
    ctx.strokeStyle = THEME.ink
    ctx.lineWidth = 1.6
    ctx.stroke()
    ctx.fillStyle = THEME.ink
    ctx.font = glyphFont(s * 0.6)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(d.char, d.px, d.py + 1)
    ctx.restore()
  }
}
