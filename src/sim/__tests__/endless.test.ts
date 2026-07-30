/**
 * 無盡模式。三件事必須有測試守著，因為它們全都是「沉默地壞掉」的那一類：
 *   1. `Infinity` 的難度弧要退回 `WAVE_REF`——漏了不會報錯，只會讓敵人永遠停在第 0 波強度
 *   2. `checkWaveEnd` 不能通關——漏了會讓無盡在第 1 波就顯示「守住了」
 *   3. 無盡變體必須是原關的推導，且不得汙染 `LEVEL_ORDER`（解鎖鏈／每日輪替／成就門檻共用它）
 */
import { describe, expect, it } from 'vitest'
import {
  ENDLESS_ORDER,
  LEVELS,
  LEVEL_ORDER,
  baseKeyOf,
  endlessKeyOf,
  isEndlessKey,
} from '../../data/levels'
import { restoreRun, snapshotRun } from '../persist'
import { DEFAULT_META, createGame } from '../state'
import { stepGame } from '../step'
import { BASE_HP, HP_GROWTH, MAX_WAVE_ENEMIES, WAVE_REF, buildWave, enemyBaseHp, enemyCount } from '../waves'
import { mulberry32 } from '../../core/rng'
import type { GameState } from '../types'

const DT = 1 / 60

/** 把對局推到「本波已清空、正要結算過波」的狀態 */
function clearWave(state: GameState): void {
  state.phase = 'battle'
  state.spawnQueue = []
  state.enemies = []
  stepGame(state, DT)
}

describe('無盡關卡的推導', () => {
  it('每一關都有對應的無盡版，且沿用原關的地圖與數值', () => {
    for (const key of LEVEL_ORDER) {
      const base = LEVELS[key]
      const e = LEVELS[endlessKeyOf(key)]
      expect(e, `${key} 沒有無盡版`).toBeDefined()
      expect(e.endless).toBe(true)
      expect(e.maxWave).toBe(Infinity)
      // 難度、容錯、字池、敵人偏好、地形一律沿用原關——無盡不是新關卡
      expect(e.hpMul).toBe(base.hpMul)
      expect(e.lives).toBe(base.lives)
      expect(e.startFood).toBe(base.startFood)
      expect(e.pool).toEqual(base.pool)
      expect(e.bias).toEqual(base.bias)
      expect(e.map).toEqual(base.map)
      expect(e.gen).toEqual(base.gen)
      expect(e.name).toContain(base.name)
    }
  })

  it('無盡關卡不在 LEVEL_ORDER 裡（否則會弄壞解鎖鏈、每日輪替與「天下歸心」門檻）', () => {
    for (const key of LEVEL_ORDER) expect(isEndlessKey(key)).toBe(false)
    expect(ENDLESS_ORDER).toHaveLength(LEVEL_ORDER.length)
    for (const key of ENDLESS_ORDER) expect(LEVEL_ORDER).not.toContain(key)
  })

  it('key helper 可以來回轉換', () => {
    expect(baseKeyOf(endlessKeyOf('julu'))).toBe('julu')
    // 原關 key 傳進去要原樣回傳（app 層用它決定成績記在哪一份榜上）
    expect(baseKeyOf('julu')).toBe('julu')
    expect(isEndlessKey(endlessKeyOf('julu'))).toBe(true)
  })

  it('createGame 開得起來，maxWave 是 Infinity', () => {
    const state = createGame(endlessKeyOf('julu'), 1234, DEFAULT_META)
    expect(state.maxWave).toBe(Infinity)
    expect(state.hpMul).toBe(LEVELS.julu.hpMul)
    // 棋盤沿用原關 → 同種子下與原關完全同一張圖
    expect(state.board.tiles).toEqual(createGame('julu', 1234, DEFAULT_META).board.tiles)
  })
})

describe('無盡的難度弧', () => {
  it('maxWave = Infinity 退回 WAVE_REF，血量照絕對波次成長', () => {
    expect(enemyBaseHp(9, Infinity)).toBeCloseTo(enemyBaseHp(9, WAVE_REF), 6)
    expect(enemyBaseHp(9, Infinity)).toBeCloseTo(BASE_HP * Math.pow(HP_GROWTH, 9), 6)
  })

  it('血量會一直成長下去（若相對進度沒退回 WAVE_REF，這裡會變成完全相等）', () => {
    expect(enemyBaseHp(40, Infinity)).toBeGreaterThan(enemyBaseHp(20, Infinity) * 50)
    expect(enemyBaseHp(80, Infinity)).toBeGreaterThan(enemyBaseHp(40, Infinity) * 50)
  })

  it('buildWave 在無盡下同樣吃到成長後的血量', () => {
    const early = buildWave(5, mulberry32(1), 1, [], Infinity)
    const late = buildWave(25, mulberry32(1), 1, [], Infinity)
    expect(late[0].hp).toBeGreaterThan(early[0].hp * 20)
  })

  it('單波敵人數有上限，且有限關卡碰不到它', () => {
    expect(enemyCount(200)).toBe(MAX_WAVE_ENEMIES)
    // 最長的關卡是 40 波，必須落在上限之內——否則這個上限就改到了既有平衡
    const longest = Math.max(...LEVEL_ORDER.map((k) => LEVELS[k].maxWave))
    expect(enemyCount(longest)).toBeLessThan(MAX_WAVE_ENEMIES)
    expect(buildWave(200, mulberry32(1), 1, [], Infinity).length).toBeLessThanOrEqual(MAX_WAVE_ENEMIES + 4)
  })
})

describe('無盡不會通關', () => {
  it('清完一波只會進下一波的佈陣，永遠不會變成 won', () => {
    const state = createGame(endlessKeyOf('huangjin'), 77, DEFAULT_META)
    // 原關 12 波就通關，這裡刻意跨過那個門檻
    state.wave = 60
    clearWave(state)
    expect(state.phase).toBe('prep')
    expect(state.wave).toBe(61)
  })

  it('同樣的情境在有限關卡會通關（對照組，證明上面測到的是無盡而不是失效的判定）', () => {
    const state = createGame('huangjin', 77, DEFAULT_META)
    state.wave = state.maxWave
    clearWave(state)
    expect(state.phase).toBe('won')
  })

  it('生命歸零時照樣會落敗', () => {
    const state = createGame(endlessKeyOf('julu'), 5, DEFAULT_META)
    state.wave = 30
    state.phase = 'battle'
    state.lives = 1
    // 把一隻敵人直接放到終點：下一幀就會漏過並扣光生命
    state.spawnQueue = []
    state.enemies = [
      {
        id: 1,
        defKey: 'thief',
        char: '賊',
        hp: 10,
        maxHp: 10,
        def: 0,
        speed: 99,
        flying: false,
        bounty: 1,
        damage: 9,
        troop: '步',
        ccImmune: false,
        burnImmune: false,
        slowImmune: false,
        dist: state.board.path.length - 1.001,
        hitFlash: 0,
        slow: 0,
        stun: 0,
        vuln: 0,
        burnT: 0,
        burnDps: 0,
      },
    ]
    stepGame(state, DT)
    expect(state.phase).toBe('lost')
  })
})

describe('無盡的續玩存檔', () => {
  it('快照還原後仍然是無盡（maxWave 由關卡表重建，不從存檔讀）', () => {
    const state = createGame(endlessKeyOf('guandu'), 4242, DEFAULT_META)
    for (let i = 0; i < 300; i++) stepGame(state, DT)
    const snap = JSON.parse(JSON.stringify(snapshotRun(state, 4242)))
    const back = restoreRun(snap, DEFAULT_META)
    expect(back).not.toBeNull()
    expect(back!.maxWave).toBe(Infinity)
    expect(back!.levelKey).toBe(endlessKeyOf('guandu'))
    // 隨機地形也要重建成同一張圖（地圖由 關卡+種子 決定，刻意不存進快照）
    expect(back!.board.tiles).toEqual(state.board.tiles)
  })
})
