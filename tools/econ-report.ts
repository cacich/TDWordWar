/**
 * 經濟儀表板：跑一局傻 AI，逐波印出「收入來源拆解 × 征兵次數 × 戰力對比」。
 *
 * 與 autobalance.ts 的分工：
 *   npm run sim   —— 只回答「難不難」（陣亡波次分佈），是驗收用的
 *   npm run econ  —— 回答「為什麼難」（糧從哪來、夠征幾次兵、dps 追不追得上血量）
 *
 * 調經濟數值時看這三欄：
 *   征兵      每波征兵次數。設計目標 1～2 次
 *   賞金      擊殺收入。它一向是最大的收入來源，改 bounty 的影響遠大於改 waveIncome
 *   dps/血    場上總 dps ÷ 該波敵人總血量。跌破 ~0.3 之後基本上守不住，是崩盤的先行指標
 */
import { createGame } from '../src/sim/state'
import { stepGame } from '../src/sim/step'
import { enemyBaseHp, enemyCount } from '../src/sim/waves'
import { candidateCells, playPrep } from './dumb-ai'
import type { GameState } from '../src/sim/types'

const LEVEL = process.argv[2] ?? 'julu'
const SEED = Number(process.argv[3] ?? 12345)
const FIXED_DT = 1 / 60

/** 場上總 dps。已成為武將成員的字牌不重複計算（與 stepCombat 同一條規則） */
function totalDps(s: GameState): number {
  let d = 0
  for (const u of s.units) {
    if (u.kind === 'glyph' && u.formIds.length > 0) continue
    if (u.atk <= 0 || u.aps <= 0) continue
    d += u.atk * u.aps
  }
  return d
}

const state = createGame(LEVEL, SEED)
/** 無盡模式的 maxWave 是 Infinity，印出來會是 "Infinity" */
const waveTotal = Number.isFinite(state.maxWave) ? String(state.maxWave) : '∞'
const cells = candidateCells(state)
let guard = 0
let lastWave = state.wave
let lastEarned = 0
let recruits = 0
let spent = 0
const recruitLog: number[] = []

console.log(`\n=== 經濟儀表板：${LEVEL} seed=${SEED}（maxWave ${waveTotal}）===`)
console.log('波 | 征兵 花費 | 固定 產糧  賞金 =  總收 | 存糧 |    dps    敵總血  dps/血')

while (state.phase !== 'lost' && state.phase !== 'won' && guard++ < 60 * 60 * 40) {
  if (state.phase === 'prep') {
    const recruitsBefore = state.recruitsThisWave
    const foodBefore = state.food
    playPrep(state, cells)
    recruits += state.recruitsThisWave - recruitsBefore
    spent += Math.max(0, foodBefore - state.food)
  }
  stepGame(state, FIXED_DT)

  if (state.wave !== lastWave) {
    const w = lastWave
    const bounty = state.stats.foodEarned - lastEarned
    lastEarned = state.stats.foodEarned
    const { base, units } = state.lastIncome
    const eHp = enemyBaseHp(w, state.maxWave) * state.hpMul * enemyCount(w)
    const dps = totalDps(state)
    recruitLog.push(recruits)
    console.log(
      `${String(w).padStart(2)} | ${String(recruits).padStart(4)} ${String(spent).padStart(5)} | ` +
        `${String(base).padStart(4)} ${String(units).padStart(4)} ${String(bounty).padStart(5)} = ${String(base + units + bounty).padStart(6)} | ` +
        `${String(Math.round(state.food)).padStart(4)} | ${String(Math.round(dps)).padStart(6)} ${String(Math.round(eHp)).padStart(9)} ` +
        `${(dps / eHp).toFixed(3)}`,
    )
    recruits = 0
    spent = 0
    lastWave = state.wave
  }
}

const avgRecruit = recruitLog.length ? recruitLog.reduce((a, b) => a + b, 0) / recruitLog.length : 0
console.log(`\n結果：${state.phase} 於第 ${state.wave} 波 / ${waveTotal}`)
console.log(`每波平均征兵 ${avgRecruit.toFixed(2)} 次（設計目標 1～2）\n`)
