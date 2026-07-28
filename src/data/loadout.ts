/**
 * 編隊：讓玩家從「已解鎖」的字與武將裡手動挑選字池內容，取代 sim/pool.ts 原本的隨機抽樣。
 * 啟用後，字池只會出現編隊選的字／武將配方字，加上所有「還沒解鎖過」的字——
 * 已解鎖但沒被選進編隊的字／武將會被排除，逼出「自己決定要用什麼」的策略深度。
 *
 * 這裡只碰 MetaProgress（局外進度），不碰 GameState——實際套用在 sim/pool.ts 的 buildGlyphPool()。
 */
import { MAX_LOADOUT_GENERALS, MAX_LOADOUT_GLYPHS, type MetaProgress } from '../sim/state'

export interface ToggleResult {
  ok: boolean
  msg?: string
}

/** 切換一個字是否在編隊裡；未解鎖或已滿額會被擋下 */
export function toggleLoadoutGlyph(meta: MetaProgress, char: string): ToggleResult {
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
  if (!meta.seenGenerals.includes(name)) return { ok: false, msg: `尚未解鎖「${name}」` }
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
