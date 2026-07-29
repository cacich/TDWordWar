/**
 * 每個模擬步的推進。固定步長 1/60 秒由 core/loop.ts 呼叫。
 * 此檔不可 import render/DOM。
 */
import { ENEMY_BY_KEY } from '../data/enemies'
import { beginBattle } from './actions'
import { stepBondSkills } from './bonds'
import { SLOW_FACTOR, damageEnemy, enemyPos, pushEffect, stepCombat, stepEffects } from './combat'
import { unitIncome, waveIncome } from './economy'
import { stepSkills } from './skills'
import { emit } from './events'
import { PREP_SECONDS, enemyBaseHp } from './waves'
import type { Enemy, GameState } from './types'

export function stepGame(state: GameState, dt: number): void {
  if (state.phase === 'won' || state.phase === 'lost') return
  state.time += dt

  if (state.phase === 'prep') {
    state.prepTimer -= dt
    if (state.prepTimer <= 0) beginBattle(state)
    stepEffects(state, dt)
    return
  }

  state.waveTime += dt
  for (const u of state.units) if (u.atkFlash > 0) u.atkFlash -= dt
  spawnDue(state)
  stepStatuses(state, dt)
  stepEnemySupport(state, dt)
  moveEnemies(state, dt)
  stepCombat(state, dt)
  stepSkills(state, dt)
  stepBondSkills(state, dt)
  stepMeteor(state, dt)
  stepEffects(state, dt)
  cleanupDead(state)
  checkWaveEnd(state)
}

/**
 * 流星火雨（局外道具「流星火雨」）：戰鬥中每隔一段時間，對最前方那群敵人降下火球。
 * 傷害綁在 enemyBaseHp 上，才能跟著波次的指數血量一起成長、後期不失效。
 */
function stepMeteor(state: GameState, dt: number): void {
  if (state.perks.meteorInterval <= 0) return
  state.meteorTimer -= dt
  if (state.meteorTimer > 0) return
  state.meteorTimer += state.perks.meteorInterval

  const alive = state.enemies.filter((e) => e.hp > 0)
  if (!alive.length) return
  let front = alive[0]
  for (const e of alive) if (e.dist > front.dist) front = e
  const c = enemyPos(state.board, front)
  const dmg = 0.7 * enemyBaseHp(state.wave, state.maxWave) * state.hpMul
  for (const e of alive) {
    const p = enemyPos(state.board, e)
    if (Math.hypot(p.x - c.x, p.y - c.y) > 1.5) continue
    damageEnemy(state, e, dmg)
    if (e.hp > 0) {
      e.burnT = Math.max(e.burnT, 3)
      e.burnDps = Math.max(e.burnDps, dmg * 0.12)
    }
  }
  emit(state, { kind: 'skill', name: '流星火雨', x: c.x, y: c.y })
  pushEffect(state.effects, { kind: 'splash', fromX: c.x, fromY: c.y, toX: c.x, toY: c.y, life: 0.35, maxLife: 0.35, fx: 'fire' })
  pushEffect(state.effects, { kind: 'ring', fromX: c.x, fromY: c.y, toX: c.x + 1.5, toY: c.y, life: 0.35, maxLife: 0.35, color: '#c8502a' })
}

/** 依敵表建立一隻執行期敵人。分裂出的小怪也走這裡，避免欄位漏填 */
function makeEnemy(state: GameState, defKey: string, hp: number, dist = 0): Enemy {
  const def = ENEMY_BY_KEY[defKey]
  return {
    id: state.nextEnemyId++,
    defKey: def.key,
    char: def.char,
    hp,
    maxHp: hp,
    def: def.def,
    speed: def.speed,
    flying: def.flying,
    bounty: def.bounty,
    damage: def.damage,
    troop: def.troop,
    ccImmune: def.ccImmune ?? false,
    burnImmune: def.burnImmune ?? false,
    slowImmune: def.slowImmune ?? false,
    dist,
    hitFlash: 0,
    slow: 0,
    stun: 0,
    vuln: 0,
    burnT: 0,
    burnDps: 0,
  }
}

function spawnDue(state: GameState): void {
  while (state.spawnQueue.length && state.spawnQueue[0].at <= state.waveTime) {
    const entry = state.spawnQueue.shift()!
    state.enemies.push(makeEnemy(state, entry.defKey, entry.hp))
  }
}

/**
 * 敵方的支援行為：妖道系的回血光環與 BOSS 的自我再生。
 * 兩者都以「最大血量的比例」計算，才能跟著波次的指數血量一起成長、後期不失效。
 * 放在 stepStatuses（灼燒）之後，讓灼燒與回血在同一幀正面對撞。
 */
function stepEnemySupport(state: GameState, dt: number): void {
  for (const e of state.enemies) {
    if (e.hp <= 0) continue
    const def = ENEMY_BY_KEY[e.defKey]

    if (def.regen) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * def.regen * dt)
    }

    if (def.healAura) {
      const c = enemyPos(state.board, e)
      for (const other of state.enemies) {
        if (other === e || other.hp <= 0 || other.hp >= other.maxHp) continue
        const p = enemyPos(state.board, other)
        if (Math.hypot(p.x - c.x, p.y - c.y) > def.healAura.radius) continue
        other.hp = Math.min(other.maxHp, other.hp + other.maxHp * def.healAura.hps * dt)
      }
    }
  }
}

/** 控場狀態倒數與持續傷害。在移動之前跑，定身當幀就生效 */
function stepStatuses(state: GameState, dt: number): void {
  for (const e of state.enemies) {
    if (e.hp <= 0) continue
    if (e.hitFlash > 0) e.hitFlash -= dt
    if (e.slow > 0) e.slow -= dt
    if (e.stun > 0) e.stun -= dt
    if (e.vuln > 0) e.vuln -= dt
    if (e.burnT > 0) {
      e.burnT -= dt
      damageEnemy(state, e, e.burnDps * dt)
      if (e.burnT <= 0) e.burnDps = 0
    }
  }
}

function moveEnemies(state: GameState, dt: number): void {
  const goal = state.board.path.length - 1
  for (const e of state.enemies) {
    if (e.hp <= 0) continue
    if (e.stun > 0) continue // 定身中不前進
    const slowMul = e.slow > 0 ? SLOW_FACTOR : 1
    // 沼澤泥沼：全域敵速倍率，中性值 1 時完全不影響原本速度
    e.dist += e.speed * slowMul * state.perks.enemySpeedMul * dt
    if (e.dist >= goal) {
      e.hp = 0
      e.dist = goal
      state.stats.leaks++
      emit(state, { kind: 'leak' })
      // 回魂旗：機率不扣血命，敵人依然算漏過（stats.leaks 照計）
      if (state.rng() >= state.perks.leakBlockChance) {
        state.lives -= e.damage
        if (state.lives <= 0) {
          state.lives = 0
          state.phase = 'lost'
          emit(state, { kind: 'lost' })
        }
      }
    }
  }
}

/**
 * 移除死亡敵人，並處理死亡分裂。
 *
 * ⚠ 分裂**必須**在這裡做，不能在傷害來源那邊直接 push：
 *   stepCombat／stepStatuses 都在迭代 state.enemies，當場新增會造成
 *   「剛分裂出來的小怪在同一幀又被打死再分裂」的連鎖。
 *   這裡是每幀唯一一次、且在所有傷害結算之後的安全點。
 *   **允許多層分裂**（分裂將 → 分裂賊 → 蟻賊）：子代死亡是在後續的幀才結算，
 *   每一層都各自走過一次完整的傷害流程，所以不會在同一幀爆炸性增殖。
 *   安全性靠「分裂圖必須是無環的有限圖」保證——蟻賊沒有 splitInto，鏈一定終止。
 *   ⚠ 新增 splitInto 時**絕對不能形成環**（A→B→A 會無限增殖）；
 *   enemies-ext.test.ts 有測試驗證分裂圖無環。
 */
function cleanupDead(state: GameState): void {
  if (!state.enemies.some((e) => e.hp <= 0)) return

  const born: Enemy[] = []
  for (const e of state.enemies) {
    if (e.hp > 0) continue
    const split = ENEMY_BY_KEY[e.defKey].splitInto
    // 漏過大營的敵人（dist 已到終點）不該再分裂，否則會在終點刷出一批必漏的小怪
    if (!split || e.dist >= state.board.path.length - 1) continue
    const childDef = ENEMY_BY_KEY[split.key]
    if (!childDef) continue
    // 子代血量以「母體出生血量」換算，才會跟著波次成長；沿路徑稍微散開避免完全重疊
    const childHp = Math.max(1, Math.round((e.maxHp / ENEMY_BY_KEY[e.defKey].hpMul) * childDef.hpMul))
    for (let i = 0; i < split.count; i++) {
      born.push(makeEnemy(state, split.key, childHp, Math.max(0, e.dist - i * 0.25)))
    }
  }

  state.enemies = state.enemies.filter((e) => e.hp > 0)
  for (const b of born) state.enemies.push(b)
}

function checkWaveEnd(state: GameState): void {
  if (state.spawnQueue.length || state.enemies.length) return
  // 糧道暢通：固定收入 ×incomeMul（產糧不受影響）
  state.lastIncome = {
    base: Math.round(waveIncome(state.wave) * state.perks.incomeMul),
    units: unitIncome(state),
  }
  state.food += state.lastIncome.base + state.lastIncome.units
  if (state.wave >= state.maxWave) {
    state.phase = 'won'
    emit(state, { kind: 'won' })
    return
  }
  // 杏林春暖：每通過 N 波回 1 生命（以剛清掉的這一波計）
  if (
    state.perks.healEveryWaves > 0 &&
    state.wave % state.perks.healEveryWaves === 0 &&
    state.lives < state.maxLives
  ) {
    state.lives = Math.min(state.maxLives, state.lives + 1)
  }
  emit(state, { kind: 'waveClear', wave: state.wave })
  state.wave++
  state.recruitsThisWave = 0
  state.phase = 'prep'
  state.prepTimer = PREP_SECONDS
}
