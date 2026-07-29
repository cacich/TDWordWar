import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../core/rng'
import { BONDS } from '../../data/bonds'
import { isGeneralUnlocked, isLoadoutableGlyph, setLoadoutActive, toggleLoadoutGeneral, toggleLoadoutGlyph } from '../../data/loadout'
import { GENERALS } from '../../data/generals'
import { GLYPHS } from '../../data/glyphs'
import { LEVELS } from '../../data/levels'
import { buildGlyphPool } from '../pool'
import { createGame, DEFAULT_META, MAX_LOADOUT_GENERALS, MAX_LOADOUT_GLYPHS, type MetaProgress } from '../state'

function meta(overrides: Partial<MetaProgress> = {}): MetaProgress {
  return {
    ...DEFAULT_META,
    seenGlyphs: [],
    seenGenerals: [],
    loadoutActive: false,
    loadoutGlyphs: [],
    loadoutGenerals: [],
    ...overrides,
  }
}

describe('編隊上限與羈絆門檻的相容性', () => {
  /**
   * 迴歸守護：姓名字無法選進 loadoutGlyphs，只能靠 loadoutGenerals 帶入，
   * 所以「只由姓名配方武將滿足」的羈絆門檻不能超過 MAX_LOADOUT_GENERALS，
   * 否則該羈絆在啟用編隊時永遠湊不齊（蜀漢棟樑曾經是 6，就踩到這個坑）。
   * 「部隊」武將不受限——它們的配方是兵器／兵種字，可直接選進 loadoutGlyphs。
   */
  it('每個羈絆的門檻在啟用編隊時都達成得到', () => {
    for (const b of BONDS) {
      if (b.requireGenerals) {
        expect(
          b.requireGenerals.length,
          `羈絆「${b.name}」需要 ${b.requireGenerals.length} 名指定武將，超過編隊上限 ${MAX_LOADOUT_GENERALS}`,
        ).toBeLessThanOrEqual(MAX_LOADOUT_GENERALS)
        continue
      }
      if (!b.requireTag) continue
      const matching = GENERALS.filter((g) => g.tags.includes(b.requireTag!.tag))
      // 能靠「攜帶的字」湊出來的（部隊系）不吃武將欄位上限
      const viaGlyphs = matching.filter((g) => g.recipe.every((ch) => isLoadoutableGlyph(ch)))
      if (viaGlyphs.length >= b.requireTag.count) continue
      expect(
        b.requireTag.count,
        `羈絆「${b.name}」需要 ${b.requireTag.count} 名「${b.requireTag.tag}」武將，` +
          `但符合的武將只能透過編隊武將欄位帶入（上限 ${MAX_LOADOUT_GENERALS}）`,
      ).toBeLessThanOrEqual(MAX_LOADOUT_GENERALS)
    }
  })
})

describe('編隊：切換字／武將', () => {
  it('未解鎖的字無法加入編隊', () => {
    const m = meta()
    const res = toggleLoadoutGlyph(m, '刀')
    expect(res.ok).toBe(false)
    expect(m.loadoutGlyphs).not.toContain('刀')
  })

  it('已解鎖的字可以加入，再點一次會移除', () => {
    const m = meta({ seenGlyphs: ['刀'] })
    expect(toggleLoadoutGlyph(m, '刀').ok).toBe(true)
    expect(m.loadoutGlyphs).toEqual(['刀'])
    expect(toggleLoadoutGlyph(m, '刀').ok).toBe(true)
    expect(m.loadoutGlyphs).toEqual([])
  })

  it(`最多只能選 ${MAX_LOADOUT_GLYPHS} 個字`, () => {
    const chars = GLYPHS.slice(0, MAX_LOADOUT_GLYPHS + 1).map((g) => g.char)
    const m = meta({ seenGlyphs: chars })
    for (const ch of chars.slice(0, MAX_LOADOUT_GLYPHS)) {
      expect(toggleLoadoutGlyph(m, ch).ok).toBe(true)
    }
    const res = toggleLoadoutGlyph(m, chars[MAX_LOADOUT_GLYPHS])
    expect(res.ok).toBe(false)
    expect(m.loadoutGlyphs.length).toBe(MAX_LOADOUT_GLYPHS)
  })

  it('未解鎖的武將無法加入編隊', () => {
    const m = meta()
    expect(toggleLoadoutGeneral(m, '張飛').ok).toBe(false)
    expect(m.loadoutGenerals).not.toContain('張飛')
  })

  it(`已解鎖的武將可切換，最多選 ${MAX_LOADOUT_GENERALS} 名`, () => {
    const names = GENERALS.slice(0, MAX_LOADOUT_GENERALS + 1).map((g) => g.name)
    const m = meta({ seenGenerals: names })
    for (const n of names.slice(0, MAX_LOADOUT_GENERALS)) {
      expect(toggleLoadoutGeneral(m, n).ok).toBe(true)
    }
    const res = toggleLoadoutGeneral(m, names[MAX_LOADOUT_GENERALS])
    expect(res.ok).toBe(false)
    expect(m.loadoutGenerals.length).toBe(MAX_LOADOUT_GENERALS)
  })

  it('setLoadoutActive 切換啟用狀態', () => {
    const m = meta()
    setLoadoutActive(m, true)
    expect(m.loadoutActive).toBe(true)
    setLoadoutActive(m, false)
    expect(m.loadoutActive).toBe(false)
  })

  it('姓氏／名字字不能直接選進「攜帶的字」——只能透過武將帶入', () => {
    const surname = GLYPHS.find((g) => g.category === 'surname')!.char
    const given = GLYPHS.find((g) => g.category === 'given')!.char
    expect(isLoadoutableGlyph(surname)).toBe(false)
    expect(isLoadoutableGlyph(given)).toBe(false)
    const m = meta({ seenGlyphs: [surname, given] })
    expect(toggleLoadoutGlyph(m, surname).ok).toBe(false)
    expect(toggleLoadoutGlyph(m, given).ok).toBe(false)
    expect(m.loadoutGlyphs).toEqual([])
  })

  it('兵器／兵種／謀略／經濟字仍可直接選進「攜帶的字」', () => {
    const weapon = GLYPHS.find((g) => g.category === 'weapon')!.char
    expect(isLoadoutableGlyph(weapon)).toBe(true)
  })

  it('武將配方的字都解鎖過就算解鎖，不必真的湊出來過', () => {
    const gen = GENERALS.find((g) => g.name === '黃蓋')! // 配方 ['黃', '蓋']
    expect(isGeneralUnlocked([], [], gen.name)).toBe(false)
    expect(isGeneralUnlocked(gen.recipe, [], gen.name)).toBe(true)
    expect(isGeneralUnlocked([], [gen.name], gen.name)).toBe(true)

    const m = meta({ seenGlyphs: [...gen.recipe] }) // 沒有實際組成過，只解鎖了配方字
    expect(toggleLoadoutGeneral(m, gen.name).ok).toBe(true)
    expect(m.loadoutGenerals).toContain(gen.name)
  })
})

describe('編隊字池：buildGlyphPool 帶 loadout 參數', () => {
  it('已解鎖但沒選進編隊的字會被排除', () => {
    const pool = buildGlyphPool(mulberry32(1), LEVELS.julu, {
      glyphs: ['刀'],
      generals: [],
      seenGlyphs: ['刀', '弓', '兵'], // 弓、兵已解鎖但沒選 → 應該被排除
    })
    expect(pool.chars).toContain('刀')
    expect(pool.chars).not.toContain('弓')
    expect(pool.chars).not.toContain('兵')
  })

  it('還沒解鎖過的字不受編隊限制，繼續留在池內', () => {
    const seen = ['刀'] // 只解鎖了刀，其餘的字都還沒解鎖
    const pool = buildGlyphPool(mulberry32(1), LEVELS.julu, { glyphs: ['刀'], generals: [], seenGlyphs: seen })
    for (const g of GLYPHS) {
      if (!seen.includes(g.char)) expect(pool.chars).toContain(g.char)
    }
  })

  it('選進編隊的武將，其配方字會一起被加進池子（其餘已解鎖字仍被排除）', () => {
    const gen = GENERALS.find((g) => g.name === '黃蓋')! // 配方 ['黃', '蓋']
    const seen = GLYPHS.map((g) => g.char) // 全部解鎖，逼近「已解鎖但沒選會被排除」的情境
    const pool = buildGlyphPool(mulberry32(1), LEVELS.julu, {
      glyphs: [],
      generals: [gen.name],
      seenGlyphs: seen,
    })
    for (const ch of gen.recipe) expect(pool.chars).toContain(ch)
    const other = GLYPHS.find((g) => !gen.recipe.includes(g.char))!.char
    expect(pool.chars).not.toContain(other)
  })

  it('防呆：0 字 0 武將且全部解鎖時，退回骨幹字，不會開出空池', () => {
    const seen = GLYPHS.map((g) => g.char) // 全部解鎖
    const pool = buildGlyphPool(mulberry32(1), LEVELS.julu, { glyphs: [], generals: [], seenGlyphs: seen })
    expect(pool.chars.length).toBeGreaterThan(0)
  })

  it('createGame 依 meta.loadoutActive 決定要不要套用編隊', () => {
    const active = meta({
      seenGlyphs: ['刀', '弓'],
      loadoutActive: true,
      loadoutGlyphs: ['刀'],
      loadoutGenerals: [],
    })
    const s = createGame('julu', 1, active)
    expect(s.pool).toContain('刀')
    expect(s.pool).not.toContain('弓')

    const inactive = meta({ seenGlyphs: ['刀', '弓'], loadoutActive: false, loadoutGlyphs: ['刀'] })
    const s2 = createGame('julu', 1, inactive)
    // 沒啟用時，loadoutGlyphs 完全不影響字池，走原本的隨機抽樣
    expect(s2.pool.length).toBeGreaterThan(1)
  })
})
