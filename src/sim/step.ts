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
  const dmg = 0.7 * enemyBaseHp(state.wave) * state.hpMul
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

function spawnDue(state: GameState): void {
  while (state.spawnQueue.length && state.spawnQueue[0].at <= state.waveTime) {
    const entry = state.spawnQueue.shift()!
    const def = ENEMY_BY_KEY[entry.defKey]
    const e: Enemy = {
      id: state.nextEnemyId++,
      defKey: def.key,
      char: def.char,
      hp: entry.hp,
      maxHp: entry.hp,
      def: def.def,
      speed: def.speed,
      flying: def.flying,
      bounty: def.bounty,
      damage: def.damage,
      troop: def.troop,
      ccImmune: def.ccImmune ?? false,
      dist: 0,
      hitFlash: 0,
      slow: 0,
      stun: 0,
      vuln: 0,
      burnT: 0,
      burnDps: 0,
    }
    state.enemies.push(e)
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

function cleanupDead(state: GameState): void {
  if (state.enemies.some((e) => e.hp <= 0)) {
    state.enemies = state.enemies.filter((e) => e.hp > 0)
  }
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
