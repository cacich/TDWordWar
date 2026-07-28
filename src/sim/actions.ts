/**
 * 所有玩家操作的唯一入口。每個 action 回傳 ActionResult 供 UI 顯示回饋。
 * 規則：action 只改 GameState，不碰 DOM、不播音效。
 *
 * ★ 重要模型：棋盤上被操作的一律是「字牌」。武將是疊在字牌上的一層，
 *   會隨著成員字牌的變動自動重算（升階）或解除（成員被搬走／鏟除）。
 */
import { GLYPH_BY_CHAR, MAX_GLYPH_LEVEL, levelMul, qualityName } from '../data/glyphs'
import { isPlot } from './board'
import { findCombinations } from './combine'
import { SELL_RATIO, familiarChars, recruitCost, rerollCost, rollGlyph, smeltRefund } from './economy'
import { emit } from './events'
import { glyphAt, makeGeneralUnit, makeGlyphUnit, recalcUnits, unitById } from './state'
import type { GameState, Unit } from './types'
import { buildWave } from './waves'

export interface ActionResult {
  ok: boolean
  /** 給玩家看的訊息（成功或失敗原因） */
  msg?: string
  /** 這次操作觸發的合成（可能同時成兩將） */
  combined?: string[]
  /** 這次操作解除的武將 */
  broken?: string[]
}

const fail = (msg: string): ActionResult => ({ ok: false, msg })

// ── 征兵 ──────────────────────────────────────────────
export function recruit(state: GameState): ActionResult {
  if (state.phase === 'won' || state.phase === 'lost') return fail('本局已結束')
  const cost = recruitCost(state)
  if (state.food < cost) return fail(`糧不足（需要 ${cost}）`)
  const emptySlots = state.hand.filter((h) => h === null).length
  if (emptySlots === 0) return fail('手牌已滿')

  state.food -= cost
  state.recruitsThisWave++
  const ctx = { pool: state.pool, familiar: familiarChars(state), wishes: state.wishes }
  for (let i = 0; i < state.hand.length; i++) {
    if (state.hand[i] === null) {
      state.hand[i] = { char: rollGlyph(state.rng, state.wave, ctx).char, level: 1 }
    }
  }
  recalcUnits(state)
  return { ok: true, msg: `征兵：抽得 ${emptySlots} 字` }
}

// ── 熔爐重抽：整手換新 ────────────────────────────────
export function rerollHand(state: GameState): ActionResult {
  if (state.phase === 'won' || state.phase === 'lost') return fail('本局已結束')
  const held = state.hand.filter((h) => h !== null).length
  if (held === 0) return fail('手牌是空的，先征兵')
  const cost = rerollCost(state)
  if (state.food < cost) return fail(`糧不足（重抽需要 ${cost}）`)

  state.food -= cost
  const ctx = { pool: state.pool, familiar: familiarChars(state), wishes: state.wishes }
  for (let i = 0; i < state.hand.length; i++) {
    if (state.hand[i] === null) continue
    state.hand[i] = { char: rollGlyph(state.rng, state.wave, ctx).char, level: 1 }
  }
  recalcUnits(state)
  return { ok: true, msg: `重抽 ${held} 字（品質重置為一階）` }
}

// ── 心願單 ────────────────────────────────────────────
/**
 * 指定想要的字，抽卡權重 ×WISH_BOOST（與熟悉度加權相乘）。
 * 只能指定本局字池裡的字——指定池外的字不會有任何效果，所以直接擋下並說明。
 */
export function toggleWish(state: GameState, char: string): ActionResult {
  const i = state.wishes.indexOf(char)
  if (i >= 0) {
    state.wishes.splice(i, 1)
    return { ok: true, msg: `取消心願「${char}」` }
  }
  if (!state.pool.includes(char)) return fail(`「${char}」不在本局字池，無法許願`)
  if (state.wishes.length >= state.wishSlots) {
    return fail(`心願格已滿（${state.wishSlots} 個），先取消一個`)
  }
  state.wishes.push(char)
  return { ok: true, msg: `心願「${char}」：抽到機率大幅提高` }
}

// ── 手牌之間疊合：同字同品質 → 升一階 ────────────────
export function mergeHand(state: GameState, from: number, to: number): ActionResult {
  if (from === to) return fail('同一格')
  const a = state.hand[from]
  const b = state.hand[to]
  if (!a || !b) return fail('手牌為空')
  if (a.char !== b.char) return fail('不同的字無法疊合')
  if (a.level !== b.level) return fail('品質不同無法疊合')
  if (b.level >= MAX_GLYPH_LEVEL) return fail('已達最高品質')

  b.level += 1
  state.hand[from] = null
  recalcUnits(state)
  return { ok: true, msg: `「${b.char}」升為${qualityName(b.level)}` }
}

// ── 熔爐分解手牌 ──────────────────────────────────────
export function smelt(state: GameState, handIndex: number): ActionResult {
  const card = state.hand[handIndex]
  if (!card) return fail('該格沒有字')
  const def = GLYPH_BY_CHAR[card.char]
  const value = def.atk * levelMul(card.level)
  state.hand[handIndex] = null
  if (state.smeltFreeLeft > 0) {
    state.smeltFreeLeft--
    state.food += Math.max(1, Math.round(value * 0.2))
  } else {
    state.food += smeltRefund(value)
  }
  recalcUnits(state)
  return { ok: true, msg: `分解「${card.char}」` }
}

// ── 從手牌放置到棋盤 ──────────────────────────────────
export function placeFromHand(state: GameState, handIndex: number, cell: number): ActionResult {
  if (state.phase === 'won' || state.phase === 'lost') return fail('本局已結束')
  const card = state.hand[handIndex]
  if (!card) return fail('該手牌為空')
  if (!isPlot(state.board, cell)) return fail('只能放在空地上')

  const occupant = glyphAt(state, cell)
  if (occupant) {
    // 疊合升階。已組成武將的字牌也可以繼續疊——武將會跟著變強，不會解除
    if (occupant.chars[0] !== card.char) return fail('不同的字無法疊合')
    if (occupant.level !== card.level) return fail('品質不同無法疊合')
    if (occupant.level >= MAX_GLYPH_LEVEL) return fail('已達最高品質')

    const lv = occupant.level + 1
    levelUpGlyph(state, occupant, lv)
    state.hand[handIndex] = null
    emit(state, { kind: 'merge', char: card.char, level: lv })
    const combined = tryCombine(state, cell)
    recalcUnits(state)
    const boosted = occupant.formIds.length > 0
    return {
      ok: true,
      msg: `「${card.char}」升為${qualityName(lv)}${boosted ? '，武將同步強化' : ''}`,
      combined,
    }
  }

  state.units.push(makeGlyphUnit(state, card.char, card.level, cell))
  state.hand[handIndex] = null
  emit(state, { kind: 'place', char: card.char })
  const combined = tryCombine(state, cell)
  recalcUnits(state)
  return { ok: true, combined }
}

/**
 * 就地把字牌升一階。保留 id 與 formIds，所屬武將才不會斷掉。
 */
function levelUpGlyph(state: GameState, target: Unit, level: number): void {
  const fresh = makeGlyphUnit(state, target.chars[0], level, target.cells[0])
  fresh.id = target.id
  fresh.formIds = [...target.formIds]
  fresh.targeting = target.targeting
  // 武將透過 id 找成員（glyphsOf），所以換掉陣列裡的物件就夠，memberIds 不需要動
  state.units[state.units.indexOf(target)] = fresh
}

// ── 移動場上的字牌（設計決定 #5：可隨時自由移動） ─────
/**
 * 一律搬動「字牌」而不是整個武將。
 * 搬走的字牌所屬的武將會解除，這正是「張遼 → 拖走遼 → 補上飛 → 張飛」的玩法基礎。
 */
export function moveGlyph(state: GameState, glyphId: number, toCell: number): ActionResult {
  if (state.phase === 'won' || state.phase === 'lost') return fail('本局已結束')
  const u = unitById(state, glyphId)
  if (!u || u.kind !== 'glyph') return fail('只能搬動字牌')
  if (!isPlot(state.board, toCell)) return fail('只能放在空地上')
  if (u.cells[0] === toCell) return { ok: true }

  const occupant = glyphAt(state, toCell)
  if (occupant) {
    const mergeable =
      occupant.chars[0] === u.chars[0] && occupant.level === u.level && occupant.level < MAX_GLYPH_LEVEL
    if (mergeable) {
      const broken = dissolveFormsOf(state, u.id)
      removeGlyph(state, u)
      const lv = occupant.level + 1
      levelUpGlyph(state, occupant, lv)
      emit(state, { kind: 'merge', char: occupant.chars[0], level: lv })
      const combined = tryCombine(state, toCell)
      recalcUnits(state)
      return { ok: true, msg: `疊合為${qualityName(lv)}`, combined, broken }
    }

    // 無法疊合（不同字，或品質不同，或已滿階）→ 兩個字牌互換位置，讓移動一定成立。
    // 兩者都算「移動」，各自所屬的武將都要解除，再於新位置重新判定組詞。
    const fromCell = u.cells[0]
    const broken = [...dissolveFormsOf(state, u.id), ...dissolveFormsOf(state, occupant.id)]
    u.cells = [toCell]
    occupant.cells = [fromCell]
    const combined = [...(tryCombine(state, toCell) ?? []), ...(tryCombine(state, fromCell) ?? [])]
    recalcUnits(state)
    return {
      ok: true,
      msg: `「${u.chars[0]}」與「${occupant.chars[0]}」交換位置`,
      combined: combined.length ? combined : undefined,
      broken,
    }
  }

  const broken = dissolveFormsOf(state, u.id)
  u.cells = [toCell]
  const combined = tryCombine(state, toCell)
  recalcUnits(state)
  return { ok: true, combined, broken }
}

// ── 鏟除 ──────────────────────────────────────────────
/** 鏟除一個字牌；它所屬的武將會一併解除 */
export function sellGlyph(state: GameState, glyphId: number): ActionResult {
  const u = unitById(state, glyphId)
  if (!u || u.kind !== 'glyph') return fail('找不到字牌')
  // 已組成武將的字牌退款打折（拆將要有重量），經濟字則按產能折算
  const ratio = u.formIds.length > 0 ? SELL_RATIO.general : SELL_RATIO.glyph
  const refund = Math.max(1, Math.round((u.baseAtk * 0.35 + u.income * 0.5) * ratio))
  const broken = dissolveFormsOf(state, u.id)
  removeGlyph(state, u)
  state.food += refund
  recalcUnits(state)
  return {
    ok: true,
    msg: broken.length
      ? `鏟除「${u.chars[0]}」，解除 ${broken.join('、')}，退還 ${refund} 糧`
      : `鏟除「${u.chars[0]}」，退還 ${refund} 糧`,
  }
}

function removeGlyph(state: GameState, u: Unit): void {
  state.units = state.units.filter((x) => x !== u)
}

/** 解除所有包含此字牌的武將，回傳被解除的武將名 */
export function dissolveFormsOf(state: GameState, glyphId: number): string[] {
  const forms = state.units.filter((u) => u.kind === 'general' && u.memberIds.includes(glyphId))
  if (!forms.length) return []
  const ids = new Set(forms.map((f) => f.id))
  state.units = state.units.filter((u) => !ids.has(u.id))
  for (const u of state.units) {
    if (u.kind === 'glyph') u.formIds = u.formIds.filter((id) => !ids.has(id))
  }
  for (const name of forms.map((f) => f.defKey)) {
    delete state.bondCds[name]
    emit(state, { kind: 'dissolve', name })
  }
  return forms.map((f) => f.defKey)
}

// ── 組詞判定與合成 ────────────────────────────────────
/**
 * 回傳這次合成出的武將名。橫向與縱向可能同時成立 → 一次成兩將。
 * 字牌不會被移除，武將只是疊上去的一層。
 */
export function tryCombine(state: GameState, changedCell: number): string[] | undefined {
  const matches = findCombinations(state.board, state.units, changedCell)
  if (!matches.length) return undefined
  const names: string[] = []
  for (const m of matches) {
    state.units.push(makeGeneralUnit(state, m.def, m.units))
    names.push(m.def.name)
    emit(state, { kind: 'combine', name: m.def.name, tier: m.def.tier, cells: m.cells })
  }
  return names
}

// ── 波次 ──────────────────────────────────────────────
export function startWaveNow(state: GameState): ActionResult {
  if (state.phase !== 'prep') return fail('目前不在佈陣階段')
  const bonus = Math.max(0, Math.round(state.prepTimer * 0.5))
  state.food += bonus
  beginBattle(state)
  return { ok: true, msg: bonus > 0 ? `提前開戰，獲得 ${bonus} 糧` : '開戰' }
}

export function beginBattle(state: GameState): void {
  state.phase = 'battle'
  state.waveTime = 0
  state.prepTimer = 0
  state.spawnQueue = buildWave(state.wave, state.rng, state.hpMul)
}
