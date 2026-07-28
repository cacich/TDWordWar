import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../core/rng'
import { GENERALS } from '../../data/generals'
import { GLYPHS, GLYPH_BY_CHAR } from '../../data/glyphs'
import { LEVELS, LEVEL_ORDER } from '../../data/levels'
import { FAMILIAR_BOOST, rollGlyph } from '../economy'
import { buildGlyphPool } from '../pool'
import { createGame } from '../state'

describe('每局字池', () => {
  it('兵器與兵種字永遠在池內（它們是骨幹）', () => {
    const pool = buildGlyphPool(mulberry32(7), LEVELS.huangjin)
    for (const g of GLYPHS) {
      if (g.category === 'weapon' || g.category === 'troop') {
        expect(pool.chars, `${g.char} 應該永遠在池內`).toContain(g.char)
      }
    }
  })

  it('池內不會有「湊不成任何配方」的孤兒姓名字', () => {
    for (const key of LEVEL_ORDER) {
      for (let seed = 1; seed <= 30; seed++) {
        const pool = buildGlyphPool(mulberry32(seed * 131), LEVELS[key])
        const chars = new Set(pool.chars)
        for (const ch of pool.chars) {
          const cat = GLYPH_BY_CHAR[ch].category
          if (cat !== 'surname' && cat !== 'given') continue
          const usable = GENERALS.some(
            (g) => g.recipe.includes(ch) && g.recipe.every((c) => chars.has(c)),
          )
          expect(usable, `${key}#${seed} 的「${ch}」湊不成任何配方`).toBe(true)
        }
      }
    }
  })

  it('池子明顯小於全字表，但仍能湊出多個武將', () => {
    const pool = buildGlyphPool(mulberry32(99), LEVELS.julu)
    expect(pool.chars.length).toBeLessThan(GLYPHS.length * 0.75)
    expect(pool.generals.length).toBeGreaterThanOrEqual(6)
  })

  it('後期關卡的池子比教學關大', () => {
    const easy = buildGlyphPool(mulberry32(5), LEVELS.huangjin)
    const hard = buildGlyphPool(mulberry32(5), LEVELS.wuzhang)
    expect(hard.chars.length).toBeGreaterThan(easy.chars.length)
  })

  it('同一顆種子產生同一個池子', () => {
    expect(buildGlyphPool(mulberry32(42), LEVELS.chibi)).toEqual(
      buildGlyphPool(mulberry32(42), LEVELS.chibi),
    )
  })
})

describe('抽卡收斂', () => {
  it('征兵只會抽到池內的字', () => {
    const s = createGame('guandu', 4)
    const pool = new Set(s.pool)
    const rng = mulberry32(1)
    for (let i = 0; i < 400; i++) {
      expect(pool.has(rollGlyph(rng, 10, { pool: s.pool }).char)).toBe(true)
    }
  })

  it('已擁有的字被抽到的機率明顯提高', () => {
    const s = createGame('julu', 8)
    const target = s.pool[0]
    const familiar = new Set([target])
    const rng = mulberry32(3)
    let withBoost = 0
    let without = 0
    for (let i = 0; i < 3000; i++) {
      if (rollGlyph(rng, 10, { pool: s.pool, familiar }).char === target) withBoost++
      if (rollGlyph(rng, 10, { pool: s.pool }).char === target) without++
    }
    expect(FAMILIAR_BOOST).toBeGreaterThan(1)
    expect(withBoost).toBeGreaterThan(without * 1.5)
  })

  it('開局就知道本局能湊出哪些武將', () => {
    const s = createGame('guandu', 11)
    expect(s.poolGenerals.length).toBeGreaterThan(3)
    // 池子裡的每個武將，配方用到的字都在池內
    for (const name of s.poolGenerals) {
      const def = GENERALS.find((g) => g.name === name)!
      for (const ch of def.recipe) expect(s.pool).toContain(ch)
    }
  })
})
