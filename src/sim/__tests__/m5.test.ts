import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../core/rng'
import { EMPTY_META } from '../../core/save'
import { UPGRADES, buyUpgrade } from '../../data/upgrades'
import { cellIndex } from '../board'
import { placeFromHand, toggleWish } from '../actions'
import { WISH_BOOST, rollGlyph } from '../economy'
import { createGame, renownFor, type MetaProgress } from '../state'
import { stepGame } from '../step'
import type { GameState } from '../types'

function put(state: GameState, char: string, col: number, row: number, level = 1): void {
  state.hand[0] = { char, level }
  const res = placeFromHand(state, 0, cellIndex(state.board, col, row))
  if (!res.ok) throw new Error(`放置失敗：${char} → ${res.msg}`)
}

describe('心願單', () => {
  it('可以許願池內的字，重複點擊會取消', () => {
    const s = createGame('julu', 3)
    const ch = s.pool[0]
    expect(toggleWish(s, ch).ok).toBe(true)
    expect(s.wishes).toContain(ch)
    expect(toggleWish(s, ch).ok).toBe(true)
    expect(s.wishes).not.toContain(ch)
  })

  it('池外的字不能許願（許了也沒用，所以直接擋掉）', () => {
    const s = createGame('julu', 3)
    const outside = '刀弓矛劍槍戟弩斧兵步盾騎車火計風雷毒陣令糧田屯商劉關張趙馬黃呂曹孫周諸龐備羽飛雲布忠超蓋岱興操權瑜亮葛遼統'
      .split('')
      .find((c) => !s.pool.includes(c))!
    const res = toggleWish(s, outside)
    expect(res.ok).toBe(false)
    expect(res.msg).toContain('不在本局字池')
  })

  it('心願格滿了就不能再許', () => {
    const s = createGame('julu', 3)
    expect(s.wishSlots).toBe(1) // 預設 1 格
    toggleWish(s, s.pool[0])
    const res = toggleWish(s, s.pool[1])
    expect(res.ok).toBe(false)
    expect(res.msg).toContain('心願格已滿')
  })

  it('心願格數來自局外進度', () => {
    const meta: MetaProgress = { ...EMPTY_META, wishSlots: 3 }
    const s = createGame('julu', 3, meta)
    expect(s.wishSlots).toBe(3)
    toggleWish(s, s.pool[0])
    toggleWish(s, s.pool[1])
    expect(toggleWish(s, s.pool[2]).ok).toBe(true)
    expect(s.wishes).toHaveLength(3)
  })

  it('許願的字抽到機率明顯提高（且與熟悉度加權相乘）', () => {
    const s = createGame('julu', 9)
    const target = s.pool[0]
    const rng = mulberry32(5)
    let wished = 0
    let plain = 0
    for (let i = 0; i < 3000; i++) {
      if (rollGlyph(rng, 10, { pool: s.pool, wishes: [target] }).char === target) wished++
      if (rollGlyph(rng, 10, { pool: s.pool }).char === target) plain++
    }
    expect(WISH_BOOST).toBeGreaterThan(1)
    expect(wished).toBeGreaterThan(plain * 2)
  })
})

describe('事件佇列', () => {
  it('放置與合成會產生事件', () => {
    const s = createGame('julu', 1)
    put(s, '張', 0, 1)
    expect(s.events.some((e) => e.kind === 'place')).toBe(true)
    s.events.length = 0
    put(s, '飛', 1, 1)
    const combine = s.events.find((e) => e.kind === 'combine')
    expect(combine).toBeDefined()
    if (combine?.kind === 'combine') {
      expect(combine.name).toBe('張飛')
      expect(combine.tier).toBe('legendary')
      expect(combine.cells).toHaveLength(2)
    }
  })

  it('疊合與解除也會產生事件', () => {
    const s = createGame('julu', 1)
    put(s, '刀', 0, 1)
    s.events.length = 0
    put(s, '刀', 0, 1)
    expect(s.events.some((e) => e.kind === 'merge')).toBe(true)
  })

  it('戰鬥會產生攻擊與擊殺事件', () => {
    const s = createGame('huangjin', 2)
    put(s, '弩', 0, 1, 5)
    let sawAttack = false
    let sawKill = false
    for (let i = 0; i < 60 * 60 && !(sawAttack && sawKill); i++) {
      stepGame(s, 1 / 60)
      for (const e of s.events) {
        if (e.kind === 'attack') sawAttack = true
        if (e.kind === 'kill') sawKill = true
      }
      s.events.length = 0
    }
    expect(sawAttack).toBe(true)
    expect(sawKill).toBe(true)
  })

  it('佇列有上限，不會在無人 drain 時無限成長', () => {
    const s = createGame('huangjin', 2)
    put(s, '弩', 0, 1, 5)
    for (let i = 0; i < 60 * 120; i++) stepGame(s, 1 / 60)
    expect(s.events.length).toBeLessThanOrEqual(64)
  })
})

describe('局外養成', () => {
  it('聲望隨波次成長，通關另有獎勵', () => {
    expect(renownFor(10, 100, false)).toBeGreaterThan(renownFor(5, 100, false))
    expect(renownFor(10, 100, true)).toBeGreaterThan(renownFor(10, 100, false))
    expect(renownFor(1, 0, false)).toBeGreaterThanOrEqual(1)
  })

  it('聲望不足買不起，足夠就生效並扣款', () => {
    const meta: MetaProgress = { ...EMPTY_META }
    expect(buyUpgrade(meta, 'food').ok).toBe(false)
    meta.renown = 1000
    const res = buyUpgrade(meta, 'food')
    expect(res.ok).toBe(true)
    expect(meta.extraFood).toBe(6)
    expect(meta.renown).toBeLessThan(1000)
  })

  it('每個升級都有上限，買滿後拒絕', () => {
    const meta: MetaProgress = { ...EMPTY_META, renown: 99999 }
    for (const up of UPGRADES) {
      for (let i = 0; i < up.max; i++) expect(buyUpgrade(meta, up.key).ok).toBe(true)
      const res = buyUpgrade(meta, up.key)
      expect(res.ok).toBe(false)
      expect(res.msg).toContain('已達上限')
      expect(up.level(meta)).toBe(up.max)
    }
    // 買滿後的實際數值
    expect(meta.handSize).toBe(8)
    expect(meta.wishSlots).toBe(3)
    expect(meta.extraLives).toBe(2)
  })

  it('局外進度會影響開局狀態', () => {
    const rich: MetaProgress = { ...EMPTY_META, handSize: 8, extraFood: 24, extraLives: 2, wishSlots: 3 }
    const a = createGame('julu', 7, EMPTY_META)
    const b = createGame('julu', 7, rich)
    expect(b.handSize).toBe(8)
    expect(b.food).toBe(a.food + 24)
    expect(b.maxLives).toBe(a.maxLives + 2)
    expect(b.wishSlots).toBe(3)
  })
})
