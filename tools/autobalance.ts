/**
 * 自動平衡模擬：讓一個「傻 AI」用固定策略打完整局，統計陣亡波次。
 * 因為 sim/ 完全不依賴 DOM，可以直接在 Node 跑：npm run sim
 *
 * 用途：改完數值後跑一次，看難度曲線有沒有歪掉，而不是靠手感猜。
 */
import { mulberry32 } from '../src/core/rng'
import { LEVELS } from '../src/data/levels'
import { createGame } from '../src/sim/state'
import { stepGame } from '../src/sim/step'
import { WAVE_REF } from '../src/sim/waves'
import { candidateCells, playPrep } from './dumb-ai'

const GAMES = Number(process.argv[2] ?? 30)
/** 第二個參數選關：npm run sim 30 guandu */
const LEVEL = process.argv[3] ?? 'julu'
const FIXED_DT = 1 / 60

function playOne(seed: number): { wave: number; kills: number; units: number } {
  const state = createGame(LEVEL, seed)
  const cells = candidateCells(state)
  let guard = 0

  while (state.phase !== 'lost' && state.phase !== 'won' && guard++ < 60 * 60 * 40) {
    if (state.phase === 'prep') playPrep(state, cells)
    stepGame(state, FIXED_DT)
  }

  return { wave: state.wave, kills: state.stats.kills, units: state.units.length }
}

const rng = mulberry32(20260727)
const results: number[] = []
for (let i = 0; i < GAMES; i++) {
  const seed = Math.floor(rng() * 1e9)
  const r = playOne(seed)
  results.push(r.wave)
}

results.sort((a, b) => a - b)
const avg = results.reduce((a, b) => a + b, 0) / results.length
const median = results[Math.floor(results.length / 2)]

console.log(`\n=== 自動平衡：${LEVEL} × ${GAMES} 局 ===`)
console.log(`陣亡／完成波次  平均 ${avg.toFixed(1)}  中位數 ${median}  最低 ${results[0]}  最高 ${results[results.length - 1]}`)

const hist = new Map<number, number>()
for (const w of results) {
  const bucket = Math.floor(w / 5) * 5
  hist.set(bucket, (hist.get(bucket) ?? 0) + 1)
}
for (const [bucket, n] of [...hist.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`第 ${String(bucket).padStart(2)}–${bucket + 4} 波  ${'█'.repeat(n)} ${n}`)
}
// 目標是「總波數的一半」而不是固定波次：血量的指數吃的是相對進度（見 waves.ts 的 WAVE_REF），
// 所以不論關卡多長，傻 AI 都應該死在中段。偏差 ±20% 內算達標，超出才需要動該關的 hpMul。
// 無盡模式（maxWave = Infinity）沒有「總波數」，它走的就是 WAVE_REF 這條參考弧 → 目標同樣取一半。
const maxWave = LEVELS[LEVEL].maxWave
const target = (Number.isFinite(maxWave) ? maxWave : WAVE_REF) / 2
const dev = ((median - target) / target) * 100
console.log(
  `\n目標：中位數 ≈ 總波數一半 = ${target}　實際 ${median}　偏差 ${dev >= 0 ? '+' : ''}${dev.toFixed(0)}%` +
    `\n（±20% 內算達標；太高表示太簡單，太低表示前期太硬）\n`,
)
