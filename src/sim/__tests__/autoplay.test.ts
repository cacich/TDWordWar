/**
 * AI 代管（sim/autoplay.ts）的煙霧測試。
 * 這裡不驗「通關率」——那是 `npm run ai` 儀表板的事，會隨數值平衡漂移，不該綁死在單元測試裡。
 * 這裡只守住不變量：能跑完一局不炸、確實有在操作、且完全決定性（同種子同結果）。
 */
import { describe, expect, it } from 'vitest'
import { createBrain, stepAuto } from '../autoplay'
import { createGame } from '../state'
import { stepGame } from '../step'

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

  it('完全決定性：同種子兩次跑出同樣結果', () => {
    const a = playFull('guandu', 55555)
    const b = playFull('guandu', 55555)
    expect(a.wave).toBe(b.wave)
    expect(a.phase).toBe(b.phase)
    expect(a.stats.kills).toBe(b.stats.kills)
  })
})
