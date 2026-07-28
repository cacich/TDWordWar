import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../core/rng'
import { parseMap } from '../board'
import { mitigate } from '../combat'
import { rarityWeights, recruitCost } from '../economy'
import { JULU, LEVELS, LEVEL_ORDER } from '../../data/levels'
import { GENERALS } from '../../data/generals'
import { GLYPH_BY_CHAR } from '../../data/glyphs'
import { BONDS } from '../../data/bonds'
import { COMBOS, SKILLS } from '../skills'
import { buildWave, enemyBaseHp } from '../waves'
import { createGame } from '../state'
import { stepGame } from '../step'

describe('棋盤', () => {
  it('巨鹿地圖可解析且路徑連通', () => {
    const b = parseMap(JULU.map!, JULU.key)
    expect(b.cols).toBe(9)
    expect(b.rows).toBe(14)
    expect(b.path[0]).toBe(b.spawn)
    expect(b.path[b.path.length - 1]).toBe(b.camp)
    expect(b.path.length).toBeGreaterThan(40)
  })

  it('所有固定地圖都合法且連通', () => {
    for (const key of LEVEL_ORDER) {
      const level = LEVELS[key]
      if (!level.map) continue
      const b = parseMap(level.map, key)
      expect(b.path[0], `${key} 路徑起點應為出兵口`).toBe(b.spawn)
      expect(b.path[b.path.length - 1], `${key} 路徑終點應為大營`).toBe(b.camp)
    }
  })

  it('LEVEL_ORDER 的每一關都存在，且非固定地圖必有 gen', () => {
    for (const key of LEVEL_ORDER) {
      const level = LEVELS[key]
      expect(level, `LEVEL_ORDER 有 ${key} 但 LEVELS 沒有`).toBeDefined()
      expect(Boolean(level.map) || Boolean(level.gen), `${key} 既沒有 map 也沒有 gen`).toBe(true)
    }
  })
})

describe('資料表完整性', () => {
  it('所有配方用到的字都存在於字表', () => {
    for (const g of GENERALS) {
      for (const ch of g.recipe) {
        expect(GLYPH_BY_CHAR[ch], `配方「${g.name}」用到未定義的字「${ch}」`).toBeDefined()
      }
    }
  })

  it('配方鍵值不重複', () => {
    const keys = GENERALS.map((g) => g.recipe.join(''))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('SKILLS 的每個鍵都對應一名武將（避免打錯字導致技能永遠不觸發）', () => {
    const names = new Set(GENERALS.map((g) => g.name))
    for (const key of Object.keys(SKILLS)) {
      expect(names.has(key), `SKILLS 有「${key}」但配方表沒有這名武將`).toBe(true)
    }
  })

  it('有實作的技能必須也在 GeneralDef 宣告 skill，否則冷卻上限會是 0', () => {
    for (const key of Object.keys(SKILLS)) {
      const def = GENERALS.find((g) => g.name === key)
      expect(def?.skill, `「${key}」有實作但沒宣告 skill`).toBeDefined()
    }
  })

  it('COMBOS 的每個鍵都對應一個有 comboSkill 的羈絆', () => {
    for (const key of Object.keys(COMBOS)) {
      const bond = BONDS.find((b) => b.name === key)
      expect(bond?.comboSkill, `COMBOS 有「${key}」但羈絆表沒有對應的 comboSkill`).toBeDefined()
    }
  })
})

describe('數值公式', () => {
  it('防禦減免遞減但傷害不歸零', () => {
    expect(mitigate(100, 0)).toBe(100)
    expect(mitigate(100, 60)).toBeCloseTo(50, 5)
    expect(mitigate(100, 6000)).toBeGreaterThanOrEqual(1)
  })

  it('征兵成本隨波次與本波次數上升', () => {
    const s = createGame()
    const base = recruitCost(s)
    s.recruitsThisWave = 2
    expect(recruitCost(s)).toBe(base + 4)
    s.recruitsThisWave = 0
    s.wave = 10
    expect(recruitCost(s)).toBeGreaterThan(base)
  })

  it('稀有度權重總和為 100', () => {
    for (const w of [1, 8, 15, 30]) {
      expect(rarityWeights(w).reduce((a, b) => a + b, 0)).toBe(100)
    }
  })

  it('敵人血量隨波次指數成長', () => {
    expect(enemyBaseHp(10)).toBeGreaterThan(enemyBaseHp(5) * 2)
  })
})

describe('確定性', () => {
  it('同一顆種子產出相同的波次內容', () => {
    const a = buildWave(7, mulberry32(42))
    const b = buildWave(7, mulberry32(42))
    expect(a).toEqual(b)
  })
})

describe('模擬推進', () => {
  it('空手不放任何單位，最終大營陷落', () => {
    const s = createGame('julu', 1)
    for (let i = 0; i < 60 * 600 && s.phase !== 'lost'; i++) stepGame(s, 1 / 60)
    expect(s.phase).toBe('lost')
    expect(s.stats.leaks).toBeGreaterThan(0)
  })

  it('佈陣階段結束會自動開戰並生成敵人', () => {
    const s = createGame('julu', 1)
    expect(s.phase).toBe('prep')
    for (let i = 0; i < 60 * 13; i++) stepGame(s, 1 / 60)
    expect(s.phase).toBe('battle')
    expect(s.enemies.length).toBeGreaterThan(0)
  })
})
