/**
 * 商城：局外用「聲望」購買的道具，效果都是整局有效的**被動**。
 * 與兵書（純數值養成）互補——這裡的道具會改變玩法（徵兵升階、天降火球…）。
 *
 * 一次性購買（買過就永久擁有），存在 MetaProgress.items。
 * 效果不直接寫進 meta，而是由 perksFrom() 推導成 Perks，createGame 時注入 GameState，
 * 讓 sim 只認識中性的 Perks、不需要知道商城的存在——npm run sim 的預設 meta（無道具）
 * 因此得到全中性 Perks，難度基準不受影響。
 *
 * 平衡基準：打完一關約 25～45 聲望，全部道具總價約 1070，約 15～25 局內能陸續集滿。
 */
import type { Perks } from '../sim/types'
import type { MetaProgress } from '../sim/state'
import { type BuyResult } from './upgrades'

export interface ShopItem {
  key: string
  name: string
  desc: string
  /** 一次性價格（聲望） */
  cost: number
}

export const SHOP: ShopItem[] = [
  { key: 'elite', name: '精兵符', desc: '徵兵時每個字有 25% 機率直接抽到二階（已升級的單位）。', cost: 150 },
  {
    key: 'meteor',
    name: '流星火雨',
    desc: '戰鬥中每 10 秒對最前方一群敵人降下火球，造成範圍傷害並灼燒（威力隨波次成長）。',
    cost: 240,
  },
  { key: 'supply', name: '糧道暢通', desc: '每波固定收入 +30%。', cost: 130 },
  { key: 'medic', name: '杏林春暖', desc: '每通過 5 波恢復 1 點生命（不超過上限）。', cost: 180 },
  { key: 'banner', name: '號令旗', desc: '全場友軍攻擊力 +12%。', cost: 200 },
  { key: 'gale', name: '疾風令', desc: '全場友軍攻速 +12%。', cost: 170 },
]

export const SHOP_BY_KEY: Record<string, ShopItem> = Object.fromEntries(SHOP.map((s) => [s.key, s]))

/** 由「已購道具」推導出整局的被動效果；未購買一律中性值 */
export function perksFrom(items: readonly string[] = []): Perks {
  const has = (k: string): boolean => items.includes(k)
  return {
    recruitEliteChance: has('elite') ? 0.25 : 0,
    meteorInterval: has('meteor') ? 10 : 0,
    incomeMul: has('supply') ? 1.3 : 1,
    healEveryWaves: has('medic') ? 5 : 0,
    atkMul: has('banner') ? 1.12 : 1,
    apsMul: has('gale') ? 1.12 : 1,
  }
}

export function buyItem(meta: MetaProgress, key: string): BuyResult {
  const def = SHOP_BY_KEY[key]
  if (!def) return { ok: false, msg: '沒有這個道具' }
  if (meta.items.includes(key)) return { ok: false, msg: `已擁有「${def.name}」` }
  if (meta.renown < def.cost) return { ok: false, msg: `聲望不足（需要 ${def.cost}）` }
  meta.renown -= def.cost
  meta.items.push(key)
  return { ok: true, msg: `購得「${def.name}」，下一局起生效` }
}
