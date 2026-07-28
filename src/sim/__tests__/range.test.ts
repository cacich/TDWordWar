import { describe, expect, it } from 'vitest'
import { cellIndex } from '../board'
import { placeFromHand } from '../actions'
import { GENERAL_RANGE_BONUS, RANGE_MUL, canHit } from '../combat'
import { GLYPH_BY_CHAR } from '../../data/glyphs'
import { GENERAL_BY_NAME } from '../../data/generals'
import { createGame, glyphAt } from '../state'
import type { Enemy, GameState } from '../types'

function hand(s: GameState, index: number, char: string, level = 1): void {
  s.hand[index] = { char, level }
}

const flyer = { flying: true } as Enemy
const ground = { flying: false } as Enemy

describe('射程放大', () => {
  it('單獨字牌的射程 = 基礎 × 全域倍率', () => {
    const s = createGame()
    const cell = cellIndex(s.board, 0, 1)
    hand(s, 0, '刀') // baseRange 1.2
    placeFromHand(s, 0, cell)
    expect(glyphAt(s, cell)!.range).toBeCloseTo(GLYPH_BY_CHAR['刀'].range * RANGE_MUL, 5)
  })

  it('武將射程 = 基礎 × 全域倍率 × 武將加成 + 多格中心補償', () => {
    const s = createGame()
    hand(s, 0, '弓')
    hand(s, 1, '兵')
    placeFromHand(s, 0, cellIndex(s.board, 2, 1))
    placeFromHand(s, 1, cellIndex(s.board, 3, 1)) // 橫向弓兵
    const form = s.units.find((u) => u.kind === 'general')!
    const def = GENERAL_BY_NAME['弓兵']
    // 兩格橫向：中心到最遠格 = 0.5
    expect(form.range).toBeCloseTo(def.range * RANGE_MUL * GENERAL_RANGE_BONUS + 0.5, 5)
  })

  it('直立合成的武將射程不再比橫向小（中心外移已補償）', () => {
    const h = createGame()
    hand(h, 0, '弓')
    hand(h, 1, '兵')
    placeFromHand(h, 0, cellIndex(h.board, 2, 1))
    placeFromHand(h, 1, cellIndex(h.board, 3, 1)) // 橫向
    const horiz = h.units.find((u) => u.kind === 'general')!.range

    const v = createGame()
    hand(v, 0, '弓')
    hand(v, 1, '兵')
    placeFromHand(v, 0, cellIndex(v.board, 0, 1))
    placeFromHand(v, 1, cellIndex(v.board, 0, 2)) // 直立
    const vert = v.units.find((u) => u.kind === 'general')!.range

    expect(vert).toBeCloseTo(horiz, 5)
  })

  it('對空資格不受射程放大影響：近戰仍打不到飛行，弓系可以', () => {
    const s = createGame()
    hand(s, 0, '刀') // baseRange 1.2 → 近戰
    hand(s, 1, '弓') // baseRange 3.5 → 遠程
    placeFromHand(s, 0, cellIndex(s.board, 0, 1))
    placeFromHand(s, 1, cellIndex(s.board, 1, 1))
    const dao = glyphAt(s, cellIndex(s.board, 0, 1))!
    const gong = glyphAt(s, cellIndex(s.board, 1, 1))!

    expect(dao.range).toBeGreaterThan(2) // 放大後半徑超過 2，但…
    expect(canHit(dao, flyer)).toBe(false) // …仍打不到飛行
    expect(canHit(dao, ground)).toBe(true)
    expect(canHit(gong, flyer)).toBe(true)
  })
})
