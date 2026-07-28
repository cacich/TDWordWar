/**
 * ★ 組詞判定引擎 —— 本作的核心機制。純函式，全部可單元測試。
 *
 * 規則（見 docs/game-design.md §5.1）：
 *   1. 同一列（橫）或同一欄（縱）上，連續相鄰的「字牌」才參與判定
 *   2. 橫向左→右、縱向上→下正讀，需完全命中配方
 *   3. **橫向與縱向各取一個最佳結果**，所以一個字可以同時參與兩個武將
 *      （「張」右邊放「遼」、下面放「飛」→ 同時成張遼與張飛）
 *   4. 已經存在的武將不會重複產生（比對「同名 + 同格子」）
 *   5. 字牌組成武將後仍留在棋盤上，所以它可以繼續被疊高、也能被單獨搬走
 */
import type { Board, GeneralDef, Unit } from './types'
import { cellCol, cellIndex, cellRow } from './board'
import { MAX_RECIPE_LEN, RECIPE_INDEX, TIER_ORDER } from '../data/generals'

export interface CombineMatch {
  def: GeneralDef
  /** 參與合成的字牌，依正讀順序 */
  units: Unit[]
  cells: number[]
  orientation: 'h' | 'v'
}

function glyphAtCell(units: Unit[], cell: number): Unit | undefined {
  return units.find((u) => u.kind === 'glyph' && u.cells[0] === cell)
}

/**
 * 取得包含 cell 的最長連續字牌序列（單一方向）。
 * 回傳陣列已依正讀順序排列。
 */
function runThrough(board: Board, units: Unit[], cell: number, orientation: 'h' | 'v'): Unit[] {
  const col = cellCol(board, cell)
  const row = cellRow(board, cell)
  const dc = orientation === 'h' ? 1 : 0
  const dr = orientation === 'h' ? 0 : 1

  const center = glyphAtCell(units, cell)
  if (!center) return []

  const before: Unit[] = []
  for (let k = 1; ; k++) {
    const c = col - dc * k
    const r = row - dr * k
    if (c < 0 || r < 0) break
    const u = glyphAtCell(units, cellIndex(board, c, r))
    if (!u) break
    before.unshift(u)
  }

  const after: Unit[] = []
  for (let k = 1; ; k++) {
    const c = col + dc * k
    const r = row + dr * k
    if (c >= board.cols || r >= board.rows) break
    const u = glyphAtCell(units, cellIndex(board, c, r))
    if (!u) break
    after.push(u)
  }

  return [...before, center, ...after]
}

function betterThan(a: CombineMatch, b: CombineMatch): boolean {
  const ta = TIER_ORDER[a.def.tier]
  const tb = TIER_ORDER[b.def.tier]
  if (ta !== tb) return ta > tb
  return a.def.recipe.length > b.def.recipe.length
}

/** 這組配方＋格子是否已經是場上的武將 */
function alreadyFormed(units: Unit[], match: CombineMatch): boolean {
  return units.some(
    (u) =>
      u.kind === 'general' &&
      u.defKey === match.def.name &&
      u.cells.length === match.cells.length &&
      u.cells.every((c, i) => c === match.cells[i]),
  )
}

/** 單一方向的最佳配方 */
function bestInOrientation(
  board: Board,
  units: Unit[],
  changedCell: number,
  orientation: 'h' | 'v',
): CombineMatch | null {
  const run = runThrough(board, units, changedCell, orientation)
  if (run.length < 2) return null
  const centerPos = run.findIndex((u) => u.cells[0] === changedCell)

  let best: CombineMatch | null = null
  // 只檢查「包含 changedCell」的子串：其他位置的組合在它們自己被放置時就已判定過
  const maxLen = Math.min(MAX_RECIPE_LEN, run.length)
  for (let len = 2; len <= maxLen; len++) {
    for (let start = Math.max(0, centerPos - len + 1); start <= Math.min(centerPos, run.length - len); start++) {
      const slice = run.slice(start, start + len)
      const def = RECIPE_INDEX.get(slice.map((u) => u.chars[0]).join(''))
      if (!def) continue
      const match: CombineMatch = {
        def,
        units: slice,
        cells: slice.map((u) => u.cells[0]),
        orientation,
      }
      if (alreadyFormed(units, match)) continue
      if (!best || betterThan(match, best)) best = match
    }
  }
  return best
}

/**
 * 判定放置／移動後觸發哪些合成。changedCell 是剛剛變動的格子。
 * 最多回傳兩個（橫向與縱向各一）。
 */
export function findCombinations(board: Board, units: Unit[], changedCell: number): CombineMatch[] {
  const out: CombineMatch[] = []
  for (const orientation of ['h', 'v'] as const) {
    const m = bestInOrientation(board, units, changedCell, orientation)
    if (m) out.push(m)
  }
  return out
}

/** 單一結果版本，給測試與只關心「有沒有」的呼叫端使用 */
export function findCombination(board: Board, units: Unit[], changedCell: number): CombineMatch | null {
  const all = findCombinations(board, units, changedCell)
  if (!all.length) return null
  return all.reduce((a, b) => (betterThan(b, a) ? b : a))
}

/**
 * 提示系統：列出「目前手上＋場上的字」理論上可湊出的配方名稱。
 * 這是寬鬆判定（不檢查相鄰性），只用於 UI 提示，不影響機制。
 */
export function possibleRecipes(units: Unit[], handChars: string[]): string[] {
  const pool = new Map<string, number>()
  for (const ch of handChars) pool.set(ch, (pool.get(ch) ?? 0) + 1)
  const onBoard = new Map<string, number>()
  const formed = new Set<string>()
  for (const u of units) {
    if (u.kind === 'general') {
      formed.add(u.defKey)
      continue
    }
    onBoard.set(u.chars[0], (onBoard.get(u.chars[0]) ?? 0) + 1)
  }

  const out: { name: string; tier: number }[] = []
  for (const [, def] of RECIPE_INDEX) {
    if (formed.has(def.name)) continue // 已經有了就不再提示
    const need = new Map<string, number>()
    for (const ch of def.recipe) need.set(ch, (need.get(ch) ?? 0) + 1)

    let ok = true
    let usesHand = false
    for (const [ch, n] of need) {
      const have = (pool.get(ch) ?? 0) + (onBoard.get(ch) ?? 0)
      if (have < n) {
        ok = false
        break
      }
      if ((pool.get(ch) ?? 0) > 0) usesHand = true
    }
    // 只提示「用得到手牌」的組合，否則場上早就該組好了
    if (ok && usesHand) out.push({ name: def.name, tier: TIER_ORDER[def.tier] })
  }

  return out
    .sort((a, b) => b.tier - a.tier)
    .slice(0, 3)
    .map((x) => x.name)
}
