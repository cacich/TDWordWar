import { describe, expect, it } from 'vitest'
import { cellIndex } from '../board'
import { placeFromHand } from '../actions'
import { unitIncome } from '../economy'
import { createGame, glyphAt } from '../state'
import { stepGame } from '../step'
import type { GameState } from '../types'

function put(state: GameState, char: string, col: number, row: number, level = 1): void {
  state.hand[0] = { char, level }
  const res = placeFromHand(state, 0, cellIndex(state.board, col, row))
  if (!res.ok) throw new Error(`放置失敗：${char} → ${res.msg}`)
}

describe('經濟字', () => {
  it('產糧隨品質線性成長（不是指數）', () => {
    const s = createGame('julu', 1)
    put(s, '商', 0, 1, 1)
    expect(unitIncome(s)).toBe(6)

    const s3 = createGame('julu', 1)
    put(s3, '商', 0, 1, 3)
    expect(unitIncome(s3)).toBe(18) // 6 × 3，而非 6 × 1.55²
  })

  it('經濟字不攻擊', () => {
    const s = createGame('julu', 1)
    put(s, '糧', 0, 1)
    const u = glyphAt(s, cellIndex(s.board, 0, 1))!
    expect(u.atk).toBe(0)
    expect(u.fx).toBe('none')
  })

  it('屯＋田 → 屯田，產糧遠高於零件相加', () => {
    const s = createGame('julu', 1)
    put(s, '屯', 0, 1)
    put(s, '田', 1, 1)
    const g = s.units.find((u) => u.kind === 'general')
    expect(g?.defKey).toBe('屯田')
    expect(g?.income).toBe(14) // 屯4 + 田2 = 6 → 合成後 14
    expect(g?.atk).toBe(0)
  })

  it('武將的產糧也會繼承字牌品質', () => {
    const s = createGame('julu', 1)
    put(s, '屯', 0, 1, 2)
    put(s, '田', 1, 1, 2)
    expect(s.units.find((u) => u.kind === 'general')!.income).toBe(28) // 14 × 二階
  })

  it('每波結算會把產糧加進來，並記錄在 lastIncome', () => {
    const s = createGame('huangjin', 3)
    put(s, '商', 0, 1, 2)
    put(s, '弩', 1, 1, 5) // 沒有輸出的話大營會先陷落，波次不會推進
    const before = s.food
    // 跑到第一波結束
    for (let i = 0; i < 60 * 240 && s.wave === 1; i++) stepGame(s, 1 / 60)
    expect(s.wave).toBeGreaterThan(1)
    expect(s.lastIncome.units).toBe(12)
    expect(s.food).toBeGreaterThan(before + 12)
  })
})

describe('攻擊特效的辨識資訊', () => {
  it('每個字都有 fx，且字牌的 fx 對得上類別', () => {
    const s = createGame('julu', 1)
    put(s, '刀', 0, 1)
    put(s, '弓', 1, 1)
    put(s, '槍', 2, 1)
    put(s, '火', 3, 1)
    put(s, '雷', 4, 1)
    // 只看字牌：這幾個字相鄰時可能順便組成武將（例如火＋雷 → 火雷），
    // 那是另一個測試的主題，不該讓這裡的斷言跟著配方表變動
    const fx = Object.fromEntries(s.units.filter((u) => u.kind === 'glyph').map((u) => [u.defKey, u.fx]))
    expect(fx).toEqual({ 刀: 'blade', 弓: 'arrow', 槍: 'thrust', 火: 'fire', 雷: 'bolt' })
  })

  it('武將繼承組成字牌中最有個性的 fx', () => {
    const s = createGame('julu', 1)
    put(s, '火', 0, 1)
    put(s, '計', 1, 1)
    const g = s.units.find((u) => u.kind === 'general')!
    expect(g.defKey).toBe('火計')
    expect(g.fx).toBe('fire') // fire 的優先序高於 plan
  })

  it('姓名字組出的武將會依 tag／型態拿到合理的 fx', () => {
    const s = createGame('julu', 1)
    put(s, '黃', 0, 1)
    put(s, '忠', 1, 1)
    const form = s.units.find((u) => u.kind === 'general')!
    expect(form.defKey).toBe('黃忠')
    expect(form.fx).toBe('arrow') // 黃忠帶「弓」tag
  })

  it('攻擊會設定 atkFlash，讓畫面標出是誰打的', () => {
    const s = createGame('julu', 1)
    put(s, '弩', 0, 1)
    const u = glyphAt(s, cellIndex(s.board, 0, 1))!
    for (let i = 0; i < 60 * 20 && u.atkFlash === 0; i++) stepGame(s, 1 / 60)
    expect(u.atkFlash).toBeGreaterThan(0)
    const attackFx = s.effects.filter((e) => e.kind === 'attack')
    expect(attackFx.length).toBeGreaterThan(0)
    expect(attackFx[0].glyph).toBe('弩')
    expect(attackFx[0].fx).toBe('arrow')
  })
})
