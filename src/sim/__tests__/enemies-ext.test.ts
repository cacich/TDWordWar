import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../core/rng'
import {
  BOSSES,
  COUNTER_LABEL,
  ENEMIES,
  ENEMY_BY_KEY,
  REGULARS,
  TRAIT_COUNTERS,
  TRAIT_LABEL,
  countersFor,
} from '../../data/enemies'
import { LEVELS, LEVEL_ORDER } from '../../data/levels'
import { applyStatus } from '../combat'
import { createGame } from '../state'
import { stepGame } from '../step'
import { buildWave, isBossWave, pickBoss } from '../waves'
import type { Enemy, EnemyTrait, GameState } from '../types'

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

describe('敵表完整性', () => {
  it('每隻敵人的 key 與 char 都不重複', () => {
    expect(new Set(ENEMIES.map((e) => e.key)).size).toBe(ENEMIES.length)
  })

  it('BOSS 與一般兵完整二分，且 BOSS 全部免疫定身擊退', () => {
    expect(REGULARS.length + BOSSES.length).toBe(ENEMIES.length)
    for (const b of BOSSES) {
      expect(b.ccImmune, `${b.key} 應該是 ccImmune`).toBe(true)
      expect(b.hpMul, `${b.key} 血量倍率應該遠高於一般兵`).toBeGreaterThan(5)
    }
  })

  it('BOSS 至少 10 種，且各自有不同的機制或屬性組合', () => {
    expect(BOSSES.length).toBeGreaterThanOrEqual(10)
    // 用「機制指紋」確認每隻 BOSS 都不是純數值差異的複製品
    const prints = BOSSES.map((b) =>
      JSON.stringify([
        b.burnImmune ?? false,
        b.slowImmune ?? false,
        b.flying,
        !!b.healAura,
        !!b.regen,
        !!b.splitInto,
        !!b.escort,
        b.damage,
        // 速度與防禦分檔，讓「快速型」「重甲型」也算不同特色
        b.speed >= 1.5 ? 'fast' : b.speed <= 0.5 ? 'slow' : 'mid',
        b.def >= 80 ? 'armored' : 'normal',
      ]),
    )
    expect(new Set(prints).size, 'BOSS 之間應該有機制差異，不能只是血量不同').toBe(BOSSES.length)
  })

  it('splitInto / escort 指向的 key 都存在', () => {
    for (const e of ENEMIES) {
      if (e.splitInto) {
        expect(
          ENEMY_BY_KEY[e.splitInto.key],
          `${e.key} 的 splitInto 指向不存在的 ${e.splitInto.key}`,
        ).toBeTruthy()
      }
      if (e.escort) expect(ENEMY_BY_KEY[e.escort.key]).toBeTruthy()
    }
  })

  /**
   * 允許多層分裂（分裂將 → 分裂賊 → 蟻賊），但**分裂圖必須無環**，
   * 否則 cleanupDead 會讓敵人無限增殖直到卡死。這是最關鍵的安全不變量。
   */
  it('分裂圖無環且深度有限', () => {
    for (const start of ENEMIES) {
      if (!start.splitInto) continue
      const seen = new Set<string>([start.key])
      let cur = ENEMY_BY_KEY[start.splitInto.key]
      let depth = 0
      while (cur?.splitInto) {
        depth++
        expect(seen.has(cur.key), `分裂圖出現環：${[...seen].join(' → ')} → ${cur.key}`).toBe(false)
        seen.add(cur.key)
        expect(depth, `${start.key} 的分裂鏈過深，會產生太多單位`).toBeLessThanOrEqual(3)
        cur = ENEMY_BY_KEY[cur.splitInto.key]
      }
    }
  })

  it('一次分裂產生的總單位數有上限（避免後期卡死）', () => {
    const totalSpawned = (key: string): number => {
      const def = ENEMY_BY_KEY[key]
      if (!def?.splitInto) return 1
      return def.splitInto.count * totalSpawned(def.splitInto.key)
    }
    for (const e of ENEMIES) {
      if (!e.splitInto) continue
      expect(totalSpawned(e.key), `${e.key} 最終會生出過多單位`).toBeLessThanOrEqual(12)
    }
  })

  it('每個 trait 都有對應的應對手段與中文標籤', () => {
    const traits = new Set<EnemyTrait>()
    for (const e of ENEMIES) for (const t of e.traits) traits.add(t)
    for (const t of traits) {
      expect(TRAIT_COUNTERS[t]?.length, `trait ${t} 沒有對應手段`).toBeGreaterThan(0)
      expect(TRAIT_LABEL[t]).toBeTruthy()
      for (const c of TRAIT_COUNTERS[t]) expect(COUNTER_LABEL[c]).toBeTruthy()
    }
  })
})

describe('新敵人機制', () => {
  it('妖道的回血光環會治療附近的敵人，但不治療自己以外的滿血目標', () => {
    const s = createGame('julu', 1)
    const healer = spawn(s, 'shaman', { dist: 3 })
    const hurt = spawn(s, 'thief', { dist: 3, hp: 5000 })
    const before = hurt.hp
    for (let i = 0; i < 60; i++) stepGame(s, 1 / 60)
    expect(hurt.hp).toBeGreaterThan(before)
    expect(hurt.hp).toBeLessThanOrEqual(hurt.maxHp)
    expect(healer.hp).toBeGreaterThan(0)
  })

  it('再生將會回復自身血量，且不超過上限', () => {
    const s = createGame('julu', 1)
    const boss = spawn(s, 'bossRegen', { dist: 3, hp: 5000 })
    for (let i = 0; i < 60; i++) stepGame(s, 1 / 60)
    expect(boss.hp).toBeGreaterThan(5000)
    expect(boss.hp).toBeLessThanOrEqual(boss.maxHp)
  })

  it('分裂賊死亡時分裂出小怪，且小怪不會再分裂', () => {
    const s = createGame('julu', 1)
    const e = spawn(s, 'splitter', { dist: 3, hp: 1 })
    e.hp = 0 // 直接判死，讓 cleanupDead 處理分裂
    stepGame(s, 1 / 60)
    const kids = s.enemies.filter((x) => x.defKey === 'swarmlet')
    expect(kids.length).toBe(ENEMY_BY_KEY['splitter'].splitInto!.count)
    expect(s.enemies.some((x) => x.defKey === 'splitter')).toBe(false)

    // 再殺掉小怪，不應該又生出東西
    const n = s.enemies.length
    for (const k of kids) k.hp = 0
    stepGame(s, 1 / 60)
    expect(s.enemies.length).toBeLessThan(n)
  })

  it('分裂賊漏過大營時不會在終點刷出必漏的小怪', () => {
    const s = createGame('julu', 1)
    const goal = s.board.path.length - 1
    spawn(s, 'splitter', { dist: goal - 0.001, speed: 100, hp: 100 })
    stepGame(s, 1 / 60)
    expect(s.enemies.filter((x) => x.defKey === 'swarmlet').length).toBe(0)
  })

  it('burnImmune 擋掉灼燒，slowImmune 擋掉減速，但都擋不住易傷', () => {
    const s = createGame('julu', 1)
    const iron = spawn(s, 'bossIron')
    const gale = spawn(s, 'gale')

    applyStatus(s, iron, { burn: { mul: 1, dur: 5 }, vulnDur: 3 }, 100)
    expect(iron.burnT).toBe(0)
    expect(iron.vuln).toBeGreaterThan(0)

    applyStatus(s, gale, { slowDur: 3, vulnDur: 3 }, 100)
    expect(gale.slow).toBe(0)
    expect(gale.vuln).toBeGreaterThan(0)
  })

  it('沒有免疫的敵人照樣會被灼燒與減速', () => {
    const s = createGame('julu', 1)
    const e = spawn(s, 'thief')
    applyStatus(s, e, { burn: { mul: 1, dur: 5 }, slowDur: 3 }, 100)
    expect(e.burnT).toBeGreaterThan(0)
    expect(e.slow).toBeGreaterThan(0)
  })
})

describe('波次組成與 BOSS 挑選', () => {
  it('BOSS 波會生成一隻 BOSS，非 BOSS 波不會', () => {
    const bossKeys = new Set(BOSSES.map((b) => b.key))
    const w5 = buildWave(5, mulberry32(1), 1)
    const w6 = buildWave(6, mulberry32(1), 1)
    expect(isBossWave(5)).toBe(true)
    expect(w5.filter((e) => bossKeys.has(e.defKey)).length).toBe(1)
    expect(w6.some((e) => bossKeys.has(e.defKey))).toBe(false)
  })

  it('同一顆種子產生同一波（決定性）', () => {
    expect(buildWave(20, mulberry32(7), 1.2, ['swarm'])).toEqual(
      buildWave(20, mulberry32(7), 1.2, ['swarm']),
    )
  })

  it('不同種子會挑到不同的 BOSS（隨機性確實生效）', () => {
    const picked = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) picked.add(pickBoss(30, mulberry32(seed * 977)).key)
    expect(picked.size).toBeGreaterThan(3)
  })

  it('minWave 會把強力敵種擋在前期', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const entry of buildWave(3, mulberry32(seed), 1)) {
        const def = ENEMY_BY_KEY[entry.defKey]
        expect(def.minWave ?? 0, `第 3 波不該出現 ${def.key}`).toBeLessThanOrEqual(3)
      }
    }
  })

  it('關卡偏好會明顯提高該類敵人的出現率', () => {
    const count = (bias: EnemyTrait[]) => {
      let hit = 0
      let total = 0
      for (let seed = 1; seed <= 40; seed++) {
        for (const entry of buildWave(20, mulberry32(seed * 31), 1, bias)) {
          const def = ENEMY_BY_KEY[entry.defKey]
          if (def.boss) continue
          total++
          if (def.traits.includes('swarm')) hit++
        }
      }
      return hit / total
    }
    expect(count(['swarm'])).toBeGreaterThan(count([]) * 1.8)
  })

  it('帶 escort 的 BOSS 會連護衛一起排進生成隊列', () => {
    const withEscort = BOSSES.find((b) => b.escort)!
    // 反覆抽到該 BOSS 為止，再確認護衛數量
    for (let seed = 1; seed <= 400; seed++) {
      const rng = mulberry32(seed)
      const wave = buildWave(30, rng, 1)
      if (!wave.some((e) => e.defKey === withEscort.key)) continue
      const escorts = wave.filter((e) => e.defKey === withEscort.escort!.key).length
      expect(escorts).toBeGreaterThanOrEqual(withEscort.escort!.count)
      return
    }
    throw new Error('400 顆種子都沒抽到帶護衛的 BOSS，請檢查 pickBoss')
  })
})

describe('關卡偏好與推薦手段', () => {
  it('countersFor 由 bias 推導，且去重、順序穩定', () => {
    expect(countersFor(['swarm'])).toEqual(['splash', 'pierce'])
    expect(countersFor(['swarm', 'splitter'])).toEqual(['splash', 'pierce'])
    expect(countersFor([])).toEqual([])
    expect(countersFor(['armored', 'tanky'])).toEqual(['dot', 'single'])
  })

  it('每個關卡的 bias 都是合法 trait，且能推導出推薦手段（教學關除外）', () => {
    for (const key of LEVEL_ORDER) {
      const level = LEVELS[key]
      for (const t of level.bias ?? []) {
        expect(TRAIT_COUNTERS[t], `${key} 的 bias「${t}」不是合法 trait`).toBeTruthy()
      }
      if (key !== 'huangjin') {
        expect(countersFor(level.bias).length, `${key} 應該要有推薦手段`).toBeGreaterThan(0)
      }
    }
  })

  it('每個 bias 用到的 trait 都有對應的敵人可以出場', () => {
    for (const key of LEVEL_ORDER) {
      for (const t of LEVELS[key].bias ?? []) {
        const has = ENEMIES.some((e) => e.traits.includes(t))
        expect(has, `${key} 偏好「${t}」但沒有任何敵人帶這個 trait`).toBe(true)
      }
    }
  })

  it('createGame 會把關卡 bias 帶進 GameState', () => {
    expect(createGame('julu', 1).bias).toEqual(LEVELS.julu.bias)
    expect(createGame('luoyang', 1).bias).toEqual(LEVELS.luoyang.bias)
  })
})
