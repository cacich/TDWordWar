/**
 * AI 代管的成績儀表板：`npm run ai`
 *
 * 跑的是遊戲內「AI 代管」開關背後**同一份** `src/sim/autoplay.ts`，
 * 所以這裡量到的通關率就是玩家開開關會得到的表現。
 *
 * ⚠ 這**不是**難度儀表板。難度基準永遠看 `npm run sim`（傻 AI，目標＝總波數一半）。
 * 這支工具回答的是另一個問題：「代管 AI 打得動嗎？」
 * 目標：主線九關的通關率都不低於 80%。
 *
 *   npm run ai              # 九關各 8 局
 *   npm run ai 12           # 九關各 12 局
 *   npm run ai 12 guandu    # 只跑官渡 12 局
 */
import { mulberry32 } from '../src/core/rng'
import { LEVELS, LEVEL_ORDER } from '../src/data/levels'
import { createBrain, stepAuto } from '../src/sim/autoplay'
import { createGame } from '../src/sim/state'
import { stepGame } from '../src/sim/step'
import { WAVE_REF } from '../src/sim/waves'

const GAMES = Number(process.argv[2] ?? 8)
const ONLY = process.argv[3]
const FIXED_DT = 1 / 60
/** 無盡變體沒有終點，跑到參考弧的兩倍就收工，否則工具永遠不會結束 */
const WAVE_CAP = WAVE_REF * 2

interface Result {
  wave: number
  won: boolean
  kills: number
  units: number
  generals: number
  bonds: number
}

function playOne(levelKey: string, seed: number): Result {
  const state = createGame(levelKey, seed)
  const brain = createBrain()
  let guard = 0

  while (state.phase !== 'lost' && state.phase !== 'won' && guard++ < 60 * 60 * 90) {
    stepAuto(brain, state, FIXED_DT)
    stepGame(state, FIXED_DT)
    if (state.wave > WAVE_CAP) break
  }

  return {
    wave: state.wave,
    won: state.phase === 'won',
    kills: state.stats.kills,
    units: state.units.filter((u) => u.kind === 'glyph').length,
    generals: state.units.filter((u) => u.kind === 'general').length,
    bonds: state.activeBonds.length,
  }
}

const keys = ONLY ? [ONLY] : [...LEVEL_ORDER]
const started = Date.now()

console.log(`\n=== AI 代管成績：每關 ${GAMES} 局 ===`)
console.log('關卡        波數      通關率   平均擊殺  終局字牌/武將/羈絆')

let totalWon = 0
let totalGames = 0

for (const key of keys) {
  const level = LEVELS[key]
  if (!level) {
    console.log(`未知關卡：${key}`)
    continue
  }
  const rng = mulberry32(20260730)
  const rows: Result[] = []
  for (let i = 0; i < GAMES; i++) rows.push(playOne(key, Math.floor(rng() * 1e9)))

  const waves = rows.map((r) => r.wave).sort((a, b) => a - b)
  const median = waves[Math.floor(waves.length / 2)]
  const won = rows.filter((r) => r.won).length
  const avg = (pick: (r: Result) => number) => rows.reduce((s, r) => s + pick(r), 0) / rows.length
  totalWon += won
  totalGames += rows.length

  const name = `${level.name}`.padEnd(6, '　')
  const total = Number.isFinite(level.maxWave) ? String(level.maxWave) : '∞'
  console.log(
    `${name} ${String(median).padStart(3)}/${total.padEnd(4)}` +
      ` ${`${Math.round((won / rows.length) * 100)}%`.padStart(7)}` +
      ` ${avg((r) => r.kills).toFixed(0).padStart(9)}` +
      `   ${avg((r) => r.units).toFixed(0)} / ${avg((r) => r.generals).toFixed(1)} / ${avg((r) => r.bonds).toFixed(1)}`,
  )
}

console.log(
  `\n總通關率 ${Math.round((totalWon / totalGames) * 100)}%（${totalWon}/${totalGames}）` +
    `　耗時 ${((Date.now() - started) / 1000).toFixed(1)}s`,
)
console.log('目標：主線九關的通關率都 ≥ 80%。低於此值請調 src/sim/autoplay.ts 的旋鈕區，不要動關卡數值。\n')
