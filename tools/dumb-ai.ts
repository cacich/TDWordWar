/**
 * 傻 AI：`npm run sim` 與 `npm run econ` 共用的固定策略玩家。
 *
 * 它是本專案的**難度量尺**，所以有一條硬規則：
 * **兩個工具必須用同一個 AI**，否則經濟儀表板量到的東西跟難度基準不是同一回事。
 * 這個檔案存在的唯一理由就是強制這件事（以前兩邊各抄一份，會各自漂移）。
 *
 * 策略刻意保持「一般玩家的直覺」而不是最佳解：
 *   1. 手牌裡同字同階的先疊合升階（真人一定會做，而且不花糧）
 *   2. 糧夠就征兵，直到手牌滿
 *   3. 逐張找落點：能組成武將 > 能疊到場上同字同階 > 最靠近路徑的空位
 *
 * ⚠ 改動這裡等於改動難度量尺——所有關卡的 sim 中位數基準都要重跑重寫。
 */
import { MAX_GLYPH_LEVEL } from '../src/data/glyphs'
import { mergeHand, placeFromHand, recruit } from '../src/sim/actions'
import { cellCol, cellRow, isPlot } from '../src/sim/board'
import { findCombination } from '../src/sim/combine'
import { recruitCost } from '../src/sim/economy'
import { glyphAt, makeGlyphUnit } from '../src/sim/state'
import type { GameState } from '../src/sim/types'

/** 候選空地：離路徑越近越優先（射程才夠得到）。每局算一次就好 */
export function candidateCells(state: GameState): number[] {
  const b = state.board
  const pathCells = b.path.map((p) => ({ c: cellCol(b, p), r: cellRow(b, p) }))
  const out: { cell: number; d: number }[] = []
  for (let i = 0; i < b.tiles.length; i++) {
    if (!isPlot(b, i)) continue
    const c = cellCol(b, i)
    const r = cellRow(b, i)
    let best = Infinity
    for (const p of pathCells) best = Math.min(best, Math.hypot(p.c - c, p.r - r))
    out.push({ cell: i, d: best })
  }
  return out.sort((a, b2) => a.d - b2.d).map((x) => x.cell)
}

/**
 * 落點決策，優先序模擬一般玩家的直覺：
 *   1. 能立刻組成武將
 *   2. 能疊到同字同階的字牌上升階（組成武將後也能疊，武將會同步變強）
 *   3. 最靠近路徑的空位
 */
export function chooseCell(state: GameState, char: string, level: number, cells: number[]): number | null {
  let stack: number | null = null
  let fallback: number | null = null
  for (const cell of cells) {
    const occupant = glyphAt(state, cell)
    if (occupant) {
      if (stack === null && occupant.chars[0] === char && occupant.level === level && occupant.level < MAX_GLYPH_LEVEL) {
        stack = cell
      }
      continue
    }
    if (fallback === null) fallback = cell
    const probe = makeGlyphUnit(state, char, level, cell)
    if (findCombination(state.board, [...state.units, probe], cell)) return cell
  }
  return stack ?? fallback
}

/**
 * 把手牌裡所有「同字同階」的組合疊掉，直到沒得疊。
 *
 * 這一步是後期戰力能不能繼續成長的關鍵：棋盤放滿之後，
 * 唯一還能變強的路徑就是把手上的字疊高再換上去。
 * 少了它，AI 會在棋盤填滿的那一波直接凍結（戰力不再成長、糧食無限累積）。
 */
function mergeHandAll(state: GameState): void {
  for (;;) {
    let did = false
    for (let i = 0; i < state.hand.length && !did; i++) {
      const a = state.hand[i]
      if (!a || a.level >= MAX_GLYPH_LEVEL) continue
      for (let j = i + 1; j < state.hand.length; j++) {
        const b = state.hand[j]
        if (!b || b.char !== a.char || b.level !== a.level) continue
        if (mergeHand(state, i, j).ok) did = true
        break
      }
    }
    if (!did) return
  }
}

/**
 * 佈陣階段的一整輪決策。呼叫端只要在 `phase === 'prep'` 時呼叫一次。
 *
 * ⚠ 放置迴圈用 `continue` 而不是 `break`：某一張放不下（例如棋盤只剩遠處空位、
 * 而這張字沒有可疊的對象）不代表後面幾張也放不下。
 */
export function playPrep(state: GameState, cells: number[]): void {
  mergeHandAll(state)
  while (state.food >= recruitCost(state) && state.hand.some((h) => h === null)) {
    if (!recruit(state).ok) break
  }
  mergeHandAll(state) // 剛征來的字可能剛好湊成一對
  for (let i = 0; i < state.hand.length; i++) {
    const card = state.hand[i]
    if (!card) continue
    const cell = chooseCell(state, card.char, card.level, cells)
    if (cell === null) continue
    placeFromHand(state, i, cell)
  }
}
