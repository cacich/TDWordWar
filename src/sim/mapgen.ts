/**
 * 隨機地圖生成器。
 *
 * ★ 為什麼不可能有死路：路徑是「先畫出來的」，不是事後檢查的。
 *   我們先用隨機參數畫出一條從最上列到最下列的連續走廊，再把其餘格子填成空地。
 *   因為走廊本身逐格相連，S 到 C 必然連通。
 *
 * ★ 走廊性質（induced path，任兩個非相鄰的走廊格不會彼此貼邊）：
 *   橫向段之間至少隔 2 列，垂直連接段只在端點接觸橫向段。
 *   這帶來三個好處：
 *     1. 走廊兩側必然留有可放置的空地
 *     2. 沒有捷徑 → parseMap() 的 BFS 最短路 == 這裡畫出的走廊（有測試把關）
 *     3. 不會出現分岔造成的「假路口」
 *
 * ★ 為什麼不用 DFS 亂挖：試過了。在 induced path 的限制下，隨機 DFS 很容易把自己封死，
 *   即使大量重試也常常只能挖出很短的路（9×14 大約只有 38 格，達不到 44 的門檻），
 *   於是幾乎每次都退回保險版型，反而失去隨機性。
 *   蛇形骨架 + 隨機參數則是「由構造保證合法」，一次成功。
 */
import { randInt } from '../core/rng'

export interface GenOpts {
  cols: number
  rows: number
  /** 路徑至少要這麼長，太短的關卡不好玩 */
  minPathLen: number
  /** 空地變成障礙的機率 */
  blockRate?: number
}

const MAX_ATTEMPTS = 24
/** 橫向段最短長度。太短會讓路變成一直往下掉，不好玩 */
const MIN_RUN = 4

export function generateMap(rng: () => number, opts: GenOpts): string[] {
  const { cols, rows, minPathLen } = opts
  let best: number[] = []

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 重試越多次就越偏好走滿整列，確保最後一定能達到長度門檻
    const fullRunChance = 0.5 + attempt * 0.02
    const path = carve(rng, cols, rows, fullRunChance)
    if (path.length > best.length) best = path
    if (path.length >= minPathLen) break
  }

  return paint(rng, cols, rows, best, opts.blockRate ?? 0.07)
}

/**
 * 畫出蛇形走廊：一段橫走 → 往下 2～3 列 → 反向橫走 → …… → 落到最下列。
 * 回傳依序的 cell 索引。
 */
function carve(rng: () => number, cols: number, rows: number, fullRunChance: number): number[] {
  const idx = (c: number, r: number) => r * cols + c
  const path: number[] = []

  let col = randInt(rng, 0, cols - 1)
  let row = 0
  let dir = col <= (cols - 1) / 2 ? 1 : -1 // 從離自己較遠的那一側開始走，路才長
  path.push(idx(col, row))

  for (let guard = 0; guard < rows; guard++) {
    // ── 橫走 ──
    const room = dir > 0 ? cols - 1 - col : col
    if (room >= MIN_RUN) {
      const goFull = rng() < fullRunChance
      const steps = goFull ? room : randInt(rng, MIN_RUN, room)
      for (let i = 0; i < steps; i++) {
        col += dir
        path.push(idx(col, row))
      }
    }
    dir = -dir

    // ── 往下 ──
    const gap = rng() < 0.65 ? 2 : 3
    if (row + gap > rows - 1) break
    for (let k = 1; k <= gap; k++) path.push(idx(col, row + k))
    row += gap
  }

  // ── 收尾：垂直落到最下列當作大營 ──
  for (let r = row + 1; r <= rows - 1; r++) path.push(idx(col, r))

  return path
}

/** 把路徑塗成地圖字串；其餘格子是空地，少量變成障礙 */
function paint(
  rng: () => number,
  cols: number,
  rows: number,
  path: number[],
  blockRate: number,
): string[] {
  const tiles: string[] = new Array(cols * rows).fill('P')
  for (const cell of path) tiles[cell] = '#'
  tiles[path[0]] = 'S'
  tiles[path[path.length - 1]] = 'C'

  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === 'P' && rng() < blockRate) tiles[i] = '.'
  }

  const out: string[] = []
  for (let r = 0; r < rows; r++) out.push(tiles.slice(r * cols, (r + 1) * cols).join(''))
  return out
}
