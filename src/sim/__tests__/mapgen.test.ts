import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../core/rng'
import { LEVELS, LEVEL_ORDER } from '../../data/levels'
import { parseMap } from '../board'
import { generateMap } from '../mapgen'
import { createGame } from '../state'
import { WAVE_REF, enemyBaseHp } from '../waves'

const GEN_LEVELS = LEVEL_ORDER.filter((k) => LEVELS[k].gen)

describe('隨機地圖生成', () => {
  it('大量隨機種子都能產生連通的地圖（不會有死路）', () => {
    // parseMap 的 findPath 走不到大營就會拋錯，所以「沒拋錯」等於「沒死路」
    for (const key of GEN_LEVELS) {
      const gen = LEVELS[key].gen!
      for (let seed = 1; seed <= 60; seed++) {
        const map = generateMap(mulberry32(seed * 7919), gen)
        const board = parseMap(map, `${key}#${seed}`)
        expect(board.path[0]).toBe(board.spawn)
        expect(board.path[board.path.length - 1]).toBe(board.camp)
        expect(board.path.length).toBeGreaterThanOrEqual(gen.minPathLen)
      }
    }
  })

  it('路徑是單寬走廊：可走格子數 == 路徑長度（沒有分岔或捷徑）', () => {
    // 這個性質很重要：它保證 BFS 最短路就是生成時挖出的那條路，
    // 敵人不會走出設計者沒預期的捷徑。
    for (let seed = 1; seed <= 40; seed++) {
      const gen = LEVELS.guandu.gen!
      const map = generateMap(mulberry32(seed * 104729), gen)
      const walkable = map.join('').split('').filter((c) => c === '#' || c === 'S' || c === 'C').length
      const board = parseMap(map, `corridor#${seed}`)
      expect(board.path.length).toBe(walkable)
    }
  })

  it('出兵口在最上列、大營在最下列', () => {
    const gen = LEVELS.chibi.gen!
    for (let seed = 1; seed <= 20; seed++) {
      const map = generateMap(mulberry32(seed * 31), gen)
      expect(map[0]).toContain('S')
      expect(map[map.length - 1]).toContain('C')
    }
  })

  it('留下足夠的可放置空地', () => {
    const gen = LEVELS.guandu.gen!
    for (let seed = 1; seed <= 20; seed++) {
      const map = generateMap(mulberry32(seed * 13), gen)
      const plots = map.join('').split('').filter((c) => c === 'P').length
      expect(plots).toBeGreaterThan(30)
    }
  })

  it('同一顆種子產生同一張地圖（可重現）', () => {
    const gen = LEVELS.wuzhang.gen!
    expect(generateMap(mulberry32(12345), gen)).toEqual(generateMap(mulberry32(12345), gen))
  })

  it('隨機關卡可以正常開局，且不同種子地圖不同', () => {
    const a = createGame('guandu', 1)
    const b = createGame('guandu', 2)
    expect(a.board.path.length).toBeGreaterThan(40)
    expect(a.board.tiles).not.toEqual(b.board.tiles)
  })
})

describe('固定地圖', () => {
  /**
   * 每一格路都要在敵人真正會走的那條路上。
   *
   * ⚠ 這條測試存在的理由：黃巾之亂原本把大營放在右下角，而最後一段路是往左走的，
   * 於是第 9 列往左的 8 格變成沒有出口的死路——玩家看到一條走到底卻什麼都沒有的路，
   * 敵人卻在半路轉下去進營。地圖畫錯不會拋錯（findPath 照樣找得到營），只會安靜地誤導人。
   */
  it('沒有走不到的路格（畫出來的路 == 敵人走的路）', () => {
    for (const key of LEVEL_ORDER) {
      const map = LEVELS[key].map
      if (!map) continue
      const board = parseMap(map, key)
      const onPath = new Set(board.path)
      const orphan = board.tiles
        .map((t, i) => ({ t, i }))
        .filter((x) => x.t === 'path' && !onPath.has(x.i))
        .map((x) => `(${x.i % board.cols},${Math.floor(x.i / board.cols)})`)
      expect(orphan, `${key} 有走不到的路格`).toEqual([])
    }
  })
})

describe('關卡難度', () => {
  it('hpMul 會套用到敵人血量', () => {
    const easy = createGame('huangjin', 5)
    const hard = createGame('wuzhang', 5)
    expect(easy.hpMul).toBeLessThan(hard.hpMul)
  })

  /**
   * 難度曲線的契約：`arc`（難度弧長度）才是難度旋鈕，`maxWave` 只是長度。
   * 曾經沒有 arc、九關一律走完整條參考弧，於是九關的難度完全一樣平
   * （傻 AI 在每一關都死在正中間），而最短的教學關反而是最陡的一段。
   */
  it('主線九關的 arc 逐關不遞減，最後一關明顯比教學關長', () => {
    const arcs = LEVEL_ORDER.map((k) => LEVELS[k].arc)
    for (let i = 1; i < arcs.length; i++) {
      expect(arcs[i], `${LEVEL_ORDER[i]} 的 arc 不該比前一關短`).toBeGreaterThanOrEqual(arcs[i - 1])
    }
    expect(arcs[arcs.length - 1]).toBeGreaterThan(arcs[0] * 1.5)
  })

  it('教學關的每波血量成長遠比舊版（整條參考弧壓進 12 波）平緩', () => {
    const lv = LEVELS.huangjin
    const step = (arc: number) =>
      enemyBaseHp(2, lv.maxWave, arc) / enemyBaseHp(1, lv.maxWave, arc)
    expect(step(lv.arc)).toBeLessThan(1.45)
    expect(step(WAVE_REF)).toBeGreaterThan(1.9) // 舊版：每波幾乎兩倍
  })
})
