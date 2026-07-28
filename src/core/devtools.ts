/**
 * 開發密技：測試用的直接狀態竄改，繞過 sim/actions.ts 的正常驗證流程。
 * 只給開發者用（選單標題連點 7 下開啟面板，見 ui/screens.ts），不是玩家操作，
 * 所以不受「玩家操作一律經由 actions.ts」那條規則約束——跟 main.ts 的 __dev console 同等級。
 */
import { GENERALS } from '../data/generals'
import { GLYPH_BY_CHAR, GLYPHS } from '../data/glyphs'
import type { MetaProgress } from '../sim/state'
import { recalcUnits } from '../sim/state'
import type { GameState } from '../sim/types'

export function devAddRenown(meta: MetaProgress, amount: number): void {
  meta.renown = Math.max(0, meta.renown + amount)
}

export function devAddFood(state: GameState, amount: number): void {
  state.food = Math.max(0, state.food + amount)
}

export function devFullHeal(state: GameState): void {
  state.lives = state.maxLives
}

/** 拆光棋盤上所有已放置的字牌與武將（手牌不動） */
export function devClearBoard(state: GameState): void {
  state.units = []
  state.bondCds = {}
  recalcUnits(state)
}

/** 清空目前波次的敵人與待生成佇列——下一幀 checkWaveEnd 會自然結算並進入下一波 */
export function devClearEnemies(state: GameState): void {
  state.enemies = []
  state.spawnQueue = []
}

export function devUnlockCodex(meta: MetaProgress): void {
  meta.seenGlyphs = GLYPHS.map((g) => g.char)
  meta.seenGenerals = GENERALS.map((g) => g.name)
}

export interface DevResult {
  ok: boolean
  msg: string
}

/** 直接把指定的字（一階）塞進手牌空格 */
export function devGiveGlyph(state: GameState, char: string): DevResult {
  if (!GLYPH_BY_CHAR[char]) return { ok: false, msg: `沒有這個字：${char}` }
  const i = state.hand.findIndex((h) => h === null)
  if (i < 0) return { ok: false, msg: '手牌已滿' }
  state.hand[i] = { char, level: 1 }
  recalcUnits(state)
  return { ok: true, msg: `獲得「${char}」` }
}
