/**
 * 局外進度存檔（localStorage）。
 * 注意：只存局外 meta 進度，不存局內狀態（GameState 內含 rng 閉包，不可直接序列化）。
 * 若要做局內續玩，需改為存 { seed, rngCallCount } 並在載入時重播 —— 見 docs/llm-wiki/04-invariants.md
 */
import { MAX_HAND_SIZE, MAX_WISH_SLOTS, type MetaProgress } from '../sim/state'

/** 版本升級時保留舊 key，loadMeta 會依序往回找並補上新欄位的預設值 */
const KEY = 'tdwordwar.meta.v3'
const LEGACY_KEYS = ['tdwordwar.meta.v2', 'tdwordwar.meta.v1']

export const EMPTY_META: MetaProgress = {
  handSize: 5,
  extraFood: 0,
  extraLives: 0,
  wishSlots: 1,
  renown: 0,
  cleared: [],
  seenGlyphs: [],
  seenGenerals: [],
  best: {},
}

export function loadMeta(): MetaProgress {
  try {
    let raw = localStorage.getItem(KEY)
    for (const k of LEGACY_KEYS) {
      if (raw) break
      raw = localStorage.getItem(k)
    }
    if (!raw) return { ...EMPTY_META }
    const p = JSON.parse(raw) as Partial<MetaProgress>
    return {
      handSize: clamp(p.handSize ?? 5, 5, MAX_HAND_SIZE),
      extraFood: clamp(p.extraFood ?? 0, 0, 50),
      extraLives: clamp(p.extraLives ?? 0, 0, 5),
      wishSlots: clamp(p.wishSlots ?? 1, 1, MAX_WISH_SLOTS),
      renown: Math.max(0, Math.floor(p.renown ?? 0)),
      cleared: arr(p.cleared),
      seenGlyphs: arr(p.seenGlyphs),
      seenGenerals: arr(p.seenGenerals),
      best: typeof p.best === 'object' && p.best ? { ...p.best } : {},
    }
  } catch {
    return { ...EMPTY_META }
  }
}

export function saveMeta(meta: MetaProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(meta))
  } catch {
    /* 隱私模式下 localStorage 可能不可用，忽略 */
  }
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
