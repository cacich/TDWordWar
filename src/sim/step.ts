/**
 * 每個模擬步的推進。固定步長 1/60 秒由 core/loop.ts 呼叫。
 * 此檔不可 import render/DOM。
 */
import { ENEMY_BY_KEY } from '../data/enemies'
import { beginBattle } from './actions'
import { stepBondSkills } from './bonds'
import { SLOW_FACTOR, damageEnemy, stepCombat, stepEffects } from './combat'
import { unitIncome, waveIncome } from './economy'
import { stepSkills } from './skills'
import { emit } from './events'
import { PREP_SECONDS } from './waves'
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
  stepEffects(state, dt)
  cleanupDead(state)
  checkWaveEnd(state)
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
    e.dist += e.speed * slowMul * dt
    if (e.dist >= goal) {
      e.hp = 0
      e.dist = goal
      state.lives -= e.damage
      state.stats.leaks++
      emit(state, { kind: 'leak' })
      if (state.lives <= 0) {
        state.lives = 0
        state.phase = 'lost'
        emit(state, { kind: 'lost' })
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
  state.lastIncome = { base: waveIncome(state.wave), units: unitIncome(state) }
  state.food += state.lastIncome.base + state.lastIncome.units
  if (state.wave >= state.maxWave) {
    state.phase = 'won'
    emit(state, { kind: 'won' })
    return
  }
  emit(state, { kind: 'waveClear', wave: state.wave })
  state.wave++
  state.recruitsThisWave = 0
  state.phase = 'prep'
  state.prepTimer = PREP_SECONDS
}
