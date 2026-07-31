/**
 * 戰場特性（`LevelDef.mods` → `GameState.mods`）。
 *
 * 設計契約：每個欄位都是**中性預設值**，省略＝完全不影響原本行為，
 * 所以既有關卡與所有既有測試都不該因為這個系統而改變。這裡把那條契約釘住。
 */
import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../core/rng'
import { LEVELS, LEVEL_ORDER, modTags } from '../../data/levels'
import { ENEMY_BY_KEY } from '../../data/enemies'
import { placeFromHand } from '../actions'
import { createGame, recalcUnits } from '../state'
import { stepGame } from '../step'
import { SPAWN_GAP, buildWave, isBossWave } from '../waves'
import type { Enemy, GameState } from '../types'

function spawn(state: GameState, defKey: string, dist = 3): Enemy {
  const def = ENEMY_BY_KEY[defKey]
  const e: Enemy = {
    id: state.nextEnemyId++,
    defKey: def.key,
    char: def.char,
    hp: 10000,
    maxHp: 10000,
    def: def.def,
    speed: def.speed,
    flying: def.flying,
    bounty: def.bounty,
    damage: def.damage,
    troop: def.troop,
    ccImmune: false,
    burnImmune: false,
    slowImmune: false,
    dist,
    hitFlash: 0,
    slow: 0,
    stun: 0,
    vuln: 0,
    burnT: 0,
    burnDps: 0,
  }
  state.enemies.push(e)
  state.phase = 'battle'
  state.spawnQueue = []
  return e
}

describe('中性預設值', () => {
  it('沒宣告 mods 的關卡，行為與加這個系統之前一模一樣', () => {
    expect(buildWave(6, mulberry32(3), 1, [], 30, 28)).toEqual(
      buildWave(6, mulberry32(3), 1, [], 30, 28, {}),
    )
    expect(isBossWave(5)).toBe(true)
    expect(isBossWave(6)).toBe(false)
    expect(createGame('julu', 1).mods).toEqual({})
  })
})

describe('bossEvery：BOSS 密度', () => {
  it('宣告 bossEvery 之後，BOSS 改在它的倍數波出現', () => {
    const bossKeys = new Set(Object.values(ENEMY_BY_KEY).filter((d) => d.boss).map((d) => d.key))
    const has = (wave: number) =>
      buildWave(wave, mulberry32(9), 1, [], 30, 44, { bossEvery: 3 }).some((e) =>
        bossKeys.has(e.defKey),
      )
    expect(has(3)).toBe(true)
    expect(has(6)).toBe(true)
    expect(has(4)).toBe(false)
    expect(has(5)).toBe(false) // 原本的每 5 波已經不再是 BOSS 波
  })
})

describe('spawnGap：出怪密度', () => {
  it('間隔變小 → 同一波的敵人全部提早出場', () => {
    const normal = buildWave(10, mulberry32(11), 1, [], 30, 30)
    const dense = buildWave(10, mulberry32(11), 1, [], 30, 30, { spawnGap: 0.4 })
    expect(dense).toHaveLength(normal.length)
    expect(normal[5].at).toBeCloseTo(5 * SPAWN_GAP, 6)
    expect(dense[5].at).toBeCloseTo(5 * 0.4, 6)
    // 敵種與血量完全一樣：spawnGap 只動時間軸，不動組成（否則同種子會產出不同的一局）
    expect(dense.map((e) => e.defKey)).toEqual(normal.map((e) => e.defKey))
    expect(dense.map((e) => e.hp)).toEqual(normal.map((e) => e.hp))
  })
})

describe('rangeMul：濃霧', () => {
  it('會縮短我軍實效射程，且與局外道具的 rangeMul 相乘', () => {
    const s = createGame('julu', 1)
    s.hand[0] = { char: '弓', level: 1 }
    const plot = s.board.tiles.findIndex((t) => t === 'plot')
    placeFromHand(s, 0, plot)
    const full = s.units[0].range
    expect(full).toBeGreaterThan(0)

    s.mods = { rangeMul: 0.85 }
    recalcUnits(s)
    expect(s.units[0].range).toBeCloseTo(full * 0.85, 6)

    s.perks = { ...s.perks, rangeMul: 1.2 }
    recalcUnits(s)
    expect(s.units[0].range).toBeCloseTo(full * 0.85 * 1.2, 6)
  })
})

describe('enemySpeedMul：行軍速度', () => {
  it('會加快敵人推進，且與局外道具的 enemySpeedMul 相乘', () => {
    const walk = (mods: GameState['mods'], perk: number) => {
      const s = createGame('julu', 1)
      s.mods = mods
      s.perks = { ...s.perks, enemySpeedMul: perk }
      const e = spawn(s, 'thief', 0)
      for (let i = 0; i < 60; i++) stepGame(s, 1 / 60)
      return e.dist
    }
    const base = walk({}, 1)
    expect(walk({ enemySpeedMul: 1.5 }, 1)).toBeCloseTo(base * 1.5, 3)
    expect(walk({ enemySpeedMul: 1.5 }, 0.5)).toBeCloseTo(base * 0.75, 3)
  })
})

describe('關卡資料', () => {
  it('每個宣告 mods 的關卡都能被 modTags 描述（UI 不會出現空白特性）', () => {
    for (const key of LEVEL_ORDER) {
      const lv = LEVELS[key]
      if (!lv.mods) continue
      expect(modTags(lv).length, `${key} 有 mods 卻推導不出說明`).toBeGreaterThan(0)
    }
    expect(modTags(LEVELS.julu)).toEqual([])
  })

  it('無盡變體沿用原關的戰場特性', () => {
    for (const key of LEVEL_ORDER) {
      expect(LEVELS[`endless_${key}`].mods).toEqual(LEVELS[key].mods)
    }
  })

  it('新增的終盤關卡都真的帶了一個「跟前面不一樣」的特性', () => {
    for (const key of ['hefei', 'hulao', 'xuchang']) {
      expect(LEVELS[key].mods, `${key} 應該要有戰場特性`).toBeTruthy()
    }
  })
})
