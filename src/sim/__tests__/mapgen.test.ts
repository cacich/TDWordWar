import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../core/rng'
import { LEVELS, LEVEL_ORDER } from '../../data/levels'
import { parseMap } from '../board'
import { generateMap } from '../mapgen'
import { createGame } from '../state'

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

describe('關卡難度', () => {
  it('hpMul 會套用到敵人血量', () => {
    const easy = createGame('huangjin', 5)
    const hard = createGame('wuzhang', 5)
    expect(easy.hpMul).toBeLessThan(hard.hpMul)
  })
})
