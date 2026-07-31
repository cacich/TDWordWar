/**
 * 關卡表。
 * 地圖字元：S=出兵口  C=大營  #=路  P=空地  .=障礙
 * 每一列的長度必須等於 cols，否則 parseMap 會拋錯（有測試把關）。
 *
 * 有 `map` 就是固定地圖；有 `gen` 就是每局隨機生成（同種子 → 同地圖，見 sim/mapgen.ts）。
 *
 * ★ 難度由 `arc`（難度弧長度，單位是「參考波」）決定，`maxWave` 只決定長度：
 *   血量的指數吃 `wave × arc / maxWave`（見 sim/waves.ts），所以
 *   **`arc` 越大這一關越難**，而改 `maxWave` 只是改「打幾波」，不再連帶改陡度。
 *
 * 平衡基準：`npm run sim 16 all` 量傻 AI 在主線各關的陣亡中位數，`arc` 直接換算成預期比例——
 *   傻 AI 大約死在弧上的第 20 個參考波，所以 **中位數 ≈ maxWave × 20 / arc**。
 *   arc = 40 → 死在一半；arc = 20 → 剛好打到底（教學關要的就是這個）。
 *
 * ⚠ 主線的 arc 刻意**逐關不遞減**，量出來的「抵達比例」因此一路遞減，
 *   這才是「越後面越難」的來源。以前沒有 arc、每一關一律走完整條參考弧，
 *   難度就完全一樣平（比例全是 0.5），而最短的教學關反而是全遊戲最陡的一段（每波血量 ×1.99）。
 * ⚠ arc 不是「照關卡順序等差」就會對：生命數與字池也算難度，
 *   所以 2 條命的五丈原用的弧比 3 條命的襄陽短。看的是量出來的比例，不是 arc 本身好不好看。
 * ⚠ **驗收看的是「比例」的排序，不是「偏差」那一欄**：實際比例 ≈ k / arc，預期比例 = 20 / arc，
 *   兩者同時吃 arc，所以偏差百分比其實**對 arc 不敏感**（它量的是 k，也就是這一關的
 *   地圖／生命／字池讓傻 AI 比參考值多撐了幾成）。要修正的是排序，調 arc 就對了。
 * hpMul 退居微調（整個 0.55～1.30 區間只值約 2 個參考波），lives 則是容錯度。
 * 另外還有一條與血量無關的軸：戰場特性 `mods`（見下方 `LevelDef.mods`）。
 */
import type { EnemyTrait, LevelMods } from '../../sim/types'

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
   * 總波數。打完這一波就通關。**只管長度，不管難度**（難度看 `arc`）。
   * **無盡模式是 `Infinity`**（見本檔最後的「無盡模式」節）——`checkWaveEnd` 的
   * `wave >= maxWave` 因此永遠不成立，而 `enemyBaseHp` 會退回絕對波次那條曲線。
   */
  maxWave: number
  /**
   * 難度弧長度（參考波）。這一關要在 `maxWave` 波之內走完 `arc` 個參考波，
   * 所以它是**唯一的難度主旋鈕**：40 = 完整參考弧（傻 AI 死在中間），越小越簡單。
   * 預期的傻 AI 陣亡中位數 ≈ `maxWave × 20 / arc`，改完請跑 `npm run sim` 對一下。
   */
  arc: number
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
  /**
   * 戰場特性（見 sim/types.ts 的 `LevelMods`）。
   * 每個欄位都是**中性預設值**，省略＝舊行為，所以既有關卡完全不受影響。
   *
   * ⚠ 它會實質改變難度，而 `arc` 換算出的預期比例並不知道這件事——
   *   加了 mods 的關卡一定要跑 `npm run sim 12 <key>` 重新對 `arc`。
   */
  mods?: LevelMods
}

/**
 * 戰場特性 → 玩家看得懂的一句話。**UI 只讀這裡**，不要在關卡資料裡另外手寫說明，
 * 否則會跟 `mods` 變成兩份會不同步的真相（跟 `bias` → `countersFor` 同一個慣例）。
 */
export function modTags(level: LevelDef): string[] {
  const m = level.mods
  if (!m) return []
  const out: string[] = []
  if (m.bossEvery !== undefined) out.push(`每 ${m.bossEvery} 波就有賊將`)
  if (m.spawnGap !== undefined) out.push('賊潮不絕（出怪更密集）')
  if (m.enemySpeedMul !== undefined && m.enemySpeedMul !== 1) {
    out.push(`敵軍行軍 ×${m.enemySpeedMul.toFixed(2)}`)
  }
  if (m.rangeMul !== undefined && m.rangeMul !== 1) {
    out.push(`濃霧：我軍射程 ×${m.rangeMul.toFixed(2)}`)
  }
  return out
}

export const LEVEL_ORDER = [
  'huangjin', 'dongzhuo', 'julu', 'guandu', 'chibi', 'wuzhang',
  'xiangyang', 'hanzhong', 'luoyang', 'hefei', 'hulao', 'xuchang',
] as const

export const LEVELS: Record<string, LevelDef> = {
  huangjin: {
    key: 'huangjin',
    name: '黃巾之亂',
    subtitle: '教學關。認識兵器字與「兵」的組詞',
    startFood: 26,
    lives: 4,
    maxWave: 12,
    // 全遊戲最短的弧：教學關要讓「照直覺玩」的人打得完，血量每波只成長 ×1.41
    // （同一張表在有 arc 之前是 ×1.99——教學關比最終關還陡，這是本作最久的一個平衡錯誤）
    arc: 20,
    hpMul: 0.85,
    pool: { support: 2, generals: 3 },
    // 教學關不設偏好：先讓玩家認識最基本的賊與盾賊
    bias: [],
    // ⚠ 大營在左下角，因為最後一段路是「往左走完第 9 列」。
    //   營若放在右下角（曾經如此），第 9 列往左的那 8 格就變成沒有出口的死路：
    //   畫面上看得到一條走到底卻什麼都沒有的路，敵人卻在半路就轉下去進營。
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
      'CPPPPPPPP',
    ],
  },

  dongzhuo: {
    key: 'dongzhuo',
    name: '討伐董卓',
    subtitle: '出兵口在右上。開始出現盾賊與飛賊',
    startFood: 24,
    lives: 3,
    maxWave: 18,
    // 第二關開始拉：弧比黃巾長，但仍遠短於參考弧
    arc: 23,
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
    arc: 28,
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
    arc: 31,
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
    arc: 31,
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
    // 只有 2 條命，所以弧跟赤壁一樣長就已經比它難（漏一隻的代價高一倍）
    arc: 32,
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
    arc: 39,
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
    arc: 39,
    hpMul: 1.2,
    pool: { support: 7, generals: 8 },
    bias: ['armored', 'tanky'],
    gen: { cols: 9, rows: 16, minPathLen: 54, blockRate: 0.1 },
  },

  luoyang: {
    key: 'luoyang',
    name: '洛陽',
    subtitle: '★ 隨機地形。飛行、高速與治療同時上陣',
    startFood: 32,
    lives: 2,
    maxWave: 40,
    arc: 44,
    hpMul: 1.28,
    pool: { support: 8, generals: 10 },
    bias: ['flying', 'fast', 'healer'],
    gen: { cols: 9, rows: 17, minPathLen: 58, blockRate: 0.08 },
  },

  // ── 終盤三關：難度不再只靠血量，改由「戰場特性」各自扭一個規則 ──
  // 每一關動的是不同的旋鈕（出怪節奏／BOSS 密度／我方射程），
  // 所以就算血量曲線一樣，玩家要換的東西完全不同。三關的 arc 都跑過 sim 對過。
  hefei: {
    key: 'hefei',
    name: '合肥',
    subtitle: '★ 隨機地形。逍遙津。賊潮不絕，出怪間隔只有一半',
    startFood: 30,
    lives: 3,
    maxWave: 36,
    arc: 45,
    hpMul: 1.2,
    pool: { support: 8, generals: 9 },
    // 出怪間隔砍半＝同時在場的敵人約兩倍，逼玩家非有清場能力不可
    mods: { spawnGap: 0.4 },
    bias: ['swarm', 'fast'],
    gen: { cols: 9, rows: 16, minPathLen: 54 },
  },

  hulao: {
    key: 'hulao',
    name: '虎牢關',
    subtitle: '固定關隘長路。每 3 波就有一名賊將壓陣',
    startFood: 30,
    lives: 3,
    maxWave: 30,
    arc: 47,
    hpMul: 1.15,
    pool: { support: 8, generals: 9 },
    // BOSS 從每 5 波變成每 3 波：這一關考的是「隨時都要有能打 BOSS 的爆發」，
    // 而不是「靠雜兵波喘口氣、只在第 5 波拚一次」
    mods: { bossEvery: 3 },
    bias: ['tanky', 'armored'],
    // ⚠ 蛇形長路，列與列之間一律隔 2 列（只有第 13 列是單格連接），
    //   確保 BFS 最短路 == 畫出來的路，不會有走不到的路格（mapgen.test.ts 會抓）
    map: [
      'S########',
      'PPPPPPPP#',
      'PP..PPPP#',
      '#########',
      '#PPPPPPPP',
      '#PPP..PPP',
      '#########',
      'PPPPPPPP#',
      'PPPP..PP#',
      '#########',
      '#PPPPPPPP',
      '#PP..PPPP',
      '#########',
      'PPPPPPPP#',
      'C########',
    ],
  },

  xuchang: {
    key: 'xuchang',
    name: '許昌',
    subtitle: '★ 隨機地形。最終關。夜霧壓境，我軍射程受限',
    startFood: 34,
    lives: 2,
    maxWave: 40,
    arc: 49,
    hpMul: 1.3,
    pool: { support: 9, generals: 11 },
    // 射程 −15% 會把「塔擺在哪裡」的容錯度整個收窄；行軍加速再壓縮反應時間。
    // 這兩個旋鈕都不改血量，所以它難的地方跟前面每一關都不一樣
    mods: { rangeMul: 0.85, enemySpeedMul: 1.1 },
    bias: ['healer', 'armored', 'fast'],
    gen: { cols: 9, rows: 17, minPathLen: 60, blockRate: 0.08 },
  },
}

export const JULU = LEVELS.julu

// ── 無盡模式 ──────────────────────────────────────────
/**
 * 無盡＝「同一關，但沒有終點」。地圖、字池、敵人偏好、`hpMul`、生命全部沿用原關，
 * 只把 `maxWave` 換成 `Infinity`。所以它不是 新關卡，而是每個既有關卡的**推導變體**
 * （`endlessOf()`）——原關改數值，無盡版自動跟著改，不會出現兩份會不同步的真相。
 *
 * ★ 難度弧：血量的指數吃「相對進度」`wave × arc / maxWave`（見 sim/waves.ts），
 *   而 `Infinity` 會讓相對進度永遠是 0、血量永不成長。因此 `enemyBaseHp` 對非有限的
 *   `maxWave` 一律改走絕對波次（`HP_GROWTH^wave`），也就是**無盡都是 40 波的參考弧**。
 *   `endlessOf()` 因此把 `arc` 明寫成 `WAVE_REF`，免得沿用原關的值造成誤讀。
 *
 * ⚠ 推論（反直覺，但是刻意的）：無盡的難度只由 `hpMul`／`lives`／字池區分，
 *   **與原關的 `maxWave` 與 `arc` 都無關**。黃巾的無盡版因此是最長的一條路——
 *   它的原關只走 20 個參考波，攤平成完整的 40 波參考弧自然變長。
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
  return {
    ...base,
    key: endlessKeyOf(base.key),
    name: `${base.name}・無盡`,
    maxWave: Infinity,
    // = sim/waves.ts 的 WAVE_REF。刻意寫成字面值：data 層只從 sim 取型別，不取值
    arc: 40,
    endless: true,
  }
}

/** 無盡關卡的顯示順序，與 `LEVEL_ORDER` 一一對應 */
export const ENDLESS_ORDER = LEVEL_ORDER.map(endlessKeyOf)

// 註冊進 LEVELS：createGame 與續玩還原都只認得 LEVELS，沒註冊就開不起來
for (const key of LEVEL_ORDER) LEVELS[endlessKeyOf(key)] = endlessOf(LEVELS[key])
