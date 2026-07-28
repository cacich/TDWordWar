/**
 * 關卡表。
 * 地圖字元：S=出兵口  C=大營  #=路  P=空地  .=障礙
 * 每一列的長度必須等於 cols，否則 parseMap 會拋錯（有測試把關）。
 *
 * 有 `map` 就是固定地圖；有 `gen` 就是每局隨機生成（同種子 → 同地圖，見 sim/mapgen.ts）。
 */
export interface LevelDef {
  key: string
  name: string
  subtitle: string
  /** 固定地圖 */
  map?: string[]
  /** 隨機地圖參數 */
  gen?: { cols: number; rows: number; minPathLen: number; blockRate?: number }
  startFood: number
  lives: number
  maxWave: number
  /** 難度：敵人血量倍率 */
  hpMul: number
  /**
   * 本局字池大小（見 sim/pool.ts）。
   * support = 抽幾個謀略／經濟字；generals = 抽幾組姓名配方（成組加入，不會有孤兒字）。
   * 數字越小越容易疊高與湊成配方，但變化也越少。
   */
  pool: { support: number; generals: number }
}

export const LEVEL_ORDER = ['huangjin', 'dongzhuo', 'julu', 'guandu', 'chibi', 'wuzhang'] as const

export const LEVELS: Record<string, LevelDef> = {
  huangjin: {
    key: 'huangjin',
    name: '黃巾之亂',
    subtitle: '教學關。認識兵器字與「兵」的組詞',
    startFood: 26,
    lives: 4,
    maxWave: 12,
    hpMul: 0.85,
    pool: { support: 2, generals: 3 },
    map: [
      'S########',
      'PPPPPPPP#',
      'PPPPPPPP#',
      '#########',
      '#PPPPPPPP',
      '#PPPPPPPP',
      '#########',
      'PPPPPPPP#',
      'PPPPPPPP#',
      '#########',
      'PPPPPPPPC',
    ],
  },

  dongzhuo: {
    key: 'dongzhuo',
    name: '討伐董卓',
    subtitle: '出兵口在右上。開始出現盾賊與飛賊',
    startFood: 24,
    lives: 3,
    maxWave: 18,
    hpMul: 1.0,
    pool: { support: 3, generals: 4 },
    map: [
      '########S',
      '#PPPPPPPP',
      '#PP..PPPP',
      '#########',
      'PPPPPPPP#',
      'PPP..PPP#',
      '#########',
      '#PPPPPPPP',
      '#PP..PPPP',
      '#########',
      'PPPPPPPP#',
      'PPP..PPP#',
      'C########',
    ],
  },

  julu: {
    key: 'julu',
    name: '巨鹿',
    subtitle: '經典蛇形長路，30 波',
    startFood: 22,
    lives: 3,
    maxWave: 30,
    hpMul: 1.15,
    pool: { support: 4, generals: 6 },
    map: [
      'S########',
      'PPPPPPPP#',
      'PPPPPPPP#',
      '#########',
      '#PPPPPPPP',
      '#PPPPPPPP',
      '#########',
      'PPPPPPPP#',
      'PPPPPPPP#',
      '#########',
      '#PPPPPPPP',
      '#PPPPPPPP',
      '#########',
      'PPPPPPPPC',
    ],
  },

  guandu: {
    key: 'guandu',
    name: '官渡',
    subtitle: '★ 隨機地形。每局的路都不一樣',
    startFood: 24,
    lives: 3,
    maxWave: 24,
    hpMul: 1.1,
    pool: { support: 5, generals: 6 },
    gen: { cols: 9, rows: 14, minPathLen: 44 },
  },

  chibi: {
    key: 'chibi',
    name: '赤壁',
    subtitle: '★ 隨機地形。地形破碎，落點更難挑',
    startFood: 26,
    lives: 3,
    maxWave: 30,
    hpMul: 1.2,
    pool: { support: 6, generals: 7 },
    gen: { cols: 9, rows: 15, minPathLen: 48, blockRate: 0.13 },
  },

  wuzhang: {
    key: 'wuzhang',
    name: '五丈原',
    subtitle: '★ 隨機地形。40 波挑戰，只有 2 條命',
    startFood: 28,
    lives: 2,
    maxWave: 40,
    hpMul: 1.3,
    pool: { support: 7, generals: 9 },
    gen: { cols: 9, rows: 16, minPathLen: 52 },
  },
}

export const JULU = LEVELS.julu
