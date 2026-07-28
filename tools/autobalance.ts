/**
 * 自動平衡模擬：讓一個「傻 AI」用固定策略打完整局，統計陣亡波次。
 * 因為 sim/ 完全不依賴 DOM，可以直接在 Node 跑：npm run sim
 *
 * 用途：改完數值後跑一次，看難度曲線有沒有歪掉，而不是靠手感猜。
 */
import { mulberry32 } from '../src/core/rng'
import { placeFromHand, recruit } from '../src/sim/actions'
import { cellCol, cellRow, isPlot } from '../src/sim/board'
import { findCombination } from '../src/sim/combine'
import { recruitCost } from '../src/sim/economy'
import { createGame, makeGlyphUnit, glyphAt } from '../src/sim/state'
import { stepGame } from '../src/sim/step'
import type { GameState } from '../src/sim/types'

const GAMES = Number(process.argv[2] ?? 30)
/** 第二個參數選關：npm run sim 30 guandu */
const LEVEL = process.argv[3] ?? 'julu'
const FIXED_DT = 1 / 60

/** 候選空地：離路徑越近越優先（射程才夠得到） */
function candidateCells(state: GameState): number[] {
  const b = state.board
  const pathCells = b.path.map((p) => ({ c: cellCol(b, p), r: cellRow(b, p) }))
  const out: { cell: number; d: number }[] = []
  for (let i = 0; i < b.tiles.length; i++) {
    if (!isPlot(b, i)) continue
    const c = cellCol(b, i)
    const r = cellRow(b, i)
    let best = Infinity
    for (const p of pathCells) best = Math.min(best, Math.hypot(p.c - c, p.r - r))
    out.push({ cell: i, d: best })
  }
  return out.sort((a, b2) => a.d - b2.d).map((x) => x.cell)
}

/**
 * 落點決策，優先序模擬一般玩家的直覺：
 *   1. 能立刻組成武將
 *   2. 能疊到同字同階的字牌上升階（組成武將後也能疊，武將會同步變強）
 *   3. 最靠近路徑的空位
 */
function chooseCell(state: GameState, char: string, level: number, cells: number[]): number | null {
  let stack: number | null = null
  let fallback: number | null = null
  for (const cell of cells) {
    const occupant = glyphAt(state, cell)
    if (occupant) {
      if (stack === null && occupant.chars[0] === char && occupant.level === level && occupant.level < 5) {
        stack = cell
      }
      continue
    }
    if (fallback === null) fallback = cell
    const probe = makeGlyphUnit(state, char, level, cell)
    const m = findCombination(state.board, [...state.units, probe], cell)
    if (m) return cell
  }
  return stack ?? fallback
}

function playOne(seed: number): { wave: number; kills: number; units: number } {
  const state = createGame(LEVEL, seed)
  const cells = candidateCells(state)
  let guard = 0

  while (state.phase !== 'lost' && state.phase !== 'won' && guard++ < 60 * 60 * 40) {
    if (state.phase === 'prep') {
      while (state.food >= recruitCost(state) && state.hand.some((h) => h === null)) {
        if (!recruit(state).ok) break
      }
      for (let i = 0; i < state.hand.length; i++) {
        const card = state.hand[i]
        if (!card) continue
        const cell = chooseCell(state, card.char, card.level, cells)
        if (cell === null) break
        placeFromHand(state, i, cell)
      }
    }
    stepGame(state, FIXED_DT)
  }

  return { wave: state.wave, kills: state.stats.kills, units: state.units.length }
}

const rng = mulberry32(20260727)
const results: number[] = []
for (let i = 0; i < GAMES; i++) {
  const seed = Math.floor(rng() * 1e9)
  const r = playOne(seed)
  results.push(r.wave)
}

results.sort((a, b) => a - b)
const avg = results.reduce((a, b) => a + b, 0) / results.length
const median = results[Math.floor(results.length / 2)]

console.log(`\n=== 自動平衡：${LEVEL} × ${GAMES} 局 ===`)
console.log(`陣亡／完成波次  平均 ${avg.toFixed(1)}  中位數 ${median}  最低 ${results[0]}  最高 ${results[results.length - 1]}`)

const hist = new Map<number, number>()
for (const w of results) {
  const bucket = Math.floor(w / 5) * 5
  hist.set(bucket, (hist.get(bucket) ?? 0) + 1)
}
for (const [bucket, n] of [...hist.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`第 ${String(bucket).padStart(2)}–${bucket + 4} 波  ${'█'.repeat(n)} ${n}`)
}
console.log('\n目標：中位數落在 12～20 波之間（傻 AI 的水準）。太高表示太簡單，太低表示前期太硬。\n')
