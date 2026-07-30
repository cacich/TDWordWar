/**
 * 關卡表。
 * 地圖字元：S=出兵口  C=大營  #=路  P=空地  .=障礙
 * 每一列的長度必須等於 cols，否則 parseMap 會拋錯（有測試把關）。
 *
 * 有 `map` 就是固定地圖；有 `gen` 就是每局隨機生成（同種子 → 同地圖，見 sim/mapgen.ts）。
 *
 * 平衡基準：**傻 AI 的陣亡中位數應落在該關 maxWave 的一半**（`npm run sim`，±20% 內算達標）。
 * 這件事之所以能對每一關同時成立，是因為血量的指數吃「相對進度」而不是絕對波次
 * （見 sim/waves.ts 的 WAVE_REF）——所以 `maxWave` 同時是「關卡長度」與「難度弧的陡度」。
 * ⚠ 推論：**改 maxWave 會同時改難度**。把一關改短等於把同一條弧壓得更陡，不是只是少打幾波。
 * hpMul 退居微調（整個 0.55～1.28 區間只值約 2 個參考波），lives 則是容錯度。
 */
import type { EnemyTrait } from '../../sim/types'

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
  /**
   * 總波數。打完這一波就通關。
   * **無盡模式是 `Infinity`**（見本檔最後的「無盡模式」節）——`checkWaveEnd` 的
   * `wave >= maxWave` 因此永遠不成立，而 `enemyBaseHp` 會退回 `WAVE_REF` 當弧長。
   */
  maxWave: number
  /**
   * 無盡變體的標記。**只有 UI 讀它**（顯示「∞」與成績記在哪一份榜上），
   * sim 一律只看 `maxWave === Infinity`——沿用 Perks「中性預設值」的分層慣例，
   * 讓 sim 不必知道「無盡模式」這個上層概念存在。
   */
  endless?: boolean
  /** 難度：敵人血量倍率 */
  hpMul: number
  /**
   * 本局字池大小（見 sim/pool.ts）。
   * support = 抽幾個謀略／經濟字；generals = 抽幾組姓名配方（成組加入，不會有孤兒字）。
   * 數字越小越容易疊高與湊成配方，但變化也越少。
   */
  pool: { support: number; generals: number }
  /**
   * 關卡的敵人偏好。帶這些特徵的敵人出現權重 ×BIAS_WEIGHT（見 sim/waves.ts），
   * BOSS 的隨機挑選也吃同一份加權。
   *
   * 這個欄位同時決定關卡卡片上的「推薦手段」標籤——由 data/enemies.ts 的
   * countersFor() 經 TRAIT_COUNTERS 推導，**不要另外手寫推薦清單**，
   * 否則會出現兩份不同步的真相。
   */
  bias?: EnemyTrait[]
}

export const LEVEL_ORDER = [
  'huangjin', 'dongzhuo', 'julu', 'guandu', 'chibi', 'wuzhang',
  'xiangyang', 'hanzhong', 'luoyang',
] as const

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
    // 教學關不設偏好：先讓玩家認識最基本的賊與盾賊
    bias: [],
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
    // 飛賊變多，逼玩家準備射程 >= 2 的單位
    bias: ['flying'],
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
    // 蟻賊成群，範圍攻擊的價值第一次浮現
    bias: ['swarm'],
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
    // 快賊與疾風賊居多，需要控場攔下
    bias: ['fast'],
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
    // 重甲當道；灼燒無視防禦，火系在這關最強
    bias: ['armored'],
    gen: { cols: 9, rows: 15, minPathLen: 48, blockRate: 0.13 },
  },

  wuzhang: {
    key: 'wuzhang',
    name: '五丈原',
    subtitle: '★ 隨機地形。40 波挑戰，只有 2 條命',
    startFood: 28,
    lives: 2,
    maxWave: 40,
    hpMul: 1.1,
    pool: { support: 7, generals: 9 },
    // 妖道與高血敵人並存，考驗集火與持續輸出
    bias: ['healer', 'tanky'],
    gen: { cols: 9, rows: 16, minPathLen: 52 },
  },

  // ── 後三關：每一關針對一組特徵，把「該帶什麼」的答案收窄 ──
  xiangyang: {
    key: 'xiangyang',
    name: '襄陽',
    subtitle: '★ 隨機地形。蟻賊與分裂賊成潮，沒有範圍攻擊會被淹沒',
    startFood: 28,
    lives: 3,
    maxWave: 32,
    hpMul: 1.25,
    pool: { support: 7, generals: 8 },
    bias: ['swarm', 'splitter'],
    gen: { cols: 9, rows: 15, minPathLen: 50 },
  },

  hanzhong: {
    key: 'hanzhong',
    name: '漢中',
    subtitle: '★ 隨機地形。清一色重甲與高血，普通攻擊幾乎打不動',
    startFood: 30,
    lives: 3,
    maxWave: 32,
    hpMul: 1.2,
    pool: { support: 7, generals: 8 },
    bias: ['armored', 'tanky'],
    gen: { cols: 9, rows: 16, minPathLen: 54, blockRate: 0.1 },
  },

  luoyang: {
    key: 'luoyang',
    name: '洛陽',
    subtitle: '★ 隨機地形。最終關。飛行、高速與治療同時上陣',
    startFood: 32,
    lives: 2,
    maxWave: 40,
    hpMul: 1.28,
    pool: { support: 8, generals: 10 },
    bias: ['flying', 'fast', 'healer'],
    gen: { cols: 9, rows: 17, minPathLen: 58, blockRate: 0.08 },
  },
}

export const JULU = LEVELS.julu

// ── 無盡模式 ──────────────────────────────────────────
/**
 * 無盡＝「同一關，但沒有終點」。地圖、字池、敵人偏好、`hpMul`、生命全部沿用原關，
 * 只把 `maxWave` 換成 `Infinity`。所以它不是 9 個新關卡，而是 9 個既有關卡的**推導變體**
 * （`endlessOf()`）——原關改數值，無盡版自動跟著改，不會出現兩份會不同步的真相。
 *
 * ★ 難度弧：血量的指數吃「相對進度」`wave × WAVE_REF / maxWave`（見 sim/waves.ts），
 *   而 `Infinity` 會讓相對進度永遠是 0、血量永不成長。因此 `enemyBaseHp` 對非有限的
 *   `maxWave` 退回 `WAVE_REF`，也就是**無盡一律走 40 波的參考弧**（`HP_GROWTH^wave`）。
 *
 * ⚠ 推論（反直覺，但是刻意的）：無盡的難度只由 `hpMul`／`lives`／字池區分，
 *   **與原關的 `maxWave` 無關**。黃巾（12 波）的無盡版反而是最長的一條路——
 *   它的原關把同一條 40 波的弧壓縮了 3.3 倍，攤平回來自然變長。
 *
 * 為什麼不註冊進 `LEVEL_ORDER`：那條陣列是「流程」，被解鎖鏈、每日挑戰輪替與
 * 「天下歸心」成就的門檻共用。無盡是支線，混進去會同時弄壞這三件事。
 */
export const ENDLESS_PREFIX = 'endless_'

export function endlessKeyOf(baseKey: string): string {
  return ENDLESS_PREFIX + baseKey
}

export function isEndlessKey(key: string): boolean {
  return key.startsWith(ENDLESS_PREFIX)
}

/** 無盡關卡 key → 原關 key；本來就是原關 key 時原樣回傳 */
export function baseKeyOf(key: string): string {
  return isEndlessKey(key) ? key.slice(ENDLESS_PREFIX.length) : key
}

function endlessOf(base: LevelDef): LevelDef {
  return { ...base, key: endlessKeyOf(base.key), name: `${base.name}・無盡`, maxWave: Infinity, endless: true }
}

/** 無盡關卡的顯示順序，與 `LEVEL_ORDER` 一一對應 */
export const ENDLESS_ORDER = LEVEL_ORDER.map(endlessKeyOf)

// 註冊進 LEVELS：createGame 與續玩還原都只認得 LEVELS，沒註冊就開不起來
for (const key of LEVEL_ORDER) LEVELS[endlessKeyOf(key)] = endlessOf(LEVELS[key])
