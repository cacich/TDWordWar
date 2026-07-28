/**
 * 心願單挑選面板。
 * 列出本局字池（不是全字表）——只有池內的字許願才有意義，見 sim/pool.ts。
 */
import { GLYPH_BY_CHAR } from '../data/glyphs'
import { GENERALS } from '../data/generals'
import { FX_COLOR } from '../render/fx'
import type { GameState } from '../sim/types'

export interface WishHost {
  getState(): GameState
  toggleWish(char: string): void
  closeWishPanel(): void
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id)
  if (!e) throw new Error(`缺少 DOM 節點 #${id}`)
  return e as T
}

export class WishPanel {
  private panel = el('wishpanel')
  private grid = el('wish-grid')
  private slots = el('wish-slots')
  private sig = ''

  constructor(private host: WishHost) {
    el('wish-close').addEventListener('click', () => this.host.closeWishPanel())
  }

  get visible(): boolean {
    return !this.panel.hidden
  }

  show(): void {
    this.panel.hidden = false
    this.sig = ''
    this.update()
  }

  hide(): void {
    this.panel.hidden = true
  }

  update(): void {
    const s = this.host.getState()
    const nextSig = `${s.wishes.join('')}|${s.pool.join('')}|${s.wishSlots}`
    if (this.sig === nextSig) return
    this.sig = nextSig

    this.slots.textContent = `${s.wishes.length} / ${s.wishSlots}`
    this.grid.innerHTML = ''

    // 依「這個字能組出的武將」排序，讓玩家看得出許願的價值
    const sorted = [...s.pool].sort((a, b) => cat(a) - cat(b) || a.localeCompare(b))
    for (const ch of sorted) {
      const def = GLYPH_BY_CHAR[ch]
      if (!def) continue
      const wished = s.wishes.includes(ch)
      const cell = document.createElement('div')
      cell.className = `codex-cell${wished ? ' wished' : ''}`
      const color = def.fx && def.fx !== 'none' ? FX_COLOR[def.fx] : '#2b2b2b'
      const uses = GENERALS.filter(
        (g) => g.recipe.includes(ch) && g.recipe.every((c) => s.pool.includes(c)),
      ).map((g) => g.name)
      cell.innerHTML =
        `<div class="cx-char" style="color:${color}">${wished ? '★' : ''}${ch}</div>` +
        `<div class="cx-name">${uses.length ? uses.slice(0, 2).join('・') : def.atk > 0 ? `攻${def.atk}` : '輔助'}</div>`
      cell.addEventListener('click', () => this.host.toggleWish(ch))
      this.grid.appendChild(cell)
    }
  }
}

/** 分類排序權重：組將用的姓名字排前面，因為那才是玩家最想指定的 */
function cat(ch: string): number {
  const c = GLYPH_BY_CHAR[ch]?.category
  if (c === 'surname') return 0
  if (c === 'given') return 1
  if (c === 'strategy') return 2
  if (c === 'economy') return 3
  if (c === 'weapon') return 4
  return 5
}
