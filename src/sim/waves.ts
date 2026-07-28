/**
 * 波次生成器。純函式：同樣的 (wave, seed) 產出同樣的敵人序列。
 */
import { ENEMY_BY_KEY } from '../data/enemies'
import type { SpawnEntry } from './types'

export const BASE_HP = 20
/**
 * 每波血量成長率。這是全專案最敏感的難度旋鈕。
 * 1.18 → 1.19（M3 技能與光環）→ 1.21（M4b 武將可持續疊字，玩家後期戰力變成指數成長）
 */
export const HP_GROWTH = 1.21
export const PREP_SECONDS = 12

export function enemyBaseHp(wave: number): number {
  return BASE_HP * Math.pow(HP_GROWTH, wave)
}

export function enemyCount(wave: number): number {
  return 6 + Math.floor(wave * 1.4)
}

export function isBossWave(wave: number): boolean {
  return wave % 5 === 0
}

/** 依波次決定敵種配比 */
function composition(wave: number): string[] {
  const pool: string[] = ['thief']
  if (wave >= 3) pool.push('swift')
  if (wave >= 4) pool.push('shield')
  if (wave >= 7) pool.push('flyer')
  return pool
}

export function buildWave(wave: number, rng: () => number, hpMul = 1): SpawnEntry[] {
  const out: SpawnEntry[] = []
  const base = enemyBaseHp(wave) * hpMul
  const pool = composition(wave)
  const n = enemyCount(wave)
  const gap = 0.75

  for (let i = 0; i < n; i++) {
    const key = pool[Math.floor(rng() * pool.length)]
    const def = ENEMY_BY_KEY[key]
    out.push({ at: i * gap, defKey: key, hp: Math.round(base * def.hpMul) })
  }

  if (isBossWave(wave)) {
    const boss = ENEMY_BY_KEY['boss']
    out.push({ at: n * gap + 2, defKey: 'boss', hp: Math.round(base * boss.hpMul) })
  }

  return out
}
