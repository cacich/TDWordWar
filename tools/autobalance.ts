/**
 * 自動平衡模擬：讓一個「傻 AI」用固定策略打完整局，統計陣亡波次。
 * 因為 sim/ 完全不依賴 DOM，可以直接在 Node 跑：npm run sim
 *
 * 用途：改完數值後跑一次，看難度曲線有沒有歪掉，而不是靠手感猜。
 *
 *   npm run sim              # 單關（預設巨鹿）30 局，含直方圖
 *   npm run sim 16 guandu    # 指定局數與關卡（無盡：endless_guandu）
 *   npm run sim 12 all       # ★ 九關的難度曲線一次看完（每關 12 局）
 *
 * 目標不是「每關都一樣」：`arc`（難度弧長度，見 data/levels）決定每一關的預期比例，
 * 這裡直接印出「實際比例 vs arc 換算出的預期比例」，所以偏差看的是**曲線**而不是單點。
 */
import { mulberry32 } from '../src/core/rng'
import { LEVELS, LEVEL_ORDER } from '../src/data/levels'
import { createGame } from '../src/sim/state'
import { stepGame } from '../src/sim/step'
import { WAVE_REF } from '../src/sim/waves'
import { candidateCells, playPrep } from './dumb-ai'

const GAMES = Number(process.argv[2] ?? 30)
/** 第二個參數選關：npm run sim 30 guandu；`all` = 跑完主線九關 */
const LEVEL = process.argv[3] ?? 'julu'
const FIXED_DT = 1 / 60

/**
 * 傻 AI 大約死在難度弧上的第幾個參考波。**經驗常數**，是把 `arc` 換算成
 * 「預期陣亡比例」的橋：預期中位數 ≈ maxWave × DEATH_REF / arc。
 * 它會隨玩家端的平衡（字表、羈絆、射程）漂移；整條曲線一起偏移時就是該更新這個數字，
 * 而不是去改九關的 arc。
 */
const DEATH_REF = 20

function playOne(levelKey: string, seed: number): { wave: number; won: boolean } {
  const state = createGame(levelKey, seed)
  const cells = candidateCells(state)
  let guard = 0

  while (state.phase !== 'lost' && state.phase !== 'won' && guard++ < 60 * 60 * 40) {
    if (state.phase === 'prep') playPrep(state, cells)
    stepGame(state, FIXED_DT)
  }

  return { wave: state.wave, won: state.phase === 'won' }
}

function run(levelKey: string): { median: number; results: number[]; won: number } {
  const rng = mulberry32(20260727)
  const results: number[] = []
  let won = 0
  for (let i = 0; i < GAMES; i++) {
    const r = playOne(levelKey, Math.floor(rng() * 1e9))
    results.push(r.wave)
    if (r.won) won++
  }
  results.sort((a, b) => a - b)
  return { median: results[Math.floor(results.length / 2)], results, won }
}

/** 該關的預期陣亡波次（由 arc 換算）。無盡沒有終點，走的就是完整參考弧 */
function targetOf(levelKey: string): number {
  const lv = LEVELS[levelKey]
  const span = Number.isFinite(lv.maxWave) ? lv.maxWave : WAVE_REF
  const arc = Number.isFinite(lv.maxWave) ? lv.arc : WAVE_REF
  return (span * DEATH_REF) / arc
}

if (LEVEL === 'all') {
  console.log(`\n=== 難度曲線：主線九關 × ${GAMES} 局（傻 AI）===`)
  console.log('關卡        arc  中位數/總波   比例   預期   偏差   通關率')
  for (const key of LEVEL_ORDER) {
    const lv = LEVELS[key]
    const { median, won } = run(key)
    const target = targetOf(key)
    const dev = ((median - target) / target) * 100
    console.log(
      `${lv.name.padEnd(6, '　')} ${String(lv.arc).padStart(3)}` +
        ` ${String(median).padStart(6)}/${String(lv.maxWave).padEnd(3)}` +
        ` ${(median / lv.maxWave).toFixed(2).padStart(7)}` +
        ` ${(target / lv.maxWave).toFixed(2).padStart(6)}` +
        ` ${`${dev >= 0 ? '+' : ''}${dev.toFixed(0)}%`.padStart(6)}` +
        ` ${`${Math.round((won / GAMES) * 100)}%`.padStart(7)}`,
    )
  }
  console.log(
    '\n「比例」應該一路遞減（越後面的關卡越難）；某一關偏差超過 ±20% 就調那一關的 arc。' +
      '\n整條曲線一起偏移＝玩家端的平衡動了，改 tools/autobalance.ts 的 DEATH_REF，不要九關一起改。\n',
  )
} else {
  const { median, results, won } = run(LEVEL)
  const avg = results.reduce((a, b) => a + b, 0) / results.length

  console.log(`\n=== 自動平衡：${LEVEL} × ${GAMES} 局 ===`)
  console.log(
    `陣亡／完成波次  平均 ${avg.toFixed(1)}  中位數 ${median}  最低 ${results[0]}  最高 ${results[results.length - 1]}` +
      `  通關率 ${Math.round((won / results.length) * 100)}%`,
  )

  const hist = new Map<number, number>()
  for (const w of results) {
    const bucket = Math.floor(w / 5) * 5
    hist.set(bucket, (hist.get(bucket) ?? 0) + 1)
  }
  for (const [bucket, n] of [...hist.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`第 ${String(bucket).padStart(2)}–${bucket + 4} 波  ${'█'.repeat(n)} ${n}`)
  }

  const target = targetOf(LEVEL)
  const dev = ((median - target) / target) * 100
  console.log(
    `\n目標：由 arc = ${LEVELS[LEVEL].arc} 換算 ≈ ${target.toFixed(1)} 波　實際 ${median}` +
      `　偏差 ${dev >= 0 ? '+' : ''}${dev.toFixed(0)}%` +
      `\n（±20% 內算達標；太高表示這一關太簡單，太低表示太硬——調該關的 arc）\n`,
  )
}
