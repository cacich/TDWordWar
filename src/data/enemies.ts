/**
 * 敵表。HP = BASE_HP × HP_GROWTH^wave × hpMul（目前 HP_GROWTH = 1.25，見 sim/waves.ts）
 * troop 用於三向相剋：騎 → 弓 → 步 → 騎（克制 +25%，被克 −25%）
 */
import type { EnemyDef } from '../sim/types'

export const ENEMIES: EnemyDef[] = [
  { key: 'thief', char: '賊', hpMul: 1, def: 0, speed: 0.95, flying: false, bounty: 2, damage: 1, troop: '步', desc: '尋常賊寇（步）。' },
  { key: 'shield', char: '盾', hpMul: 1.9, def: 45, speed: 0.7, flying: false, bounty: 4, damage: 1, troop: '步', desc: '盾賊（步）：防禦極高，怕穿透與灼燒。' },
  { key: 'swift', char: '快', hpMul: 0.55, def: 0, speed: 2.1, flying: false, bounty: 2, damage: 1, troop: '騎', desc: '快賊（騎）：移速極快，血薄，怕步兵。' },
  { key: 'flyer', char: '飛', hpMul: 0.9, def: 10, speed: 1.35, flying: true, bounty: 4, damage: 1, troop: '弓', desc: '飛賊（弓）：只有射程 ≥2 的單位打得到，怕騎兵。' },
  { key: 'boss', char: '將', hpMul: 14, def: 60, speed: 0.6, flying: false, bounty: 20, damage: 2, troop: '騎', desc: '賊將（騎）：每 5 波出現的首領，免疫定身與擊退。', ccImmune: true },
]

export const ENEMY_BY_KEY: Record<string, EnemyDef> = Object.fromEntries(
  ENEMIES.map((e) => [e.key, e]),
)

/** 射程未達此值視為近戰，無法攻擊飛行單位 */
export const ANTI_AIR_RANGE = 2.0
