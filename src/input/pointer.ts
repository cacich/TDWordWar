/**
 * 指標輸入：手牌拖放、場上字牌自由移動、點選、鏟除。
 * 統一走 Pointer Events，滑鼠與觸控共用同一套邏輯。
 *
 * ★ 拖曳的對象一律是「字牌」，不是整個武將。
 *   這樣才能把「張遼」的「遼」拖走、換上「飛」變成「張飛」。
 */
import { MAX_GLYPH_LEVEL } from '../data/glyphs'
import { isPlot } from '../sim/board'
import { mergeHand, moveGlyph, placeFromHand, sellGlyph } from '../sim/actions'
import { glyphAt, unitById } from '../sim/state'
import type { GameState } from '../sim/types'
import type { Renderer } from '../render/renderer'
import type { Mode } from '../ui/hud'

const TAP_SLOP = 8

export interface PointerHost {
  getState(): GameState
  renderer: Renderer
  getMode(): Mode
  setMode(m: Mode): void
  select(cell: number | null): void
  toast(msg: string): void
  onCombined(names: string[]): void
}

export class Input {
  private moved = false
  private downX = 0
  private downY = 0
  private pointerId: number | null = null

  constructor(private host: PointerHost) {
    const canvas = host.renderer.canvas
    canvas.addEventListener('pointerdown', (e) => this.onCanvasDown(e))
    window.addEventListener('pointermove', (e) => this.onMove(e))
    window.addEventListener('pointerup', (e) => this.onUp(e))
    window.addEventListener('pointercancel', () => this.cancel())
  }

  private get drag() {
    return this.host.renderer.view.drag
  }

  private localPoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.host.renderer.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // ── 由 HUD 呼叫：從手牌開始拖曳 ──────────────────────
  beginHandDrag(index: number, e: PointerEvent): void {
    const state = this.host.getState()
    const card = state.hand[index]
    if (!card) return
    const p = this.localPoint(e)
    this.pointerId = e.pointerId
    this.moved = true // 手牌拖曳一開始就視為移動中
    this.downX = p.x
    this.downY = p.y
    Object.assign(this.drag, {
      active: true,
      source: { kind: 'hand', index },
      char: card.char,
      level: card.level,
      px: p.x,
      py: p.y,
      targetCell: -1,
      targetValid: false,
      targetMerge: false,
    })
    this.evalTarget()
  }

  private onCanvasDown(e: PointerEvent): void {
    const state = this.host.getState()
    const r = this.host.renderer
    const p = this.localPoint(e)
    const cell = r.cellFromPoint(state, p.x, p.y)
    if (cell < 0) return
    const g = glyphAt(state, cell)

    if (this.host.getMode() === 'shovel') {
      if (!g) {
        this.host.toast('點選要鏟除的字')
        return
      }
      const res = sellGlyph(state, g.id)
      if (res.msg) this.host.toast(res.msg)
      this.host.select(null)
      this.host.setMode('normal')
      return
    }

    if (!g) {
      this.host.select(null)
      return
    }

    this.pointerId = e.pointerId
    this.moved = false
    this.downX = p.x
    this.downY = p.y
    Object.assign(this.drag, {
      active: true,
      source: { kind: 'unit', id: g.id },
      char: g.chars[0],
      level: g.level,
      px: p.x,
      py: p.y,
      targetCell: cell,
      targetValid: true,
      targetMerge: false,
    })
  }

  private onMove(e: PointerEvent): void {
    if (!this.drag.active || (this.pointerId !== null && e.pointerId !== this.pointerId)) return
    const p = this.localPoint(e)
    this.drag.px = p.x
    this.drag.py = p.y
    if (Math.hypot(p.x - this.downX, p.y - this.downY) > TAP_SLOP) this.moved = true
    this.evalTarget()
  }

  private onUp(e: PointerEvent): void {
    if (!this.drag.active || (this.pointerId !== null && e.pointerId !== this.pointerId)) return
    const state = this.host.getState()
    const d = this.drag
    const src = d.source
    const cell = d.targetCell

    if (src?.kind === 'unit' && !this.moved) {
      // 沒有移動 → 視為點選該格
      const g = unitById(state, src.id)
      this.host.select(g ? g.cells[0] : null)
      this.cancel()
      return
    }

    // 手牌拖到另一張手牌上 → 同字同階疊合升階
    if (src?.kind === 'hand' && cell < 0) {
      const overIndex = handIndexAtPoint(e.clientX, e.clientY)
      if (overIndex !== null && overIndex !== src.index) {
        const res = mergeHand(state, src.index, overIndex)
        if (res.msg) this.host.toast(res.msg)
        this.cancel()
        return
      }
    }

    if (src && cell >= 0) {
      const res =
        src.kind === 'hand' ? placeFromHand(state, src.index, cell) : moveGlyph(state, src.id, cell)
      if (res.msg) this.host.toast(res.msg)
      if (res.broken?.length && !res.msg) this.host.toast(`解除 ${res.broken.join('、')}`)
      if (res.combined?.length) this.host.onCombined(res.combined)
      if (res.ok) this.host.select(cell)
    } else if (src?.kind === 'hand') {
      this.host.toast('請放在棋盤的空地上')
    }
    this.cancel()
  }

  private cancel(): void {
    this.drag.active = false
    this.drag.source = null
    this.drag.targetCell = -1
    this.pointerId = null
    this.moved = false
  }

  /** 計算落點是否合法、是否為疊合 */
  private evalTarget(): void {
    const state = this.host.getState()
    const d = this.drag
    const cell = this.host.renderer.cellFromPoint(state, d.px, d.py)
    d.targetCell = cell
    d.targetMerge = false
    if (cell < 0 || !isPlot(state.board, cell)) {
      d.targetValid = false
      return
    }

    const occupant = glyphAt(state, cell)
    if (!occupant) {
      d.targetValid = true
      return
    }
    const src = d.source
    if (src?.kind === 'unit' && occupant.id === src.id) {
      d.targetValid = true
      return
    }
    const mergeable =
      occupant.chars[0] === d.char && occupant.level === d.level && occupant.level < MAX_GLYPH_LEVEL
    d.targetValid = mergeable
    d.targetMerge = mergeable
  }
}

/** 指標下方是哪一張手牌（拖到手牌上疊合用）。這是 input 層唯一碰 DOM 的地方 */
function handIndexAtPoint(clientX: number, clientY: number): number | null {
  const el = document.elementFromPoint(clientX, clientY)
  const card = el?.closest('.card') as HTMLElement | null
  if (!card || card.dataset.index === undefined) return null
  return Number(card.dataset.index)
}
