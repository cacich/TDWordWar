import { describe, expect, it } from 'vitest'
import { cellIndex } from '../board'
import { mergeHand, placeFromHand, rerollHand } from '../actions'
import { COUNTER_BONUS, COUNTER_PENALTY, counterMul, dealDamage, troopFromTags } from '../combat'
import { createGame, recalcUnits, glyphAt } from '../state'
import { stepSkills } from '../skills'
import { stepGame } from '../step'
import type { Enemy, GameState, Troop } from '../types'

function put(state: GameState, char: string, col: number, row: number, level = 1): void {
  state.hand[0] = { char, level }
  placeFromHand(state, 0, cellIndex(state.board, col, row))
}

/** 造一個測試用敵人放在路徑起點 */
function spawnEnemy(state: GameState, over: Partial<Enemy> = {}): Enemy {
  const e: Enemy = {
    id: state.nextEnemyId++,
    defKey: 'thief',
    char: '賊',
    hp: 10000,
    maxHp: 10000,
    def: 0,
    speed: 1,
    flying: false,
    bounty: 2,
    damage: 1,
    troop: '步',
    ccImmune: false,
    burnImmune: false,
    slowImmune: false,
    dist: 5,
    hitFlash: 0,
    slow: 0,
    stun: 0,
    vuln: 0,
    burnT: 0,
    burnDps: 0,
    ...over,
  }
  state.enemies.push(e)
  state.phase = 'battle'
  return e
}

describe('品質階級（疊合升階）', () => {
  it('手牌之間可疊合，同字同階 → 升一階', () => {
    const s = createGame()
    s.hand[0] = { char: '火', level: 1 }
    s.hand[1] = { char: '火', level: 1 }
    const res = mergeHand(s, 0, 1)
    expect(res.ok).toBe(true)
    expect(s.hand[0]).toBeNull()
    expect(s.hand[1]).toEqual({ char: '火', level: 2 })
  })

  it('品質不同不可疊合', () => {
    const s = createGame()
    s.hand[0] = { char: '火', level: 1 }
    s.hand[1] = { char: '火', level: 2 }
    expect(mergeHand(s, 0, 1).ok).toBe(false)
  })

  it('二階字的攻擊力是一階的 1.55 倍', () => {
    const a = createGame()
    put(a, '刀', 0, 1, 1)
    const b = createGame()
    put(b, '刀', 0, 1, 2)
    const lo = glyphAt(a, cellIndex(a.board, 0, 1))!.baseAtk
    const hi = glyphAt(b, cellIndex(b.board, 0, 1))!.baseAtk
    expect(hi / lo).toBeCloseTo(1.55, 5)
  })

  it('光環強度隨品質提升', () => {
    const a = createGame()
    put(a, '陣', 0, 1, 1)
    const b = createGame()
    put(b, '陣', 0, 1, 3)
    const lo = glyphAt(a, cellIndex(a.board, 0, 1))!.aura!.atkMul!
    const hi = glyphAt(b, cellIndex(b.board, 0, 1))!.aura!.atkMul!
    expect(hi).toBeGreaterThan(lo)
  })
})

describe('兵種相剋', () => {
  it('騎剋弓、弓剋步、步剋騎', () => {
    expect(counterMul('騎', '弓')).toBe(COUNTER_BONUS)
    expect(counterMul('弓', '步')).toBe(COUNTER_BONUS)
    expect(counterMul('步', '騎')).toBe(COUNTER_BONUS)
    expect(counterMul('弓', '騎')).toBe(COUNTER_PENALTY)
    expect(counterMul('騎', '騎')).toBe(1)
    expect(counterMul('none' as Troop, '步')).toBe(1)
  })

  it('由 tags 推導兵種', () => {
    expect(troopFromTags(['兵種', '騎'])).toBe('騎')
    expect(troopFromTags(['兵器', '遠程', '弓'])).toBe('弓')
    expect(troopFromTags(['謀略'])).toBe('none')
  })

  it('被剋制的一方傷害較低', () => {
    const s = createGame()
    put(s, '弓', 0, 1) // 弓兵剋步、被騎剋
    const u = glyphAt(s, cellIndex(s.board, 0, 1))!
    const foot = spawnEnemy(s, { troop: '步' })
    const horse = spawnEnemy(s, { troop: '騎' })
    dealDamage(s, u, foot, 100)
    dealDamage(s, u, horse, 100)
    expect(10000 - foot.hp).toBeGreaterThan(10000 - horse.hp)
  })
})

describe('控場狀態', () => {
  it('灼燒會持續扣血並在死亡時給糧', () => {
    const s = createGame()
    put(s, '火', 0, 1)
    const e = spawnEnemy(s, { hp: 30, maxHp: 30 })
    e.burnT = 5
    e.burnDps = 20
    const before = s.food
    for (let i = 0; i < 120; i++) stepGame(s, 1 / 60)
    expect(s.stats.kills).toBeGreaterThan(0)
    expect(s.food).toBeGreaterThan(before)
  })

  it('定身期間不前進', () => {
    const s = createGame()
    const e = spawnEnemy(s, { stun: 1 })
    const d0 = e.dist
    for (let i = 0; i < 30; i++) stepGame(s, 1 / 60)
    expect(e.dist).toBeCloseTo(d0, 5)
  })

  it('擊退會讓敵人後退，但 BOSS 免疫', () => {
    const s = createGame()
    put(s, '風', 0, 1)
    const u = glyphAt(s, cellIndex(s.board, 0, 1))!
    const normal = spawnEnemy(s, { dist: 5 })
    const boss = spawnEnemy(s, { dist: 5, ccImmune: true })
    dealDamage(s, u, normal, 1)
    dealDamage(s, u, boss, 1)
    expect(normal.dist).toBeLessThan(5)
    expect(boss.dist).toBe(5)
  })

  it('易傷讓後續傷害提高', () => {
    const s = createGame()
    put(s, '刀', 0, 1)
    const u = glyphAt(s, cellIndex(s.board, 0, 1))!
    const plain = spawnEnemy(s)
    const weak = spawnEnemy(s, { vuln: 3 })
    dealDamage(s, u, plain, 100)
    dealDamage(s, u, weak, 100)
    expect(10000 - weak.hp).toBeGreaterThan(10000 - plain.hp)
  })
})

describe('光環', () => {
  it('「陣」提升半徑內友軍攻擊，超出半徑則無效', () => {
    const s = createGame()
    put(s, '刀', 0, 1)
    put(s, '刀', 7, 2)
    const near = glyphAt(s, cellIndex(s.board, 0, 1))!
    const far = glyphAt(s, cellIndex(s.board, 7, 2))!
    const before = near.atk
    put(s, '陣', 1, 1)
    recalcUnits(s)
    expect(near.atk).toBeGreaterThan(before)
    expect(far.atk).toBeCloseTo(far.baseAtk, 5)
  })
})

describe('主動技', () => {
  it('黃忠〈百步穿楊〉會狙擊血量最高的敵人', () => {
    const s = createGame()
    put(s, '黃', 0, 1)
    put(s, '忠', 1, 1)
    const u = s.units.find((x) => x.kind === 'general')!
    expect(u.defKey).toBe('黃忠')
    expect(u.skillCdMax).toBeGreaterThan(0)

    const weak = spawnEnemy(s, { hp: 500, maxHp: 500 })
    const strong = spawnEnemy(s, { hp: 9000, maxHp: 9000 })
    u.skillCd = 0
    stepSkills(s, 1 / 60)
    expect(9000 - strong.hp).toBeGreaterThan(0)
    expect(weak.hp).toBe(500)
    expect(u.skillCd).toBeGreaterThan(0) // 施放後進入冷卻
  })

  it('沒有敵人時不會白放技能（冷卻不重設）', () => {
    const s = createGame()
    put(s, '黃', 0, 1)
    put(s, '忠', 1, 1)
    const u = s.units.find((x) => x.kind === 'general')!
    u.skillCd = 0
    stepSkills(s, 1 / 60)
    expect(u.skillCd).toBe(0)
  })

  it('劉備〈仁德〉在滿血時不施放', () => {
    const s = createGame()
    put(s, '劉', 0, 1)
    put(s, '備', 1, 1)
    const u = s.units.find((x) => x.kind === 'general')!
    u.skillCd = 0
    stepSkills(s, 1 / 60)
    expect(s.lives).toBe(s.maxLives)
    expect(u.skillCd).toBe(0)
  })
})

describe('羈絆與組合技', () => {
  it('桃園結義觸發後，組合技會在冷卻歸零時施放', () => {
    const s = createGame()
    put(s, '劉', 0, 1)
    put(s, '備', 1, 1)
    put(s, '關', 3, 1)
    put(s, '羽', 4, 1)
    put(s, '張', 6, 1)
    put(s, '飛', 7, 1)
    expect(s.activeBonds.map((b) => b.name)).toContain('桃園結義')

    const e = spawnEnemy(s, { hp: 100000, maxHp: 100000, dist: 5 })
    for (let i = 0; i < 60 * 6; i++) stepGame(s, 1 / 60)
    expect(e.hp).toBeLessThan(100000)
    expect(s.bondCds['桃園結義']).toBeGreaterThan(0)
  })

  it('臥龍鳳雛縮短主動技冷卻 30%', () => {
    const s = createGame()
    put(s, '諸', 0, 1)
    put(s, '葛', 1, 1)
    put(s, '亮', 2, 1)
    const liang = s.units.find((u) => u.defKey === '諸葛亮')!
    const full = liang.skillCdMax
    put(s, '龐', 4, 1)
    put(s, '統', 5, 1)
    recalcUnits(s)
    expect(s.activeBonds.map((b) => b.name)).toContain('臥龍鳳雛')
    expect(liang.skillCdMax).toBeCloseTo(full * 0.7, 5)
  })
})

describe('三字配方', () => {
  it('諸葛亮需要三個字且順序正確', () => {
    const s = createGame()
    put(s, '諸', 0, 1)
    put(s, '葛', 1, 1)
    expect(s.units.every((u) => u.kind === 'glyph')).toBe(true) // 兩字還湊不成
    put(s, '亮', 2, 1)
    const g = s.units.find((u) => u.kind === 'general')
    expect(g?.defKey).toBe('諸葛亮')
    expect(g?.cells).toHaveLength(3)
    expect(g?.tier).toBe('mythic')
  })
})

describe('熔爐重抽', () => {
  it('花糧把手牌全部換新', () => {
    const s = createGame()
    s.food = 100
    s.hand[0] = { char: '刀', level: 1 }
    s.hand[1] = { char: '刀', level: 1 }
    const res = rerollHand(s)
    expect(res.ok).toBe(true)
    expect(s.food).toBeLessThan(100)
    expect(s.hand[0]).not.toBeNull()
    expect(s.hand[2]).toBeNull() // 空格不會被填滿，這是與征兵的差別
  })

  it('手牌全空時不能重抽', () => {
    const s = createGame()
    s.food = 100
    expect(rerollHand(s).ok).toBe(false)
  })
})
