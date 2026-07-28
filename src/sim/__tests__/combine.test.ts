import { describe, expect, it } from 'vitest'
import { cellIndex } from '../board'
import { findCombination } from '../combine'
import { createGame, makeGlyphUnit } from '../state'
import type { GameState } from '../types'

function put(state: GameState, char: string, col: number, row: number, level = 1): number {
  const cell = cellIndex(state.board, col, row)
  state.units.push(makeGlyphUnit(state, char, level, cell))
  return cell
}

describe('組詞判定', () => {
  it('橫向正讀命中配方', () => {
    const s = createGame()
    put(s, '弓', 0, 1)
    const cell = put(s, '兵', 1, 1)
    const m = findCombination(s.board, s.units, cell)
    expect(m?.def.name).toBe('弓兵')
    expect(m?.orientation).toBe('h')
  })

  it('縱向正讀命中配方', () => {
    const s = createGame()
    put(s, '張', 3, 1)
    const cell = put(s, '飛', 3, 2)
    const m = findCombination(s.board, s.units, cell)
    expect(m?.def.name).toBe('張飛')
    expect(m?.orientation).toBe('v')
  })

  it('逆序不成立（飛張 不是配方）', () => {
    const s = createGame()
    put(s, '飛', 0, 1)
    const cell = put(s, '張', 1, 1)
    expect(findCombination(s.board, s.units, cell)).toBeNull()
  })

  it('不相鄰不成立', () => {
    const s = createGame()
    put(s, '張', 0, 1)
    const cell = put(s, '飛', 2, 1)
    expect(findCombination(s.board, s.units, cell)).toBeNull()
  })

  it('橫縱同時滿足時取稀有度高者', () => {
    // 黃 的右邊放「蓋」→ 黃蓋(精良)；下面放「忠」→ 黃忠(傳說)。最後補上 黃
    const s = createGame()
    put(s, '蓋', 2, 1)
    put(s, '忠', 1, 2)
    const cell = put(s, '黃', 1, 1)
    const m = findCombination(s.board, s.units, cell)
    expect(m?.def.name).toBe('黃忠')
    expect(m?.orientation).toBe('v')
  })

  it('已合成的武將不再參與組詞', () => {
    const s = createGame()
    put(s, '弓', 0, 1)
    const cell = put(s, '兵', 1, 1)
    const m = findCombination(s.board, s.units, cell)!
    // 模擬合成：移除字牌，改放一個 general
    s.units = []
    s.units.push({
      ...makeGlyphUnit(s, '弓', 1, m.cells[0]),
      kind: 'general',
      defKey: '弓兵',
      chars: ['弓', '兵'],
      cells: m.cells,
    })
    put(s, '兵', 2, 1)
    expect(findCombination(s.board, s.units, cellIndex(s.board, 2, 1))).toBeNull()
  })
})
