import { describe, expect, it } from 'vitest'
import { cellIndex } from '../board'
import { placeFromHand, moveGlyph, recruit, sellGlyph } from '../actions'
import { createGame, glyphAt } from '../state'
import type { GameState } from '../types'

function hand(s: GameState, index: number, char: string, level = 1): void {
  s.hand[index] = { char, level }
}

describe('放置與疊合', () => {
  it('放到路上會失敗', () => {
    const s = createGame()
    hand(s, 0, '刀')
    const onPath = cellIndex(s.board, 3, 0)
    expect(placeFromHand(s, 0, onPath).ok).toBe(false)
    expect(s.hand[0]).not.toBeNull()
  })

  it('同字同級疊合升等，屬性提升', () => {
    const s = createGame()
    const cell = cellIndex(s.board, 0, 1)
    hand(s, 0, '刀')
    placeFromHand(s, 0, cell)
    const atk1 = glyphAt(s, cell)!.baseAtk
    hand(s, 1, '刀')
    placeFromHand(s, 1, cell)
    const u = glyphAt(s, cell)!
    expect(u.level).toBe(2)
    expect(u.baseAtk).toBeGreaterThan(atk1)
  })

  it('不同字不可疊合', () => {
    const s = createGame()
    const cell = cellIndex(s.board, 0, 1)
    hand(s, 0, '刀')
    placeFromHand(s, 0, cell)
    hand(s, 1, '弓')
    expect(placeFromHand(s, 1, cell).ok).toBe(false)
  })
})

describe('合成武將', () => {
  it('放置後觸發合成，字牌保留，武將疊在上面', () => {
    const s = createGame()
    hand(s, 0, '張')
    hand(s, 1, '飛')
    placeFromHand(s, 0, cellIndex(s.board, 0, 1))
    const res = placeFromHand(s, 1, cellIndex(s.board, 1, 1))
    expect(res.combined).toContain('張飛')
    // 兩個字牌 + 一個武將
    expect(s.units).toHaveLength(3)
    const form = s.units.find((u) => u.kind === 'general')!
    expect(form.cells).toHaveLength(2)
    expect(form.memberIds).toHaveLength(2)
    for (const g of s.units.filter((u) => u.kind === 'glyph')) {
      expect(g.formIds).toContain(form.id)
    }
  })

  it('字牌等級會繼承：高等級字組出的武將更強', () => {
    const weak = createGame()
    hand(weak, 0, '張')
    hand(weak, 1, '飛')
    placeFromHand(weak, 0, cellIndex(weak.board, 0, 1))
    placeFromHand(weak, 1, cellIndex(weak.board, 1, 1))

    const strong = createGame()
    hand(strong, 0, '張', 3)
    hand(strong, 1, '飛', 3)
    placeFromHand(strong, 0, cellIndex(strong.board, 0, 1))
    placeFromHand(strong, 1, cellIndex(strong.board, 1, 1))

    expect(strong.units[0].baseAtk).toBeGreaterThan(weak.units[0].baseAtk * 2)
  })

  it('移動字牌到相鄰位置也會觸發合成', () => {
    const s = createGame()
    hand(s, 0, '關')
    hand(s, 1, '羽')
    placeFromHand(s, 0, cellIndex(s.board, 0, 1))
    placeFromHand(s, 1, cellIndex(s.board, 4, 2))
    const yu = glyphAt(s, cellIndex(s.board, 4, 2))!
    const res = moveGlyph(s, yu.id, cellIndex(s.board, 1, 1))
    expect(res.combined).toContain('關羽')
  })
})

describe('武將可持續強化與改組（M4b）', () => {
  it('組成武將後還能繼續疊同一個字，武將會同步變強', () => {
    const s = createGame()
    hand(s, 0, '張')
    hand(s, 1, '飛')
    placeFromHand(s, 0, cellIndex(s.board, 0, 1))
    placeFromHand(s, 1, cellIndex(s.board, 1, 1))
    const form = s.units.find((u) => u.kind === 'general')!
    const before = form.baseAtk
    expect(form.level).toBe(2) // 一階 + 一階

    hand(s, 2, '張')
    const res = placeFromHand(s, 2, cellIndex(s.board, 0, 1))
    expect(res.ok).toBe(true)
    expect(glyphAt(s, cellIndex(s.board, 0, 1))!.level).toBe(2)
    // 同一個武將物件被就地重算，不是重新合成
    expect(s.units.filter((u) => u.kind === 'general')).toHaveLength(1)
    expect(s.units.find((u) => u.kind === 'general')!.baseAtk).toBeGreaterThan(before)
    expect(s.units.find((u) => u.kind === 'general')!.level).toBe(3) // 二階 + 一階
  })

  it('拖走其中一個字會解除武將，補上別的字可以改組成另一名武將', () => {
    const s = createGame()
    hand(s, 0, '張')
    hand(s, 1, '遼')
    placeFromHand(s, 0, cellIndex(s.board, 3, 1))
    placeFromHand(s, 1, cellIndex(s.board, 4, 1))
    expect(s.units.find((u) => u.kind === 'general')?.defKey).toBe('張遼')

    // 把「遼」拖到遠處 → 張遼解除
    const liao = glyphAt(s, cellIndex(s.board, 4, 1))!
    const moved = moveGlyph(s, liao.id, cellIndex(s.board, 7, 2))
    expect(moved.broken).toContain('張遼')
    expect(s.units.some((u) => u.kind === 'general')).toBe(false)

    // 補「飛」→ 張飛
    hand(s, 2, '飛')
    const res = placeFromHand(s, 2, cellIndex(s.board, 4, 1))
    expect(res.combined).toContain('張飛')
  })

  it('一個字可以同時參與橫向與縱向兩個武將（十字同時成兩將）', () => {
    const s = createGame()
    hand(s, 0, '遼')
    hand(s, 1, '飛')
    hand(s, 2, '張')
    placeFromHand(s, 0, cellIndex(s.board, 4, 1)) // 張的右邊
    placeFromHand(s, 1, cellIndex(s.board, 3, 2)) // 張的下方
    const res = placeFromHand(s, 2, cellIndex(s.board, 3, 1)) // 最後補上張

    expect(res.combined).toHaveLength(2)
    expect(res.combined).toContain('張遼')
    expect(res.combined).toContain('張飛')
    const zhang = glyphAt(s, cellIndex(s.board, 3, 1))!
    expect(zhang.formIds).toHaveLength(2)
  })

  it('鏟除共用的字會同時解除兩個武將', () => {
    const s = createGame()
    hand(s, 0, '遼')
    hand(s, 1, '飛')
    hand(s, 2, '張')
    placeFromHand(s, 0, cellIndex(s.board, 4, 1))
    placeFromHand(s, 1, cellIndex(s.board, 3, 2))
    placeFromHand(s, 2, cellIndex(s.board, 3, 1))

    const zhang = glyphAt(s, cellIndex(s.board, 3, 1))!
    const res = sellGlyph(s, zhang.id)
    expect(res.ok).toBe(true)
    expect(s.units.some((u) => u.kind === 'general')).toBe(false)
    expect(s.units).toHaveLength(2) // 只剩遼與飛
  })

  it('組成武將的字牌不再單獨攻擊（避免傷害重複計算）', () => {
    const s = createGame()
    hand(s, 0, '張')
    hand(s, 1, '飛')
    placeFromHand(s, 0, cellIndex(s.board, 0, 1))
    placeFromHand(s, 1, cellIndex(s.board, 1, 1))
    for (const g of s.units.filter((u) => u.kind === 'glyph')) {
      expect(g.formIds.length).toBeGreaterThan(0)
    }
  })
})

describe('移動：無法疊合時交換位置', () => {
  it('把字牌拖到已有「不同字」的格子 → 兩者交換位置，移動一定成立', () => {
    const s = createGame()
    const a = cellIndex(s.board, 0, 1)
    const b = cellIndex(s.board, 1, 1)
    hand(s, 0, '刀')
    hand(s, 1, '弓')
    placeFromHand(s, 0, a)
    placeFromHand(s, 1, b)
    const dao = glyphAt(s, a)!

    const res = moveGlyph(s, dao.id, b)
    expect(res.ok).toBe(true)
    expect(glyphAt(s, b)!.chars[0]).toBe('刀')
    expect(glyphAt(s, a)!.chars[0]).toBe('弓')
    expect(s.units.filter((u) => u.kind === 'glyph')).toHaveLength(2)
  })

  it('同字但品質不同也交換（不會疊合），格子仍各有一枚', () => {
    const s = createGame()
    const a = cellIndex(s.board, 0, 1)
    const b = cellIndex(s.board, 1, 1)
    hand(s, 0, '刀', 1)
    hand(s, 1, '刀', 2)
    placeFromHand(s, 0, a)
    placeFromHand(s, 1, b)
    const lv1 = glyphAt(s, a)!

    moveGlyph(s, lv1.id, b)
    expect(glyphAt(s, b)!.level).toBe(1)
    expect(glyphAt(s, a)!.level).toBe(2)
  })

  it('交換位置會在兩端重新判定組詞（可因此成將）', () => {
    const s = createGame()
    const zhang = cellIndex(s.board, 0, 1)
    const feiL = cellIndex(s.board, 1, 1) // 張右邊，正確位置
    const other = cellIndex(s.board, 3, 1)
    hand(s, 0, '張')
    hand(s, 1, '刀') // 先擋在張的右邊
    hand(s, 2, '飛')
    placeFromHand(s, 0, zhang)
    placeFromHand(s, 1, feiL)
    placeFromHand(s, 2, other)
    expect(s.units.some((u) => u.kind === 'general')).toBe(false)

    // 把「飛」拖到被「刀」占住的張右邊 → 交換：飛到張右邊、刀到遠處 → 成張飛
    const fei = glyphAt(s, other)!
    const res = moveGlyph(s, fei.id, feiL)
    expect(res.combined).toContain('張飛')
  })
})

describe('場上提示（hintCells）', () => {
  it('手牌有同字同階 → 場上該字牌標記為可升級', () => {
    const s = createGame()
    const cell = cellIndex(s.board, 0, 1)
    hand(s, 0, '刀')
    hand(s, 1, '刀') // 留在手上
    placeFromHand(s, 0, cell)
    const hit = s.hintCells.find((h) => h.cell === cell)
    expect(hit?.kind).toBe('upgrade')
  })

  it('手牌有配方缺的字 → 場上成員字牌標記為可湊將', () => {
    const s = createGame()
    const cell = cellIndex(s.board, 0, 1)
    hand(s, 0, '張')
    hand(s, 1, '飛') // 留在手上，理論上可組張飛
    placeFromHand(s, 0, cell)
    expect(s.hints).toContain('張飛')
    const hit = s.hintCells.find((h) => h.cell === cell)
    expect(hit?.kind).toBe('combine')
  })
})

describe('經濟', () => {
  it('征兵扣糧並填滿手牌', () => {
    const s = createGame()
    s.food = 999
    const res = recruit(s)
    expect(res.ok).toBe(true)
    expect(s.hand.every((h) => h !== null)).toBe(true)
    expect(s.food).toBeLessThan(999)
  })

  it('糧不足無法征兵', () => {
    const s = createGame()
    s.food = 0
    expect(recruit(s).ok).toBe(false)
  })

  it('鏟除會退還糧', () => {
    const s = createGame()
    const cell = cellIndex(s.board, 0, 1)
    hand(s, 0, '戟')
    placeFromHand(s, 0, cell)
    const before = s.food
    sellGlyph(s, glyphAt(s, cell)!.id)
    expect(s.food).toBeGreaterThan(before)
    expect(s.units).toHaveLength(0)
  })
})
