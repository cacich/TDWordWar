import { describe, expect, it } from 'vitest'
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_KEY,
  GROUP_ORDER,
  TOTAL_ACHIEVE_RENOWN,
  claimAchievements,
  isUnlocked,
  unlockedCount,
} from '../../data/achievements'
import { GENERALS } from '../../data/generals'
import { GLYPHS } from '../../data/glyphs'
import { LEVEL_ORDER } from '../../data/levels'
import { cellIndex } from '../board'
import { DEFAULT_META, EMPTY_TOTALS, createGame, makeGlyphUnit, type MetaProgress } from '../state'
import type { GameState } from '../types'

function meta(overrides: Partial<MetaProgress> = {}): MetaProgress {
  return {
    ...DEFAULT_META,
    renown: 0,
    cleared: [],
    seenGlyphs: [],
    seenGenerals: [],
    best: {},
    achievements: {},
    totals: { ...EMPTY_TOTALS },
    ...overrides,
  }
}

/** 一局剛開始的乾淨狀態，測 scope:'run' 的成就用 */
function run(overrides: Partial<GameState> = {}): GameState {
  return Object.assign(createGame('julu', 1), overrides)
}

describe('成就資料表完整性', () => {
  it('key 不重複，且 ACHIEVEMENT_BY_KEY 收得齊', () => {
    const keys = ACHIEVEMENTS.map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(Object.keys(ACHIEVEMENT_BY_KEY).length).toBe(ACHIEVEMENTS.length)
  })

  it('每個成就的 goal 都是正整數、獎勵都是正數', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.goal, a.key).toBeGreaterThan(0)
      expect(Number.isInteger(a.goal), a.key).toBe(true)
      expect(a.renown, a.key).toBeGreaterThan(0)
    }
  })

  it('每個成就的 group 都在 GROUP_ORDER 裡（否則 UI 會整項漏畫）', () => {
    for (const a of ACHIEVEMENTS) expect(GROUP_ORDER, a.key).toContain(a.group)
  })

  it('名稱與描述都不是空字串', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length, a.key).toBeGreaterThan(0)
      expect(a.desc.length, a.key).toBeGreaterThan(0)
    }
  })

  it('TOTAL_ACHIEVE_RENOWN 等於逐項相加', () => {
    expect(TOTAL_ACHIEVE_RENOWN).toBe(ACHIEVEMENTS.reduce((n, a) => n + a.renown, 0))
  })

  /**
   * 平衡守護：成就總獎勵要落在「兵書買滿 1230」與「商城買滿 13590」之間。
   * 太低就沒有吸引力，太高會讓商城這個長期目標失去意義。
   */
  it('成就總獎勵介於兵書總價與商城總價之間', () => {
    expect(TOTAL_ACHIEVE_RENOWN).toBeGreaterThan(1230)
    expect(TOTAL_ACHIEVE_RENOWN).toBeLessThan(13590 / 3)
  })

  it('全收集類的 goal 跟著資料表走，不是寫死的數字', () => {
    expect(ACHIEVEMENT_BY_KEY['glyphsAll'].goal).toBe(GLYPHS.length)
    expect(ACHIEVEMENT_BY_KEY['generalsAll'].goal).toBe(GENERALS.length)
    expect(ACHIEVEMENT_BY_KEY['clearAll'].goal).toBe(LEVEL_ORDER.length)
  })
})

describe('進度函式', () => {
  it('scope:"run" 的成就在沒有局內狀態時一律 0（選單畫面不會誤判）', () => {
    const m = meta()
    for (const a of ACHIEVEMENTS) {
      if (a.scope !== 'run') continue
      expect(a.progress(null, m), a.key).toBe(0)
    }
  })

  it('全新存檔的每個成就進度都還沒達標', () => {
    const m = meta()
    const s = run()
    for (const a of ACHIEVEMENTS) expect(a.progress(s, m), a.key).toBeLessThan(a.goal)
  })

  it('進度永遠不是 NaN／負數', () => {
    const m = meta({ seenGlyphs: ['刀'], best: { julu: 7 } })
    const s = run()
    for (const a of ACHIEVEMENTS) {
      const v = a.progress(s, m)
      expect(Number.isFinite(v), a.key).toBe(true)
      expect(v, a.key).toBeGreaterThanOrEqual(0)
    }
  })

  it('五階登峰讀場上字牌的最高階（沒有字牌時是 0，不是 -Infinity）', () => {
    const def = ACHIEVEMENT_BY_KEY['tier5']
    const s = run()
    expect(s.units).toHaveLength(0)
    expect(def.progress(s, meta())).toBe(0)
    // 只需要 kind／level 兩個欄位，其餘用 makeGlyphUnit 的真實產物填
    const u = makeGlyphUnit(s, '刀', 3, cellIndex(s.board, 0, 0))
    s.units.push(u)
    expect(def.progress(s, meta())).toBe(3)
  })

  it('bestWave 取全部關卡的最大值', () => {
    const def = ACHIEVEMENT_BY_KEY['wave30']
    expect(def.progress(null, meta({ best: {} }))).toBe(0)
    expect(def.progress(null, meta({ best: { julu: 12, luoyang: 31 } }))).toBe(31)
  })
})

describe('claimAchievements', () => {
  it('達標才解鎖，並把聲望加進 meta', () => {
    const m = meta({ cleared: ['huangjin'] })
    const got = claimAchievements(m, null)
    expect(got.map((a) => a.key)).toContain('firstClear')
    expect(isUnlocked(m, 'firstClear')).toBe(true)
    expect(m.renown).toBe(ACHIEVEMENT_BY_KEY['firstClear'].renown)
  })

  it('同一個成就只發一次獎勵（重複呼叫不重複給）', () => {
    const m = meta({ cleared: ['huangjin'] })
    claimAchievements(m, null)
    const renownAfterFirst = m.renown
    const second = claimAchievements(m, null)
    expect(second).toHaveLength(0)
    expect(m.renown).toBe(renownAfterFirst)
  })

  it('解鎖序號從 1 起算且逐一遞增', () => {
    const m = meta({ cleared: ['huangjin'] })
    claimAchievements(m, null)
    expect(m.achievements['firstClear']).toBe(1)
    m.seenGlyphs = GLYPHS.map((g) => g.char)
    const got = claimAchievements(m, null)
    const seqs = got.map((a) => m.achievements[a.key]).sort((x, y) => x - y)
    expect(seqs[0]).toBe(2)
    expect(seqs).toEqual(seqs.map((_, i) => i + 2))
  })

  it('沒有任何條件達成時不動 meta', () => {
    const m = meta()
    expect(claimAchievements(m, null)).toHaveLength(0)
    expect(m.renown).toBe(0)
    expect(Object.keys(m.achievements)).toHaveLength(0)
  })

  it('一次呼叫可以同時解鎖多個（全字收集會連帶解開 30 字那一個）', () => {
    const m = meta({ seenGlyphs: GLYPHS.map((g) => g.char) })
    const keys = claimAchievements(m, null).map((a) => a.key)
    expect(keys).toContain('glyphs30')
    expect(keys).toContain('glyphsAll')
    expect(m.renown).toBe(ACHIEVEMENT_BY_KEY['glyphs30'].renown + ACHIEVEMENT_BY_KEY['glyphsAll'].renown)
  })

  it('通關全部關卡會解開天下歸心', () => {
    const m = meta({ cleared: [...LEVEL_ORDER] })
    const keys = claimAchievements(m, null).map((a) => a.key)
    expect(keys).toContain('clearAll')
    expect(keys).toContain('firstClear')
  })

  it('unlockedCount 與實際解鎖數一致', () => {
    const m = meta({ cleared: ['huangjin'], totals: { ...EMPTY_TOTALS, runs: 60 } })
    const got = claimAchievements(m, null)
    expect(unlockedCount(m)).toBe(got.length)
  })
})

describe('通關類成就的判定時機', () => {
  it('滴水不漏要「通關」而不只是零漏怪', () => {
    const def = ACHIEVEMENT_BY_KEY['noLeak']
    const s = run()
    expect(s.stats.leaks).toBe(0)
    expect(def.progress(s, meta())).toBe(0) // 還在打，不算
    s.phase = 'won'
    expect(def.progress(s, meta())).toBe(1)
    s.stats.leaks = 1
    expect(def.progress(s, meta())).toBe(0)
  })

  it('毫髮無傷看 lives 是否等於 maxLives', () => {
    const def = ACHIEVEMENT_BY_KEY['flawless']
    const s = run({ phase: 'won' })
    expect(def.progress(s, meta())).toBe(1)
    s.lives -= 1
    expect(def.progress(s, meta())).toBe(0)
  })

  it('力挽狂瀾只在剩 1 命時成立', () => {
    const def = ACHIEVEMENT_BY_KEY['lastStand']
    const s = run({ phase: 'won' })
    s.lives = 2
    expect(def.progress(s, meta())).toBe(0)
    s.lives = 1
    expect(def.progress(s, meta())).toBe(1)
  })

  it('戰敗不會解開任何通關類成就', () => {
    const s = run({ phase: 'lost' })
    const m = meta()
    for (const key of ['noLeak', 'flawless', 'lastStand']) {
      expect(ACHIEVEMENT_BY_KEY[key].progress(s, m), key).toBe(0)
    }
  })
})
