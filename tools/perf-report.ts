/**
 * 效能儀表板：`npm run perf`
 *
 * 回答「開著 AI 代管長時間玩，CPU 花在哪裡」——也就是**手機發熱**的量表。
 * 因為 `sim/` 不依賴 DOM，這裡量到的是純邏輯成本（模擬 + AI 決策），
 * 呈現層（canvas／DOM）量不到，那部分要用瀏覽器的 Performance 面板看。
 *
 * 三個數字的意義：
 *   ms/輪   一次 AI 決策的成本。**這是主角**：它比一幀模擬貴兩三個數量級，
 *           每 THINK_INTERVAL（1.2 模擬秒）發生一次，3× 速時頻率也 ×3。
 *   µs/步   一幀模擬的成本。60fps 下 ×60 就是每秒的模擬負擔。
 *   佔比    AI 決策佔「模擬 + AI」的比例。它一直是大頭；真的降不下去時才考慮拉長間隔。
 *
 *   npm run perf                 # 三關（小／中／大棋盤）各 3 局、每局最多 6 分鐘模擬時間
 *   npm run perf 2 luoyang       # 指定局數與關卡
 */
import { createBrain, stepAuto } from '../src/sim/autoplay'
import { createGame } from '../src/sim/state'
import { stepGame } from '../src/sim/step'

const GAMES = Number(process.argv[2] ?? 3)
const ONLY = process.argv[3]
const FIXED_DT = 1 / 60
/** 每局最多模擬這麼多步（6 分鐘遊戲時間），提早分出勝負就結束 */
const STEPS = 60 * 60 * 6
/** 棋盤大小與字池差異最大的三關，成本的上下界都在裡面 */
const LEVELS = ONLY ? [ONLY] : ['huangjin', 'julu', 'luoyang']

console.log(`\n=== 效能儀表板：每關 ${GAMES} 局（模擬 + AI 代管）===`)
console.log('關卡        AI 決策            模擬                AI 佔比')

for (const key of LEVELS) {
  let think = 0
  let sim = 0
  let thinks = 0
  let steps = 0
  for (let i = 0; i < GAMES; i++) {
    const state = createGame(key, 11 + i * 11)
    const brain = createBrain()
    for (let n = 0; n < STEPS; n++) {
      if (state.phase === 'won' || state.phase === 'lost') break
      const before = brain.cooldown
      let t = process.hrtime.bigint()
      stepAuto(brain, state, FIXED_DT)
      think += Number(process.hrtime.bigint() - t) / 1e6
      if (brain.cooldown > before) thinks++ // cooldown 被重設 = 這一步真的想了
      t = process.hrtime.bigint()
      stepGame(state, FIXED_DT)
      sim += Number(process.hrtime.bigint() - t) / 1e6
      steps++
    }
  }
  console.log(
    `${key.padEnd(10)} ${(think / Math.max(1, thinks)).toFixed(2).padStart(5)}ms/輪 ×${String(thinks).padStart(4)}` +
      `   ${((sim / Math.max(1, steps)) * 1000).toFixed(0).padStart(3)}µs/步 ×${String(steps).padStart(6)}` +
      `   ${((think / Math.max(0.001, think + sim)) * 100).toFixed(0).padStart(3)}%`,
  )
}

console.log(
  '\n現況基準（本機）：黃巾 0.22ms/輪・巨鹿 0.49ms/輪・洛陽 0.73ms/輪。' +
    '\n變慢就先看 sim/autoplay.ts 的三層快取（Cov／Geom.runs／defInfo）是不是被繞過了。\n',
)
