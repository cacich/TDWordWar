import { describe, expect, it } from 'vitest'
import { cellIndex } from '../board'
import { placeFromHand, recruit } from '../actions'
import { SHOP_BY_KEY, buyItem, perksFrom } from '../../data/shop'
import { createGame, glyphAt, type MetaProgress } from '../state'
import { stepGame } from '../step'
import { DEFAULT_META } from '../state'
import type { Enemy } from '../types'

function meta(overrides: Partial<MetaProgress> = {}): MetaProgress {
  return { ...DEFAULT_META, items: [], renown: 0, ...overrides }
}

describe('商城購買', () => {
  it('購買扣聲望並記錄道具', () => {
    const m = meta({ renown: 500 })
    const res = buyItem(m, 'banner')
    expect(res.ok).toBe(true)
    expect(m.items).toContain('banner')
    expect(m.renown).toBe(500 - SHOP_BY_KEY['banner'].cost)
  })

  it('聲望不足無法購買', () => {
    const m = meta({ renown: 10 })
    expect(buyItem(m, 'banner').ok).toBe(false)
    expect(m.items).not.toContain('banner')
    expect(m.renown).toBe(10)
  })

  it('已擁有不可重複購買', () => {
    const m = meta({ renown: 999, items: ['banner'] })
    const res = buyItem(m, 'banner')
    expect(res.ok).toBe(false)
    expect(m.renown).toBe(999)
  })
})

describe('道具推導的被動效果 perksFrom', () => {
  it('無道具＝全中性（不影響難度基準）', () => {
    const p = perksFrom([])
    expect(p).toEqual({
      recruitEliteChance: 0,
      meteorInterval: 0,
      incomeMul: 1,
      healEveryWaves: 0,
      atkMul: 1,
      apsMul: 1,
    })
  })

  it('道具各自對應到正確的被動值', () => {
    expect(perksFrom(['elite']).recruitEliteChance).toBeGreaterThan(0)
    expect(perksFrom(['meteor']).meteorInterval).toBe(10)
    expect(perksFrom(['supply']).incomeMul).toBeCloseTo(1.3, 5)
    expect(perksFrom(['medic']).healEveryWaves).toBe(5)
    expect(perksFrom(['banner']).atkMul).toBeCloseTo(1.12, 5)
    expect(perksFrom(['gale']).apsMul).toBeCloseTo(1.12, 5)
  })
})

describe('道具在對局中生效', () => {
  it('號令旗：全場友軍攻擊 ×1.12', () => {
    const s = createGame('julu', 1, meta({ items: ['banner'] }))
    const cell = cellIndex(s.board, 0, 1)
    s.hand[0] = { char: '刀', level: 1 }
    placeFromHand(s, 0, cell)
    const u = glyphAt(s, cell)!
    expect(u.atk).toBeCloseTo(u.baseAtk * 1.12, 5)
  })

  it('精兵符：徵兵抽到的字直接升為二階（機率 100% 時）', () => {
    const s = createGame('julu', 1, meta({ items: ['elite'] }))
    s.perks.recruitEliteChance = 1 // 固定觸發，避免依賴亂數
    s.food = 9999
    recruit(s)
    for (const h of s.hand) expect(h?.level).toBe(2)
  })

  it('流星火雨：戰鬥中每 10 秒對敵人降下傷害', () => {
    const s = createGame('julu', 1, meta({ items: ['meteor'] }))
    s.phase = 'battle'
    s.spawnQueue = []
    s.enemies = [enemy(100000)]
    // 步進約 10.1 秒，讓火球至少落下一次
    for (let i = 0; i < 610; i++) stepGame(s, 1 / 60)
    const e = s.enemies[0]
    expect(e.hp).toBeLessThan(e.maxHp) // 被火球打到
    expect(e.burnT).toBeGreaterThan(0) // 且附加灼燒
  })
})

/** 造一個原地不動、血量極高的敵人，隔離出流星火雨的傷害 */
function enemy(hp: number): Enemy {
  return {
    id: 1,
    defKey: 'thief',
    char: '賊',
    hp,
    maxHp: hp,
    def: 0,
    speed: 0, // 不移動 → 不會漏過大營，方便隔離測試
    flying: false,
    bounty: 1,
    damage: 1,
    troop: 'none',
    ccImmune: false,
    dist: 1,
    hitFlash: 0,
    slow: 0,
    stun: 0,
    vuln: 0,
    burnT: 0,
    burnDps: 0,
  }
}
