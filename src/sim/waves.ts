/**
 * 波次生成器。純函式：同樣的 (wave, seed, bias) 產出同樣的敵人序列。
 *
 * ★ 關卡偏好（bias）：關卡宣告偏好哪些 EnemyTrait，這裡就把帶那些特徵的敵人
 *   加權放大。於是「這一關特別需要範圍攻擊」是資料驅動的結果，
 *   而不是各關手寫一份敵種清單。推薦標籤同樣由 bias 推導（見 data/enemies.ts 的 countersFor）。
 */
import { BOSSES, ENEMY_BY_KEY, REGULARS } from '../data/enemies'
import { pickWeighted } from '../core/rng'
import type { EnemyDef, EnemyTrait, LevelMods, SpawnEntry } from './types'

/**
 * 第 0 波的基準血量。**線性項**：它整條曲線等比例上下移，所以是用來抵銷
 * 「玩家整體戰力變了」的對應旋鈕（`HP_GROWTH` 管的是成長率，不是水位）。
 * 20 → 32：非姓名配方從 17 種擴到 42 種之後，兵器×兵器、兵種×兵種都能組將，
 * 傻 AI 在每一波的戰力約 +78%，用血量水位等比例補回來。
 */
export const BASE_HP = 32
/**
 * 每波血量成長率。這是全專案最敏感的難度旋鈕。
 * 1.18 → 1.19（M3 技能與光環）→ 1.21（M4b 武將可持續疊字，玩家後期戰力變成指數成長）
 * → 1.25（射程全域 ×2 後塔覆蓋更長路徑、難度下滑，用血量成長拉回 12～20 區間）
 * → 1.23（敵種擴充後多了回血／分裂／免疫等機制，實質難度上升，往回讓一點）
 *
 * ★ **這個數字必須貼著「玩家戰力的成長率」，不能單獨調。**
 * 實測（`npm run econ`）玩家 dps 的成長率：前期約 ×1.27／波，後期降到 ×1.12／波。
 * HP_GROWTH 落在這兩者之間，才會出現「前期追得上、後期逐漸被甩開」的收束感。
 * 曾經試著降到 1.10 想讓 `hpMul` 更能區分關卡，結果是**前期反而變成不可能**
 * （血量只成長 1.1／波、玩家戰力成長 1.27／波 → 第 1 波的相對難度遠高於第 12 波），
 * 後期則變成毫無威脅（傻 AI 撐到第 34～40 波）。不要再往那個方向調。
 */
export const HP_GROWTH = 1.23
export const PREP_SECONDS = 12

/** 帶 bias 特徵的敵人，出現權重乘上這個倍率 */
export const BIAS_WEIGHT = 4

/**
 * ★ 難度弧的參考長度，也是「無盡模式」與省略 `arc` 時的預設弧長。
 *
 * 血量的指數吃的是**相對進度**而不是絕對波次：
 *
 *     exponent = wave × arc / maxWave
 *
 * 也就是「這一關要在 maxWave 波之內走完 arc 個參考波」。arc = WAVE_REF = 40
 * 的關卡等於走完整條參考弧；arc 越小，同樣的波數只走過弧的一小段 → 這一關越簡單。
 *
 * ⚠ 歷史（別再走回去）：`arc` 曾經**不存在**，公式固定用 `WAVE_REF / maxWave`，
 * 於是「關卡長度」與「難度」是同一個數字——每一關都剛好走完整條弧，
 * 傻 AI 在每一關都死在正中間，九關的難度**完全一樣平**（實測比例 0.47～0.54）。
 * 更糟的是短關卡被壓得極陡：12 波的黃巾等於每波血量 ×1.99，教學關反而是全遊戲最陡的一段。
 * 現在兩件事分開了：`maxWave` 只管長度，`arc` 只管難度，難度曲線寫在關卡表裡（見 data/levels）。
 *
 * ⚠ 為什麼不能改用 `hpMul` 達成同一件事：陣亡波次是「血量曲線」與「玩家戰力曲線」
 * 的交點，而兩者幾乎平行（見 HP_GROWTH 的註解），所以整個 hpMul 區間只值約 2 波。
 * `hpMul` 的定位是單純的「這一關的敵人硬一點／軟一點」微調，難度弧才是主旋鈕。
 */
export const WAVE_REF = 40

/**
 * 該波的基準血量。`maxWave` 與 `arc` 都預設為 `WAVE_REF`，所以 `enemyBaseHp(w)`
 * 等同於舊版的 `BASE_HP × HP_GROWTH^w`——測試與「參考長度關卡」都不受影響。
 *
 * ⚠ 無盡模式的 `maxWave` 是 `Infinity`，相對進度會恆等於 0（血量永不成長，
 * 敵人永遠是第 0 波的強度）。因此非有限的 `maxWave` 一律退回「absolute 波次」那條
 * 原始曲線（弧長與關長都取 `WAVE_REF`），也是本專案調得最久的那一條。
 */
export function enemyBaseHp(wave: number, maxWave: number = WAVE_REF, arc: number = WAVE_REF): number {
  if (!Number.isFinite(maxWave)) return BASE_HP * Math.pow(HP_GROWTH, wave)
  return BASE_HP * Math.pow(HP_GROWTH, (wave * arc) / maxWave)
}

/**
 * 單波敵人數量的上限。有限關卡最多 40 波（62 隻），**永遠碰不到這個上限**，
 * 它只為無盡模式存在：`6 + 1.4w` 在第 100 波是 146 隻，
 * 以 0.75 秒的出怪間隔算就是連續 110 秒的出怪，體感與效能都會塌掉。
 * 到頂之後成長全部交給血量的指數項——那是原本就在成長的部分。
 */
export const MAX_WAVE_ENEMIES = 90

export function enemyCount(wave: number): number {
  return Math.min(6 + Math.floor(wave * 1.4), MAX_WAVE_ENEMIES)
}

/** 預設每 5 波一隻 BOSS；關卡可用戰場特性的 `bossEvery` 改（見 types.ts 的 LevelMods） */
export const BOSS_EVERY = 5

export function isBossWave(wave: number, every: number = BOSS_EVERY): boolean {
  return wave % every === 0
}

/** 預設出怪間隔（秒）。關卡可用戰場特性的 `spawnGap` 改 */
export const SPAWN_GAP = 0.75

/** 該波次可以出現的敵種（依 minWave 開放） */
function eligible(pool: EnemyDef[], wave: number): EnemyDef[] {
  const out = pool.filter((d) => wave >= (d.minWave ?? 0))
  // 極早期可能全部被 minWave 擋掉 → 至少回傳最基本的那一隻，避免空池
  return out.length ? out : [pool[0]]
}

function weightOf(def: EnemyDef, bias: readonly EnemyTrait[]): number {
  return def.traits.some((t) => bias.includes(t)) ? BIAS_WEIGHT : 1
}

/**
 * 這一波可以出現的一般兵。加權（bias）不在這裡套用，
 * 而是在每次抽取時由 weightOf 決定——這樣同一個池可以重複抽 n 次。
 */
export function composition(wave: number): EnemyDef[] {
  return eligible(REGULARS, wave)
}

/** BOSS 波要出場的那一隻。合格者中依關卡偏好加權隨機挑選 */
export function pickBoss(wave: number, rng: () => number, bias: readonly EnemyTrait[] = []): EnemyDef {
  const pool = eligible(BOSSES, wave)
  return pickWeighted(rng, pool, (d) => weightOf(d, bias))
}

/**
 * ★ 單一敵種在一波裡的數量上限（`EnemyDef.maxShare`）。
 *
 * 只為一件事存在：**同一波出太多治療系會直接卡波**。關卡的 bias 加權是 ×4，
 * 而妖道又帶 `healer`，所以「偏好治療」的關卡很容易一次倒出一大串妖道，
 * 疊在一起就是玩家打不動的鐵板。真正的根治在 sim/step.ts（互不治療 + 回血上限），
 * 這裡是第二道防線：讓「一波裡有幾隻妖道」本身就有天花板。
 *
 * ⚠ 到頂的敵種是**整個被排除在抽取之外**，不是抽到再重抽——重抽會多消耗 rng，
 *   讓同一顆種子產出不同的一局（`buildWave` 的決定性是本專案的基本假設）。
 */
function shareCap(def: EnemyDef, n: number): number {
  return def.maxShare === undefined ? Infinity : Math.max(1, Math.floor(n * def.maxShare))
}

export function buildWave(
  wave: number,
  rng: () => number,
  hpMul = 1,
  bias: readonly EnemyTrait[] = [],
  maxWave: number = WAVE_REF,
  arc: number = WAVE_REF,
  mods: LevelMods = {},
): SpawnEntry[] {
  const out: SpawnEntry[] = []
  const base = enemyBaseHp(wave, maxWave, arc) * hpMul
  let pool = composition(wave)
  const n = enemyCount(wave)
  const gap = mods.spawnGap ?? SPAWN_GAP
  const used: Record<string, number> = {}

  for (let i = 0; i < n; i++) {
    const def = pickWeighted(rng, pool, (d) => weightOf(d, bias))
    out.push({ at: i * gap, defKey: def.key, hp: Math.round(base * def.hpMul) })
    used[def.key] = (used[def.key] ?? 0) + 1
    // 到頂就退出候選池。留最後一個敵種當保險，池子不可能被清空
    if (used[def.key] >= shareCap(def, n) && pool.length > 1) {
      pool = pool.filter((d) => d !== def)
    }
  }

  if (isBossWave(wave, mods.bossEvery ?? BOSS_EVERY)) {
    const boss = pickBoss(wave, rng, bias)
    const at = n * gap + 2
    out.push({ at, defKey: boss.key, hp: Math.round(base * boss.hpMul) })
    // 護衛跟 BOSS 幾乎同時出場，稍微錯開讓畫面讀得出來
    if (boss.escort) {
      const esc = ENEMY_BY_KEY[boss.escort.key]
      if (esc) {
        for (let i = 0; i < boss.escort.count; i++) {
          out.push({ at: at + 0.15 * i, defKey: esc.key, hp: Math.round(base * esc.hpMul) })
        }
      }
    }
  }

  return out
}
