/**
 * 卡波（整局停在同一波動不了）的回歸測試。
 *
 * 這個 bug 的實際樣子：一波裡出現太多妖道，它們**互相回血**於是打不死；
 * 同時玩家的擊退把敵人一直推回去，於是它們也走不到大營、不會漏過去結束這一波。
 * 兩件事同時成立 → 這一波永遠不會結束。
 *
 * 修法分三層，這裡每一層都各有一組測試：
 *   1. 治療者之間不互相治療（sim/step.ts 的 stepEnemySupport）
 *   2. 敵方光環的疊加有上限（HEAL_CAP_HPS / DEF_ADD_CAP / SPEED_AURA_CAP）
 *   3. 督戰：沒進展夠久就強制推進（stepFrenzy）—— 與成因無關的最後保證
 */
import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../core/rng'
import { ENEMY_BY_KEY } from '../../data/enemies'
import { applyStatus } from '../combat'
import { createGame } from '../state'
import { DEF_ADD_CAP, HEAL_CAP_HPS, SPEED_AURA_CAP, stepGame } from '../step'
import { buildWave, enemyCount } from '../waves'
import type { Enemy, GameState } from '../types'

/** 依敵表建一隻執行期敵人，欄位跟 step.ts 的 makeEnemy 對齊 */
function spawn(state: GameState, defKey: string, over: Partial<Enemy> = {}): Enemy {
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
    ccImmune: def.ccImmune ?? false,
    burnImmune: def.burnImmune ?? false,
    slowImmune: def.slowImmune ?? false,
    dist: 3,
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
  state.spawnQueue = []
  return e
}

describe('治療光環不會疊成打不死的鐵板', () => {
  it('妖道之間不互相回血', () => {
    const s = createGame('julu', 1)
    const a = spawn(s, 'shaman', { dist: 3, hp: 5000 })
    const b = spawn(s, 'shaman', { dist: 3.2, hp: 5000 })
    for (let i = 0; i < 120; i++) stepGame(s, 1 / 60)
    expect(a.hp, '妖道被另一隻妖道奶了').toBe(5000)
    expect(b.hp).toBe(5000)
  })

  it('妖道首（BOSS）也不會被雜兵妖道奶起來', () => {
    const s = createGame('julu', 1)
    const boss = spawn(s, 'bossShaman', { dist: 3, hp: 5000 })
    for (let i = 0; i < 4; i++) spawn(s, 'shaman', { dist: 3 })
    for (let i = 0; i < 120; i++) stepGame(s, 1 / 60)
    expect(boss.hp).toBe(5000)
  })

  it('妖道照樣治療一般敵人（機制沒被改壞）', () => {
    const s = createGame('julu', 1)
    spawn(s, 'shaman', { dist: 3 })
    const hurt = spawn(s, 'thief', { dist: 3, hp: 5000 })
    for (let i = 0; i < 60; i++) stepGame(s, 1 / 60)
    expect(hurt.hp).toBeGreaterThan(5000)
  })

  it('多隻妖道疊在一起，每秒回血總量仍有上限', () => {
    const s = createGame('julu', 1)
    const hurt = spawn(s, 'thief', { dist: 3, hp: 3000 })
    for (let i = 0; i < 6; i++) spawn(s, 'shaman', { dist: 3 })
    for (let i = 0; i < 60; i++) stepGame(s, 1 / 60)
    const healed = hurt.hp - 3000
    // 6 隻 × 5% = 30%／秒，上限把它壓回 12%／秒
    expect(healed).toBeGreaterThan(hurt.maxHp * HEAL_CAP_HPS * 0.9)
    expect(healed).toBeLessThan(hurt.maxHp * HEAL_CAP_HPS * 1.1)
  })

  it('單一波裡的妖道數量有上限（同時出太多是卡波的起點）', () => {
    const share = ENEMY_BY_KEY['shaman'].maxShare!
    for (let seed = 1; seed <= 30; seed++) {
      const wave = buildWave(20, mulberry32(seed * 17), 1, ['healer'])
      const cap = Math.max(1, Math.floor(enemyCount(20) * share))
      const n = wave.filter((e) => e.defKey === 'shaman').length
      expect(n, `種子 ${seed} 的第 20 波出了 ${n} 隻妖道`).toBeLessThanOrEqual(cap)
    }
  })
})

describe('加防／加速光環同樣有疊加上限', () => {
  it('旗賊的加防疊到上限就不再增加，而且不會逐幀累積', () => {
    const s = createGame('julu', 1)
    const t = spawn(s, 'thief', { dist: 3 })
    for (let i = 0; i < 5; i++) spawn(s, 'warden', { dist: 3 })
    stepGame(s, 1 / 60)
    const base = ENEMY_BY_KEY['thief'].def
    expect(t.def).toBe(base + DEF_ADD_CAP) // 5 × 40 = 200 → 壓回 60
    // 再跑兩秒：光環是每幀重算的衍生值，不該愈疊愈高
    for (let i = 0; i < 120; i++) stepGame(s, 1 / 60)
    expect(t.def).toBe(base + DEF_ADD_CAP)
  })

  it('戰鼓將的加速疊到上限就不再增加', () => {
    const s = createGame('julu', 1)
    const t = spawn(s, 'thief', { dist: 3 })
    for (let i = 0; i < 3; i++) spawn(s, 'bossDrum', { dist: 3 })
    stepGame(s, 1 / 60)
    expect(t.speed).toBeCloseTo(ENEMY_BY_KEY['thief'].speed * SPEED_AURA_CAP, 5)
  })

  it('沒有光環來源時，攻防速維持敵表的原值', () => {
    const s = createGame('julu', 1)
    const t = spawn(s, 'shield', { dist: 3 })
    for (let i = 0; i < 60; i++) stepGame(s, 1 / 60)
    expect(t.def).toBe(ENEMY_BY_KEY['shield'].def)
    expect(t.speed).toBe(ENEMY_BY_KEY['shield'].speed)
  })
})

describe('督戰：波次一定會結束', () => {
  /** 每幀都把全場敵人推回去，模擬「擊退流把整波鎖死」 */
  function runWithKnockLock(s: GameState, seconds: number): number {
    const steps = Math.round(seconds * 60)
    let maxFrenzy = 0
    for (let i = 0; i < steps; i++) {
      for (const e of s.enemies) if (e.hp > 0) applyStatus(s, e, { knock: 1, stunDur: 0.5 }, 100)
      stepGame(s, 1 / 60)
      maxFrenzy = Math.max(maxFrenzy, s.frenzy)
      if (!s.enemies.length) break
    }
    return maxFrenzy
  }

  it('無限擊退＋定身也不會讓一隻敵人永遠留在場上', () => {
    const s = createGame('julu', 1)
    spawn(s, 'thief', { dist: 5 })
    const maxFrenzy = runWithKnockLock(s, 180)
    expect(maxFrenzy).toBe(1)
    expect(s.enemies, '敵人被擊退鎖死在場上，這一波永遠不會結束').toHaveLength(0)
    expect(s.stats.leaks).toBe(1)
  })

  it('使用者回報的情境：一整包妖道＋擊退鎖，整波仍然會收掉', () => {
    const s = createGame('wuzhang', 3)
    for (let i = 0; i < 8; i++) spawn(s, 'shaman', { dist: 4 + i * 0.2 })
    for (let i = 0; i < 8; i++) spawn(s, 'thief', { dist: 4 + i * 0.2 })
    runWithKnockLock(s, 240)
    // 這一局沒有任何防守單位，所以「不卡住」的正確結果是敵人全部走到大營把命扣光。
    // 卡波的樣子則相反：場上還是那 16 隻、生命一點沒少、時間停在同一波
    expect(s.stats.leaks, '整波卡在原地：打不死又推不動').toBeGreaterThan(0)
    expect(s.phase === 'lost' || s.enemies.length === 0).toBe(true)
  })

  it('正常推進的波次不會觸發督戰（它是保險，不是難度旋鈕）', () => {
    const s = createGame('julu', 1)
    spawn(s, 'stone', { dist: 0 }) // 全遊戲最慢的一般兵，速度 0.4
    for (let i = 0; i < 60 * 60; i++) {
      stepGame(s, 1 / 60)
      expect(s.frenzy, '慢慢走的長波次被誤判成僵局').toBe(0)
      if (!s.enemies.length) break
    }
  })

  it('督戰在一波之內只升不降，過波後歸零', () => {
    const s = createGame('julu', 1)
    const e = spawn(s, 'thief', { dist: 5 })
    for (let i = 0; i < 60 * 16; i++) {
      applyStatus(s, e, { knock: 1 }, 100)
      stepGame(s, 1 / 60)
    }
    expect(s.frenzy).toBeGreaterThan(0)
    // 停止擊退：敵人恢復前進，但督戰不收回——收回會讓擊退鎖進入永遠結束不了的震盪
    for (let i = 0; i < 60 * 5; i++) stepGame(s, 1 / 60)
    expect(s.frenzy).toBeGreaterThan(0)
    // 跑到下一波真正開打為止（過波後還有佈陣期），frenzy 要回到 0
    for (let i = 0; i < 60 * 300 && !(s.wave === 2 && s.phase === 'battle'); i++) {
      stepGame(s, 1 / 60)
    }
    expect(s.wave).toBe(2)
    expect(s.frenzy).toBe(0)
  })

  it('控住一隻高血敵人慢慢磨不算僵局（血量在掉就是有進展）', () => {
    const s = createGame('julu', 1)
    const e = spawn(s, 'stone', { dist: 5, hp: 200000, maxHp: 200000 })
    for (let i = 0; i < 60 * 40; i++) {
      // 定身鎖住不讓它前進，但每幀都在扣血
      applyStatus(s, e, { stunDur: 0.5 }, 100)
      e.hp -= 300 * (1 / 60)
      stepGame(s, 1 / 60)
      if (!s.enemies.length) break
    }
    expect(s.frenzy, '正當的「控住磨血」被誤判成僵局').toBe(0)
  })
})
