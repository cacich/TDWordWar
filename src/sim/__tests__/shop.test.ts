import { describe, expect, it } from 'vitest'
import { cellIndex } from '../board'
import { BONDS } from '../../data/bonds'
import { placeFromHand, recruit } from '../actions'
import { dealDamage, damageEnemy } from '../combat'
import { recruitCost, rerollCost, rollGlyph } from '../economy'
import { MAX_ITEM_LEVEL, SHOP, SHOP_BY_KEY, buyItem, itemLevel, perksFrom } from '../../data/shop'
import { createGame, glyphAt, recalcUnits, type MetaProgress } from '../state'
import { stepGame } from '../step'
import { DEFAULT_META } from '../state'
import type { Enemy, Perks } from '../types'

function meta(overrides: Partial<MetaProgress> = {}): MetaProgress {
  return { ...DEFAULT_META, items: {}, renown: 0, ...overrides }
}

describe('商城購買與升級', () => {
  it('購買第一級扣聲望並記錄等級', () => {
    const m = meta({ renown: 500 })
    const res = buyItem(m, 'banner')
    expect(res.ok).toBe(true)
    expect(itemLevel(m, 'banner')).toBe(1)
    expect(m.renown).toBe(500 - SHOP_BY_KEY['banner'].cost(0))
  })

  it('聲望不足無法升級', () => {
    const m = meta({ renown: 10 })
    expect(buyItem(m, 'banner').ok).toBe(false)
    expect(itemLevel(m, 'banner')).toBe(0)
    expect(m.renown).toBe(10)
  })

  it('可以連續升級到最高等級，之後再買會被擋下', () => {
    const m = meta({ renown: 99999 })
    for (let i = 0; i < MAX_ITEM_LEVEL; i++) {
      const res = buyItem(m, 'banner')
      expect(res.ok).toBe(true)
    }
    expect(itemLevel(m, 'banner')).toBe(MAX_ITEM_LEVEL)
    const res = buyItem(m, 'banner')
    expect(res.ok).toBe(false)
    expect(res.msg).toContain('最高等級')
  })

  it('每一級的價格都比上一級貴（成長曲線）', () => {
    const def = SHOP_BY_KEY['meteor']
    expect(def.cost(1)).toBeGreaterThan(def.cost(0))
    expect(def.cost(2)).toBeGreaterThan(def.cost(1))
  })
})

describe('perksFrom：無道具＝全中性（不影響難度基準）', () => {
  it('items 為空物件時，所有欄位都是中性值', () => {
    const p = perksFrom({})
    expect(p).toEqual({
      recruitEliteChance: 0,
      meteorInterval: 0,
      incomeMul: 1,
      healEveryWaves: 0,
      atkMul: 1,
      apsMul: 1,
      critChance: 0,
      critMul: 1,
      extraLives: 0,
      costMul: 1,
      familiarBoostMul: 1,
      leakBlockChance: 0,
      splashMul: 1,
      bountyMul: 1,
      enemySpeedMul: 1,
      rangeMul: 1,
      cdMul: 1,
    })
  })
})

describe('perksFrom：每種道具只影響自己負責的欄位', () => {
  const neutral = perksFrom({})
  for (const item of SHOP) {
    it(`${item.key}（${item.name}）買滿等級後有效果，且不影響其他道具的欄位`, () => {
      const p = perksFrom({ [item.key]: item.max })
      const changed = (Object.keys(p) as (keyof Perks)[]).filter((k) => p[k] !== neutral[k])
      expect(changed.length).toBeGreaterThan(0)
      // crit 例外：一次寫入 critChance 與 critMul 兩個欄位
      expect(changed.length).toBe(item.key === 'crit' ? 2 : 1)
    })
  }

  it('等級 1～max 逐級遞增效果強度（用 detail() 字串至少確保不重複、不報錯）', () => {
    for (const item of SHOP) {
      const seen = new Set<string>()
      for (let lv = 1; lv <= item.max; lv++) {
        const text = item.detail(lv)
        expect(text).toBeTruthy()
        expect(seen.has(text)).toBe(false)
        seen.add(text)
      }
    }
  })
})

describe('道具在對局中生效', () => {
  it('號令旗：全場友軍攻擊 ×倍率', () => {
    const s = createGame('julu', 1, meta({ items: { banner: 1 } }))
    const cell = cellIndex(s.board, 0, 1)
    s.hand[0] = { char: '刀', level: 1 }
    placeFromHand(s, 0, cell)
    const u = glyphAt(s, cell)!
    expect(u.atk).toBeCloseTo(u.baseAtk * s.perks.atkMul, 5)
  })

  it('精兵符：徵兵抽到的字直接升為二階（機率 100% 時）', () => {
    const s = createGame('julu', 1, meta({ items: { elite: 1 } }))
    s.perks.recruitEliteChance = 1 // 固定觸發，避免依賴亂數
    s.food = 9999
    recruit(s)
    for (const h of s.hand) expect(h?.level).toBe(2)
  })

  it('流星火雨：戰鬥中每隔一段時間對敵人降下傷害', () => {
    const s = createGame('julu', 1, meta({ items: { meteor: 1 } }))
    s.phase = 'battle'
    s.spawnQueue = []
    s.enemies = [enemy(100000)]
    // 步進超過一次 meteorInterval，讓火球至少落下一次
    const steps = Math.ceil((s.perks.meteorInterval + 0.5) * 60)
    for (let i = 0; i < steps; i++) stepGame(s, 1 / 60)
    const e = s.enemies[0]
    expect(e.hp).toBeLessThan(e.maxHp) // 被火球打到
    expect(e.burnT).toBeGreaterThan(0) // 且附加灼燒
  })

  it('奇兵秘計：爆擊必定觸發時，傷害提高 critMul 倍', () => {
    const base = createGame('julu', 1, meta())
    const boosted = createGame('julu', 1, meta({ items: { crit: 1 } }))
    boosted.perks.critChance = 1 // 固定觸發，避免依賴亂數
    const cellA = cellIndex(base.board, 0, 1)
    const cellB = cellIndex(boosted.board, 0, 1)
    base.hand[0] = { char: '刀', level: 1 }
    boosted.hand[0] = { char: '刀', level: 1 }
    placeFromHand(base, 0, cellA)
    placeFromHand(boosted, 0, cellB)
    const uA = glyphAt(base, cellA)!
    const uB = glyphAt(boosted, cellB)!
    const eA = enemy(100000)
    const eB = enemy(100000)
    dealDamage(base, uA, eA, uA.atk)
    dealDamage(boosted, uB, eB, uB.atk)
    const dmgA = eA.maxHp - eA.hp
    const dmgB = eB.maxHp - eB.hp
    expect(dmgB).toBeCloseTo(dmgA * boosted.perks.critMul, 5)
  })

  it('狩獵好手：擊殺收入依 bountyMul 提高', () => {
    const s = createGame('julu', 1, meta({ items: { bounty: 3 } }))
    const e = enemy(1, { bounty: 10 })
    const before = s.food
    damageEnemy(s, e, 999)
    expect(s.food - before).toBe(Math.round(10 * s.perks.bountyMul))
  })

  it('沼澤泥沼：敵人移動速度依 enemySpeedMul 降低', () => {
    const base = createGame('julu', 1, meta())
    const slowed = createGame('julu', 1, meta({ items: { enemyslow: 3 } }))
    for (const s of [base, slowed]) {
      s.phase = 'battle'
      s.spawnQueue = []
      s.enemies = [enemy(100000, { speed: 2, dist: 1 })]
    }
    stepGame(base, 1 / 60)
    stepGame(slowed, 1 / 60)
    const deltaBase = base.enemies[0].dist - 1
    const deltaSlowed = slowed.enemies[0].dist - 1
    expect(deltaSlowed).toBeCloseTo(deltaBase * slowed.perks.enemySpeedMul, 5)
  })

  it('回魂旗：機率觸發時漏怪不扣血命（但仍計入 stats.leaks）', () => {
    const s = createGame('julu', 1, meta({ items: { leakshield: 3 } }))
    s.perks.leakBlockChance = 1 // 固定觸發，避免依賴亂數
    s.phase = 'battle'
    s.spawnQueue = []
    const goal = s.board.path.length - 1
    s.enemies = [enemy(1, { speed: 100, damage: 5, dist: goal - 0.001 })]
    const before = s.lives
    stepGame(s, 1 / 60)
    expect(s.lives).toBe(before)
    expect(s.stats.leaks).toBe(1)
  })

  it('輕裝簡從：征兵與重抽花費打折', () => {
    const base = createGame('julu', 1, meta())
    const s = createGame('julu', 1, meta({ items: { thrift: 2 } }))
    expect(recruitCost(s)).toBeLessThan(recruitCost(base))
    expect(rerollCost(s)).toBeLessThan(rerollCost(base))
  })

  it('鐵壁工事：起始與上限生命增加', () => {
    const base = createGame('julu', 1, meta())
    const s = createGame('julu', 1, meta({ items: { fortify: 2 } }))
    expect(s.maxLives).toBe(base.maxLives + s.perks.extraLives)
    expect(s.lives).toBe(s.maxLives)
  })

  it('精工兵器：全場射程疊在全域倍率之上', () => {
    const base = createGame('julu', 1, meta())
    const s = createGame('julu', 1, meta({ items: { range: 3 } }))
    const cellA = cellIndex(base.board, 0, 1)
    const cellB = cellIndex(s.board, 0, 1)
    base.hand[0] = { char: '刀', level: 1 }
    s.hand[0] = { char: '刀', level: 1 }
    placeFromHand(base, 0, cellA)
    placeFromHand(s, 0, cellB)
    const ub = glyphAt(base, cellA)!
    const u = glyphAt(s, cellB)!
    expect(u.range).toBeCloseTo(ub.range * s.perks.rangeMul, 5)
  })

  it('兵法傳承：cdMul 疊在羈絆的 cdMul 之上（沒有羈絆時單獨生效）', () => {
    const s = createGame('julu', 1, meta({ items: { bondcd: 3 } }))
    recalcUnits(s) // cdMul 是衍生值，createGame 之後要重算一次才會套用
    expect(s.cdMul).toBeCloseTo(s.perks.cdMul, 5)
  })

  /**
   * 迴歸守護：activeBonds 面板顯示的 combo.cdMax 曾經只乘羈絆的 cdMul、
   * 漏掉 perks.cdMul，導致買了兵法傳承後 UI 顯示的冷卻比實際倒數還長。
   */
  it('兵法傳承：組合技面板的 cdMax 與實際倒數同基準', () => {
    const s = createGame('julu', 1, meta({ items: { bondcd: 3 } }))
    // 湊出「呂布陳宮」這個有組合技的羈絆
    for (const [ch, col, row] of [
      ['呂', 2, 1],
      ['布', 3, 1],
      ['陳', 2, 2],
      ['宮', 3, 2],
    ] as const) {
      s.hand[0] = { char: ch, level: 1 }
      placeFromHand(s, 0, cellIndex(s.board, col, row))
    }
    const bond = s.activeBonds.find((b) => b.name === '呂布陳宮')
    expect(bond?.combo).toBeTruthy()
    const declared = BONDS.find((b) => b.name === '呂布陳宮')!.comboSkill!.cd
    expect(bond!.combo!.cdMax).toBeCloseTo(declared * s.cdMul, 5)
  })

  it('廣結善緣：familiarBoostMul 提高熟悉字被抽到的權重', () => {
    // 「刀」「弓」同為 rarity1，基礎權重相同；固定 rng 讓結果只取決於加權
    const pool = ['刀', '弓']
    const fakeRng = () => 0.2
    const withoutBoost = rollGlyph(fakeRng, 1, { pool, familiar: new Set(['弓']) })
    const withBoost = rollGlyph(fakeRng, 1, { pool, familiar: new Set(['弓']), familiarBoostMul: 5 })
    expect(withoutBoost.char).toBe('刀')
    expect(withBoost.char).toBe('弓')
  })
})

/** 造一個原地不動、血量極高的敵人，方便隔離測試個別道具效果 */
function enemy(
  hp: number,
  opts: { speed?: number; damage?: number; bounty?: number; dist?: number } = {},
): Enemy {
  return {
    id: 1,
    defKey: 'thief',
    char: '賊',
    hp,
    maxHp: hp,
    def: 0,
    speed: opts.speed ?? 0,
    flying: false,
    bounty: opts.bounty ?? 1,
    damage: opts.damage ?? 1,
    troop: 'none',
    ccImmune: false,
    burnImmune: false,
    slowImmune: false,
    dist: opts.dist ?? 1,
    hitFlash: 0,
    slow: 0,
    stun: 0,
    vuln: 0,
    burnT: 0,
    burnDps: 0,
  }
}
