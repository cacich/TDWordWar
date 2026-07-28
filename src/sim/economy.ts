/**
 * 經濟：征兵花費、抽字權重、回收退款。
 * 所有數值集中在此，調平衡只需改這個檔。
 */
import { pickWeighted } from '../core/rng'
import { GLYPHS } from '../data/glyphs'
import type { GameState, GlyphDef } from './types'

/** 征兵花費：隨波次與「本波已征兵次數」上升 */
export function recruitCost(state: GameState): number {
  return 8 + Math.floor(state.wave * 1.6) + 2 * state.recruitsThisWave
}

/** 每波結算的固定收入 */
export function waveIncome(wave: number): number {
  return 5 + Math.floor(wave * 1.2)
}

/**
 * 場上經濟單位（糧、田、屯、商、屯田）的每波產出。
 * 已成為武將成員的字牌不重複計算——產出由武將那一層代表。
 */
export function unitIncome(state: GameState): number {
  let sum = 0
  for (const u of state.units) {
    if (u.kind === 'glyph' && u.formIds.length > 0) continue
    sum += u.income
  }
  return Math.round(sum)
}

/** 稀有度權重表：波次越後面，越容易抽到姓氏／名字字 */
const RARITY_TABLE: { untilWave: number; w: [number, number, number, number] }[] = [
  { untilWave: 5, w: [70, 25, 5, 0] },
  { untilWave: 12, w: [50, 32, 15, 3] },
  { untilWave: 20, w: [35, 33, 24, 8] },
  { untilWave: Infinity, w: [25, 30, 30, 15] },
]

export function rarityWeights(wave: number): [number, number, number, number] {
  return (RARITY_TABLE.find((r) => wave <= r.untilWave) ?? RARITY_TABLE[RARITY_TABLE.length - 1]).w
}

/**
 * 「熟悉度」加權：已經在手上或場上的字，被抽到的權重乘以這個倍率。
 * 這是解決「字太多、想疊高或湊配方的機率太低」的主力手段——
 * 抽卡會自動朝玩家已經在經營的方向收斂，而且完全不需要玩家操作。
 */
export const FAMILIAR_BOOST = 3

/**
 * 心願單加權。玩家主動指定的字，權重再乘這個倍率（與熟悉度加權相乘）。
 * 這是「我就是要湊張飛」的那條路——比熟悉度加權更強、但要花心願格。
 */
export const WISH_BOOST = 5

export interface RollContext {
  /** 本局字池；沒給就用全表 */
  pool?: readonly string[]
  /** 已擁有的字（手牌 + 場上） */
  familiar?: ReadonlySet<string>
  /** 心願單 */
  wishes?: readonly string[]
}

export function rollGlyph(rng: () => number, wave: number, ctx: RollContext = {}): GlyphDef {
  const w = rarityWeights(wave)
  const candidates = ctx.pool?.length ? GLYPHS.filter((g) => ctx.pool!.includes(g.char)) : GLYPHS
  return pickWeighted(rng, candidates, (g) => {
    let weight = w[g.rarity - 1]
    if (ctx.familiar?.has(g.char)) weight *= FAMILIAR_BOOST
    if (ctx.wishes?.includes(g.char)) weight *= WISH_BOOST
    return weight
  })
}

/** 目前擁有的字：手牌 + 場上字牌。給 rollGlyph 的熟悉度加權用 */
export function familiarChars(state: GameState): Set<string> {
  const out = new Set<string>()
  for (const h of state.hand) if (h) out.add(h.char)
  for (const u of state.units) if (u.kind === 'glyph') out.add(u.chars[0])
  return out
}

/** 熔爐分解字牌的退款 */
export function smeltRefund(atkValue: number): number {
  return Math.max(1, Math.round(atkValue * 0.12))
}

/** 熔爐重抽：把手牌上所有字換成新的，比征兵便宜但不增加張數 */
export function rerollCost(state: GameState): number {
  return 4 + Math.floor(state.wave / 2)
}

/** 鏟除退款比例：字牌全額、武將只退 3 成（設計決定：拆將要有重量） */
export const SELL_RATIO = { glyph: 1.0, general: 0.3 }
