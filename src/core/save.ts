/**
 * 局外進度存檔（localStorage）。
 * 注意：只存局外 meta 進度，不存局內狀態（GameState 內含 rng 閉包，不可直接序列化）。
 * 若要做局內續玩，需改為存 { seed, rngCallCount } 並在載入時重播 —— 見 docs/llm-wiki/04-invariants.md
 */
import { ACHIEVEMENT_BY_KEY } from '../data/achievements'
import { isGeneralUnlocked, isLoadoutableGlyph } from '../data/loadout'
import { SHOP_BY_KEY } from '../data/shop'
import {
  EMPTY_TOTALS,
  MAX_HAND_SIZE,
  MAX_LOADOUT_GENERALS,
  MAX_LOADOUT_GLYPHS,
  MAX_WISH_SLOTS,
  type MetaProgress,
  type RunTotals,
} from '../sim/state'

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
  items: {},
  loadoutActive: false,
  loadoutGlyphs: [],
  loadoutGenerals: [],
  achievements: {},
  totals: { ...EMPTY_TOTALS },
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
    const seenGlyphs = arr(p.seenGlyphs)
    const seenGenerals = arr(p.seenGenerals)
    return {
      handSize: clamp(p.handSize ?? 5, 5, MAX_HAND_SIZE),
      extraFood: clamp(p.extraFood ?? 0, 0, 50),
      extraLives: clamp(p.extraLives ?? 0, 0, 5),
      wishSlots: clamp(p.wishSlots ?? 1, 1, MAX_WISH_SLOTS),
      renown: Math.max(0, Math.floor(p.renown ?? 0)),
      cleared: arr(p.cleared),
      seenGlyphs,
      seenGenerals,
      best: typeof p.best === 'object' && p.best ? { ...p.best } : {},
      items: items(p.items),
      loadoutActive: typeof p.loadoutActive === 'boolean' ? p.loadoutActive : false,
      // 只保留仍然「已解鎖」且可選的項目，並夾在上限內——避免存檔被手動改壞、
      // 道具表變動後選到不存在的東西，或姓氏／名字字被舊版存檔留下來
      loadoutGlyphs: arr(p.loadoutGlyphs)
        .filter((ch) => seenGlyphs.includes(ch) && isLoadoutableGlyph(ch))
        .slice(0, MAX_LOADOUT_GLYPHS),
      loadoutGenerals: arr(p.loadoutGenerals)
        .filter((name) => isGeneralUnlocked(seenGlyphs, seenGenerals, name))
        .slice(0, MAX_LOADOUT_GENERALS),
      achievements: achievements(p.achievements),
      totals: totals(p.totals),
    }
  } catch {
    return { ...EMPTY_META }
  }
}

/**
 * 商城道具等級。舊版存檔的 items 是 string[]（一次性擁有，等同 Lv.1），
 * 這裡相容轉換；新版是 Record<key, level>，逐一夾在該道具的等級上限內。
 */
function items(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (Array.isArray(v)) {
    for (const k of v) {
      if (typeof k === 'string' && SHOP_BY_KEY[k]) out[k] = 1
    }
    return out
  }
  if (v && typeof v === 'object') {
    for (const [k, lv] of Object.entries(v as Record<string, unknown>)) {
      const def = SHOP_BY_KEY[k]
      if (!def || typeof lv !== 'number') continue
      const clamped = clamp(Math.floor(lv), 0, def.max)
      if (clamped > 0) out[k] = clamped
    }
  }
  return out
}

/**
 * 已解鎖的成就（key → 解鎖序號）。丟掉查不到 def 的 key，
 * 這樣刪掉或改名某個成就時舊存檔會自動被清乾淨，不必寫遷移。
 */
function achievements(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!v || typeof v !== 'object') return out
  for (const [k, seq] of Object.entries(v as Record<string, unknown>)) {
    if (!ACHIEVEMENT_BY_KEY[k] || typeof seq !== 'number' || !(seq > 0)) continue
    out[k] = Math.floor(seq)
  }
  return out
}

/** 跨局累計統計。存檔是使用者可手改的輸入，所以每一欄都夾成非負整數 */
function totals(v: unknown): RunTotals {
  const p = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof RunTotals, unknown>>
  const n = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0)
  return { runs: n(p.runs), wins: n(p.wins), kills: n(p.kills), waves: n(p.waves) }
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
