/**
 * 羈絆計算與組合技推進。
 * computeBonds 由 recalcUnits() 呼叫（單位變動時），不在每 tick 跑。
 * stepBondSkills 才是每 tick 跑的部分。
 */
import { BONDS } from '../data/bonds'
import { COMBOS, bondMembers } from './skills'
import type { ActiveBond, GameState, Unit } from './types'

export interface BondResult {
  atkMul: number
  apsMul: number
  cdMul: number
  active: ActiveBond[]
}

/**
 * @param perksCdMul 局外道具（兵法傳承）的冷卻倍率。必須傳進來才能讓 active[].combo.cdMax
 *   跟 stepBondSkills 實際用的 state.cdMul 一致——否則面板顯示的冷卻會比真實值長。
 */
export function computeBonds(
  units: Unit[],
  bondCds: Record<string, number> = {},
  perksCdMul = 1,
): BondResult {
  const generals = units.filter((u) => u.kind === 'general')
  const names = new Set(generals.map((u) => u.defKey))
  const tagCount = new Map<string, number>()
  for (const u of generals) {
    for (const t of u.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1)
  }

  let atkMul = 1
  let apsMul = 1
  let cdMul = 1
  const matched: typeof BONDS = []

  for (const b of BONDS) {
    if (b.requireGenerals && !b.requireGenerals.every((n) => names.has(n))) continue
    if (b.requireTag && (tagCount.get(b.requireTag.tag) ?? 0) < b.requireTag.count) continue
    atkMul *= b.atkMul ?? 1
    apsMul *= b.apsMul ?? 1
    cdMul *= b.cdMul ?? 1
    matched.push(b)
  }

  // cdMul 要先全部乘完，組合技的 cdMax 才算得對；
  // 並且要跟 stepBondSkills 用的 state.cdMul 同基準（羈絆 × 局外道具），面板才不會顯示錯的冷卻
  const effectiveCdMul = cdMul * perksCdMul
  const active: ActiveBond[] = matched.map((b) => ({
    name: b.name,
    desc: b.desc,
    combo: b.comboSkill
      ? {
          name: b.comboSkill.name,
          cd: Math.max(0, bondCds[b.name] ?? 0),
          cdMax: b.comboSkill.cd * effectiveCdMul,
        }
      : undefined,
  }))

  return { atkMul, apsMul, cdMul, active }
}

/**
 * 組合技冷卻與施放。羈絆消失時清掉冷卻，重新湊齊要重新等。
 */
export function stepBondSkills(state: GameState, dt: number): void {
  for (const b of BONDS) {
    if (!b.comboSkill) continue
    const isActive = state.activeBonds.some((a) => a.name === b.name)
    if (!isActive) {
      delete state.bondCds[b.name]
      continue
    }
    const cdMax = b.comboSkill.cd * state.cdMul
    if (state.bondCds[b.name] === undefined) {
      // 剛湊齊時給一段短冷卻，讓玩家馬上看到組合技
      state.bondCds[b.name] = Math.min(4, cdMax)
    }
    state.bondCds[b.name] -= dt
    if (state.bondCds[b.name] > 0) continue

    const fn = COMBOS[b.name]
    if (!fn) {
      state.bondCds[b.name] = cdMax
      continue
    }
    const members = bondMembers(state, b.name, b.requireGenerals, b.requireTag?.tag)
    if (members.length && fn(state, members)) state.bondCds[b.name] = cdMax
  }
}
