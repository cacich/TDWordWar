/**
 * AI 代管（sim/autoplay.ts）的煙霧測試。
 * 這裡不驗「通關率」——那是 `npm run ai` 儀表板的事，會隨數值平衡漂移，不該綁死在單元測試裡。
 * 這裡只守住不變量：能跑完一局不炸、確實有在操作、且完全決定性（同種子同結果）。
 */
import { describe, expect, it } from 'vitest'
import { autoThink, createBrain, stepAuto } from '../autoplay'
import { createGame } from '../state'
import { stepGame } from '../step'
import { recruitCost } from '../economy'
import { isPlot } from '../board'
import type { GameState } from '../types'

const DT = 1 / 60

function playFull(levelKey: string, seed: number) {
  const state = createGame(levelKey, seed)
  const brain = createBrain()
  let guard = 0
  while (state.phase !== 'lost' && state.phase !== 'won' && guard++ < 60 * 60 * 60) {
    stepAuto(brain, state, DT)
    stepGame(state, DT)
    if (state.wave > 60) break
  }
  return state
}

describe('AI 代管', () => {
  it('能自動打完一局而不丟例外', () => {
    const state = playFull('huangjin', 12345)
    expect(state.phase === 'won' || state.phase === 'lost').toBe(true)
    // 有實際在操作：場上應該擺出了字牌，並殺過敵人
    expect(state.units.some((u) => u.kind === 'glyph')).toBe(true)
    expect(state.stats.kills).toBeGreaterThan(0)
  })

  it('會組出武將（不只是鋪字）', () => {
    // 巨鹿波數長，跑幾波後應該至少湊出一名武將
    const state = createGame('julu', 777)
    const brain = createBrain()
    for (let i = 0; i < 60 * 60 * 8 && state.wave < 6; i++) {
      stepAuto(brain, state, DT)
      stepGame(state, DT)
    }
    expect(state.units.some((u) => u.kind === 'general')).toBe(true)
  })

  it('明顯強過「什麼都不做」——至少撐過第一波', () => {
    const state = playFull('huangjin', 20260730)
    expect(state.wave).toBeGreaterThan(1)
  })

  /**
   * 活性（liveness）回歸測試。曾經的 bug：估值端的收益吃「飽和折扣」而佔位成本不吃，
   * 中期之後每個落點都算成負分，於是 AI 在「手牌全滿、棋盤有空位、糧堆到上千」的狀態下
   * 整局不再動作（手牌不會變 → 下一輪決策一模一樣 → 永久卡死）。
   * 這裡守的不是「打得好」，而是「不會凍住」：手牌滿又有空位時每一輪都必須有動作。
   */
  it('手牌全滿又有空位時不會凍住（不再出現永久停滯）', () => {
    const freePlots = (s: GameState) => {
      const occ = new Set(s.units.filter((u) => u.kind === 'glyph').map((u) => u.cells[0]))
      let n = 0
      for (let i = 0; i < s.board.cols * s.board.rows; i++) if (isPlot(s.board, i) && !occ.has(i)) n++
      return n
    }
    for (const [level, seed] of [['xiangyang', 395243824], ['luoyang', 4242]] as const) {
      const state = createGame(level, seed)
      const brain = createBrain()
      let cd = 0
      let idleRun = 0
      let worstIdle = 0
      let guard = 0
      while (state.phase !== 'lost' && state.phase !== 'won' && guard++ < 60 * 60 * 60) {
        cd -= DT
        if (cd <= 0) {
          cd = 1.2
          const acted = autoThink(brain, state)
          // 該有事可做：買得起牌或手上有牌，而且棋盤還有空位
          const canAct =
            (state.hand.some((h) => h !== null) || state.food >= recruitCost(state)) && freePlots(state) > 0
          if (acted === 0 && canAct) worstIdle = Math.max(worstIdle, ++idleRun)
          else idleRun = 0
        }
        stepGame(state, DT)
        if (state.wave > 40) break
      }
      // 缺糧時原地等是合理的；卡死的特徵是「連續數十輪、跨好幾波都沒有任何動作」。
      // 修好前這兩局分別停滯 200+ 輪（≈4 分鐘、十幾波）。
      expect(worstIdle).toBeLessThan(150)
    }
  })

  it('完全決定性：同種子兩次跑出同樣結果', () => {
    const a = playFull('guandu', 55555)
    const b = playFull('guandu', 55555)
    expect(a.wave).toBe(b.wave)
    expect(a.phase).toBe(b.phase)
    expect(a.stats.kills).toBe(b.stats.kills)
  })
})
