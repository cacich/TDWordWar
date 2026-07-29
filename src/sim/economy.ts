/**
 * 經濟：征兵花費、抽字權重、回收退款。
 * 所有數值集中在此，調平衡只需改這個檔。
 */
import { pickWeighted } from '../core/rng'
import { GLYPHS } from '../data/glyphs'
import type { GameState, GlyphDef } from './types'

/**
 * 同一波內每多征一次兵，費用再加這個數。跨波歸零（`checkWaveEnd`）。
 * 它的作用是壓掉「某一波突然爆糧就連征四次」的尖峰——經濟字堆起來之後很容易發生，
 * 而一次征兵會填滿整個手牌，連征四次等於一口氣多出 20 張牌，節奏會整個垮掉。
 */
export const RECRUIT_STEP = 3

/**
 * 征兵花費：隨波次與「本波已征兵次數」上升；輕裝簡從（costMul）打折。
 *
 * ★ 波次斜率（2.4）與 `waveIncome` 的斜率（0.6）是一組的：**兩者的比值才是
 * 「一波征幾次兵」的真正旋鈕**，單獨調任何一邊都會破壞設計目標（1～2 次／波）。
 * 改完務必跑 `npm run econ` 看「征兵」欄。
 */
export function recruitCost(state: GameState): number {
  const base = 8 + Math.floor(state.wave * 2.4) + RECRUIT_STEP * state.recruitsThisWave
  return Math.max(1, Math.round(base * state.perks.costMul))
}

/**
 * 每波結算的固定收入。
 *
 * ★ 經濟的設計目標是**一波只夠征兵 1～2 次**（`npm run econ` 的「征兵」欄）。
 * 收入有三個來源，佔比差很多：擊殺賞金 ≈ 65%、固定收入 ≈ 30%、場上產糧 ≈ 5%。
 * 所以要調整「糧累積得多快」，主力槓桿是 `data/enemies.ts` 的 `bounty`，這裡是輔助。
 */
export function waveIncome(wave: number): number {
  return 4 + Math.floor(wave * 0.6)
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

/**
 * 稀有度權重表：波次越後面，越容易抽到姓氏／名字字。
 * 每一列對應 rarity 1/2/3/4；`rollGlyph` 用 `w[g.rarity - 1]` 取值。
 *
 * ⚠ **第 4 欄目前是死的**：`data/glyphs.ts` 裡沒有任何 rarity 4 的字
 * （分布為 rarity1=5／rarity2=29／rarity3=37），所以索引 3 永遠不會被讀到。
 * 保留它是為了將來要加「傳說級單字」時有位子；在那之前調整第 4 欄不會有任何效果。
 */
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
  /** 廣結善緣：疊在 FAMILIAR_BOOST 上的額外倍率，預設 1（中性） */
  familiarBoostMul?: number
}

export function rollGlyph(rng: () => number, wave: number, ctx: RollContext = {}): GlyphDef {
  const w = rarityWeights(wave)
  const candidates = ctx.pool?.length ? GLYPHS.filter((g) => ctx.pool!.includes(g.char)) : GLYPHS
  return pickWeighted(rng, candidates, (g) => {
    let weight = w[g.rarity - 1]
    if (ctx.familiar?.has(g.char)) weight *= FAMILIAR_BOOST * (ctx.familiarBoostMul ?? 1)
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

/** 熔爐重抽：把手牌上所有字換成新的，比征兵便宜但不增加張數；輕裝簡從（costMul）打折 */
export function rerollCost(state: GameState): number {
  return Math.max(1, Math.round((4 + Math.floor(state.wave / 2)) * state.perks.costMul))
}

/** 鏟除退款比例：字牌全額、武將只退 3 成（設計決定：拆將要有重量） */
export const SELL_RATIO = { glyph: 1.0, general: 0.3 }
