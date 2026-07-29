/**
 * 存檔（localStorage）。兩份彼此獨立的資料：
 *   `tdwordwar.meta.v3` 局外進度（圖鑑、兵書、商城、編隊、成就、每日成績）
 *   `tdwordwar.run.v1`  進行到一半的對局（續玩用，快照格式見 sim/persist.ts）
 *
 * 本檔只負責「讀寫與清洗」，不含任何遊戲邏輯。
 */
import { ACHIEVEMENT_BY_KEY } from '../data/achievements'
import { RUN_SAVE_VERSION, type RunSnapshot } from '../sim/persist'
import { ENEMY_BY_KEY } from '../data/enemies'
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
  seenEnemies: [],
  best: {},
  daily: {},
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
      // 只留仍存在於敵表的 key：刪掉或改名某個敵人時舊存檔自動清乾淨
      seenEnemies: arr(p.seenEnemies).filter((k) => ENEMY_BY_KEY[k]),
      best: typeof p.best === 'object' && p.best ? { ...p.best } : {},
      daily: typeof p.daily === 'object' && p.daily ? { ...p.daily } : {},
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

// ── 局內存檔（續玩） ────────────────────────────────────
/**
 * 進行到一半的對局。與 meta 分開存成另一個 key，理由有二：
 *   1. meta 每 2 秒就可能寫一次，局內存檔只在每波開始與離開頁面時寫，兩者節奏不同
 *   2. 局內存檔壞掉或格式改版時可以單獨丟掉，不會連累局外進度
 * 快照的產生與還原是純函式，在 sim/persist.ts。
 */
const RUN_KEY = 'tdwordwar.run.v1'

export function saveRun(snap: RunSnapshot): void {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(snap))
  } catch {
    /* 隱私模式或容量不足，忽略——續玩是加分功能，不該讓它擋住遊戲 */
  }
}

/** 讀局內存檔。**只做格式檢查**，能不能還原成對局由 `restoreRun` 判斷 */
export function loadRun(): RunSnapshot | null {
  try {
    const raw = localStorage.getItem(RUN_KEY)
    if (!raw) return null
    const snap = JSON.parse(raw) as RunSnapshot
    if (!snap || snap.v !== RUN_SAVE_VERSION || typeof snap.levelKey !== 'string') return null
    return snap
  } catch {
    return null
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(RUN_KEY)
  } catch {
    /* 同上 */
  }
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
