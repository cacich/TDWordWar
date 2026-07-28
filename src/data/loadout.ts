/**
 * 編隊：讓玩家從「已解鎖」的字與武將裡手動挑選字池內容，取代 sim/pool.ts 原本的隨機抽樣。
 * 啟用後，字池只會出現編隊選的字／武將配方字，加上所有「還沒解鎖過」的字——
 * 已解鎖但沒被選進編隊的字／武將會被排除，逼出「自己決定要用什麼」的策略深度。
 *
 * 姓氏／名字字（category 'surname'／'given'）不能直接選進「攜帶的字」——它們單獨戰力低，
 * 存在的唯一目的是組成武將，所以只透過「攜帶的武將」帶入，維持跟 sim/pool.ts 的
 * ALWAYS／SUPPORT／NAMED_RECIPES 三分法一致。
 *
 * 這裡只碰 MetaProgress（局外進度），不碰 GameState——實際套用在 sim/pool.ts 的 buildGlyphPool()。
 */
import { GENERAL_BY_NAME } from './generals'
import { GLYPH_BY_CHAR } from './glyphs'
import { MAX_LOADOUT_GENERALS, MAX_LOADOUT_GLYPHS, type MetaProgress } from '../sim/state'

export interface ToggleResult {
  ok: boolean
  msg?: string
}

/** 可以直接選進「攜帶的字」的類別；姓氏／名字要透過「攜帶的武將」帶入 */
export function isLoadoutableGlyph(char: string): boolean {
  const cat = GLYPH_BY_CHAR[char]?.category
  return cat === 'weapon' || cat === 'troop' || cat === 'strategy' || cat === 'economy'
}

/**
 * 一名武將是否可以選進編隊：實際組成過（seenGenerals）算，
 * 或配方的字都已經各自解鎖過（seenGlyphs）也算——不必真的湊出來過，
 * 否則玩家明明字都抽過了，卻因為沒手動拼過這個武將而選不到它，會很困惑。
 * 拆成兩個陣列參數（而不是整個 MetaProgress）方便 core/save.ts 在組出完整物件前就能用。
 */
export function isGeneralUnlocked(
  seenGlyphs: readonly string[],
  seenGenerals: readonly string[],
  name: string,
): boolean {
  if (seenGenerals.includes(name)) return true
  const def = GENERAL_BY_NAME[name]
  return !!def && def.recipe.every((ch) => seenGlyphs.includes(ch))
}

/** 切換一個字是否在編隊裡；不可選的類別、未解鎖或已滿額會被擋下 */
export function toggleLoadoutGlyph(meta: MetaProgress, char: string): ToggleResult {
  if (!isLoadoutableGlyph(char)) return { ok: false, msg: `「${char}」要透過武將帶入` }
  if (!meta.seenGlyphs.includes(char)) return { ok: false, msg: `尚未解鎖「${char}」` }
  const i = meta.loadoutGlyphs.indexOf(char)
  if (i >= 0) {
    meta.loadoutGlyphs.splice(i, 1)
    return { ok: true }
  }
  if (meta.loadoutGlyphs.length >= MAX_LOADOUT_GLYPHS) {
    return { ok: false, msg: `編隊最多帶 ${MAX_LOADOUT_GLYPHS} 個字` }
  }
  meta.loadoutGlyphs.push(char)
  return { ok: true }
}

/** 切換一名武將是否在編隊裡；未解鎖或已滿額會被擋下 */
export function toggleLoadoutGeneral(meta: MetaProgress, name: string): ToggleResult {
  if (!isGeneralUnlocked(meta.seenGlyphs, meta.seenGenerals, name)) {
    return { ok: false, msg: `尚未解鎖「${name}」` }
  }
  const i = meta.loadoutGenerals.indexOf(name)
  if (i >= 0) {
    meta.loadoutGenerals.splice(i, 1)
    return { ok: true }
  }
  if (meta.loadoutGenerals.length >= MAX_LOADOUT_GENERALS) {
    return { ok: false, msg: `編隊最多帶 ${MAX_LOADOUT_GENERALS} 名武將` }
  }
  meta.loadoutGenerals.push(name)
  return { ok: true }
}

export function setLoadoutActive(meta: MetaProgress, active: boolean): void {
  meta.loadoutActive = active
}
