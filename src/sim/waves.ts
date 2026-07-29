/**
 * 波次生成器。純函式：同樣的 (wave, seed, bias) 產出同樣的敵人序列。
 *
 * ★ 關卡偏好（bias）：關卡宣告偏好哪些 EnemyTrait，這裡就把帶那些特徵的敵人
 *   加權放大。於是「這一關特別需要範圍攻擊」是資料驅動的結果，
 *   而不是各關手寫一份敵種清單。推薦標籤同樣由 bias 推導（見 data/enemies.ts 的 countersFor）。
 */
import { BOSSES, ENEMY_BY_KEY, REGULARS } from '../data/enemies'
import { pickWeighted } from '../core/rng'
import type { EnemyDef, EnemyTrait, SpawnEntry } from './types'

export const BASE_HP = 20
/**
 * 每波血量成長率。這是全專案最敏感的難度旋鈕。
 * 1.18 → 1.19（M3 技能與光環）→ 1.21（M4b 武將可持續疊字，玩家後期戰力變成指數成長）
 * → 1.25（射程全域 ×2 後塔覆蓋更長路徑、難度下滑，用血量成長拉回 12～20 區間）
 * → 1.23（敵種擴充後多了回血／分裂／免疫等機制，實質難度上升，往回讓一點）
 */
export const HP_GROWTH = 1.23
export const PREP_SECONDS = 12

/** 帶 bias 特徵的敵人，出現權重乘上這個倍率 */
export const BIAS_WEIGHT = 4

export function enemyBaseHp(wave: number): number {
  return BASE_HP * Math.pow(HP_GROWTH, wave)
}

export function enemyCount(wave: number): number {
  return 6 + Math.floor(wave * 1.4)
}

export function isBossWave(wave: number): boolean {
  return wave % 5 === 0
}

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

export function buildWave(
  wave: number,
  rng: () => number,
  hpMul = 1,
  bias: readonly EnemyTrait[] = [],
): SpawnEntry[] {
  const out: SpawnEntry[] = []
  const base = enemyBaseHp(wave) * hpMul
  const pool = composition(wave)
  const n = enemyCount(wave)
  const gap = 0.75

  for (let i = 0; i < n; i++) {
    const def = pickWeighted(rng, pool, (d) => weightOf(d, bias))
    out.push({ at: i * gap, defKey: def.key, hp: Math.round(base * def.hpMul) })
  }

  if (isBossWave(wave)) {
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
