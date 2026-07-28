/**
 * 棋盤解析與路徑計算。純邏輯，可在 Node 直接測試。
 * 路徑用 BFS 預先算成 waypoint 序列，執行期不做即時尋路（效能可預測）。
 */
import type { Board, TileKind } from './types'

const CHAR_TO_KIND: Record<string, TileKind> = {
  S: 'spawn',
  C: 'camp',
  '#': 'path',
  P: 'plot',
  '.': 'block',
}

/**
 * 解析地圖字串。固定關卡與隨機生成的地圖都走這裡，
 * 所以任何地圖都會經過「S 到 C 必須連通」的檢查（findPath 會拋錯）。
 */
export function parseMap(map: string[], label = ''): Board {
  const rows = map.length
  const cols = map[0].length
  const tiles: TileKind[] = []
  let spawn = -1
  let camp = -1

  for (let r = 0; r < rows; r++) {
    const line = map[r]
    if (line.length !== cols) {
      throw new Error(`地圖 ${label} 第 ${r} 列長度 ${line.length}，應為 ${cols}`)
    }
    for (let c = 0; c < cols; c++) {
      const kind = CHAR_TO_KIND[line[c]]
      if (!kind) throw new Error(`地圖 ${label} 出現未知地形字元「${line[c]}」`)
      const idx = r * cols + c
      tiles[idx] = kind
      if (kind === 'spawn') spawn = idx
      if (kind === 'camp') camp = idx
    }
  }
  if (spawn < 0 || camp < 0) throw new Error(`地圖 ${label} 缺少 S 或 C`)

  const board: Board = { cols, rows, tiles, path: [], spawn, camp }
  board.path = findPath(board)
  return board
}

const WALKABLE: TileKind[] = ['path', 'spawn', 'camp']

export function findPath(board: Board): number[] {
  const { cols, rows, tiles, spawn, camp } = board
  const prev = new Int32Array(cols * rows).fill(-1)
  const seen = new Uint8Array(cols * rows)
  const queue: number[] = [spawn]
  seen[spawn] = 1

  while (queue.length) {
    const cur = queue.shift()!
    if (cur === camp) break
    for (const nb of neighbors4(board, cur)) {
      if (seen[nb]) continue
      if (!WALKABLE.includes(tiles[nb])) continue
      seen[nb] = 1
      prev[nb] = cur
      queue.push(nb)
    }
  }

  if (!seen[camp]) throw new Error('出兵口無法抵達大營，請檢查地圖的路徑連通性')

  const path: number[] = []
  for (let cur = camp; cur !== -1; cur = prev[cur]) path.push(cur)
  path.reverse()
  return path
}

export function neighbors4(board: Board, idx: number): number[] {
  const { cols, rows } = board
  const c = idx % cols
  const r = (idx - c) / cols
  const out: number[] = []
  if (r > 0) out.push(idx - cols)
  if (r < rows - 1) out.push(idx + cols)
  if (c > 0) out.push(idx - 1)
  if (c < cols - 1) out.push(idx + 1)
  return out
}

export function cellCol(board: Board, idx: number): number {
  return idx % board.cols
}
export function cellRow(board: Board, idx: number): number {
  return Math.floor(idx / board.cols)
}
export function cellIndex(board: Board, col: number, row: number): number {
  return row * board.cols + col
}
export function inBounds(board: Board, col: number, row: number): boolean {
  return col >= 0 && col < board.cols && row >= 0 && row < board.rows
}
/** 格子中心座標，單位為「格」 */
export function cellCenter(board: Board, idx: number): { x: number; y: number } {
  return { x: cellCol(board, idx) + 0.5, y: cellRow(board, idx) + 0.5 }
}
export function isPlot(board: Board, idx: number): boolean {
  return board.tiles[idx] === 'plot'
}
