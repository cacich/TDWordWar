/**
 * 商城：局外用「聲望」購買的道具，效果都是整局有效的**被動**，且每種都可分階升級。
 * 與兵書（純數值養成）互補——這裡的道具會改變玩法（爆擊、天降火球、漏怪防護…）。
 *
 * 每種道具最高 MAX_ITEM_LEVEL 級，買一級生效一級（不必買滿才有效果），
 * 存在 MetaProgress.items（key → 目前等級，0 或不存在＝未購買）。
 * 效果不直接寫進 meta，而是由 perksFrom() 依等級推導成 Perks，createGame 時注入 GameState，
 * 讓 sim 只認識中性的 Perks、不需要知道商城的存在——npm run sim 的預設 meta（無道具）
 * 因此得到全中性 Perks，難度基準不受影響。
 *
 * 平衡基準：打完一關約 25～45 聲望。每種道具買到 1 級成本 130～240，
 * 全部 16 種道具買滿 3 級總價約 9000 聲望，是長期養成目標，不是短期就能集滿。
 */
import type { Perks } from '../sim/types'
import type { MetaProgress } from '../sim/state'
import { type BuyResult } from './upgrades'

export const MAX_ITEM_LEVEL = 3

export interface ShopItem {
  key: string
  name: string
  /** 不隨等級變化的一句話總述，列在道具名稱下方 */
  desc: string
  max: number
  /** 買到第 level+1 級（0-based，level 為目前等級）所需聲望 */
  cost: (level: number) => number
  /** 第 level 級（1-based）的效果描述，逐級列在商城 UI */
  detail: (level: number) => string
  /** 把「目前等級」寫進 Perks；level 一定 >= 1 才會被呼叫 */
  apply: (level: number, p: Perks) => void
}

const pct = (x: number): string => `${Math.round(x * 100)}%`

/** 標準價格曲線：第一級 base，之後每級 ×1.55 左右成長（跟兵書的 cost(level) 手感一致） */
function stdCost(base: number): (level: number) => number {
  return (level) => base + level * Math.round(base * 0.55)
}

export const SHOP: ShopItem[] = [
  {
    key: 'elite',
    name: '精兵符',
    desc: '徵兵時每個字有機率直接抽到二階（已升級的單位）。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(150),
    detail: (lv) => `Lv.${lv}：機率 ${pct([0.15, 0.25, 0.35][lv - 1])}`,
    apply: (lv, p) => {
      p.recruitEliteChance = [0.15, 0.25, 0.35][lv - 1]
    },
  },
  {
    key: 'meteor',
    name: '流星火雨',
    desc: '戰鬥中每隔一段時間對最前方一群敵人降下火球，造成範圍傷害並灼燒（威力隨波次成長）。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(240),
    detail: (lv) => `Lv.${lv}：每 ${[14, 10, 7][lv - 1]} 秒一次`,
    apply: (lv, p) => {
      p.meteorInterval = [14, 10, 7][lv - 1]
    },
  },
  {
    key: 'supply',
    name: '糧道暢通',
    desc: '每波固定收入提高。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(130),
    detail: (lv) => `Lv.${lv}：收入 +${pct([0.15, 0.3, 0.45][lv - 1])}`,
    apply: (lv, p) => {
      p.incomeMul = 1 + [0.15, 0.3, 0.45][lv - 1]
    },
  },
  {
    key: 'medic',
    name: '杏林春暖',
    desc: '每通過幾波就恢復 1 點生命（不超過上限），間隔隨等級縮短。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(180),
    detail: (lv) => `Lv.${lv}：每 ${[6, 5, 3][lv - 1]} 波回 1 命`,
    apply: (lv, p) => {
      p.healEveryWaves = [6, 5, 3][lv - 1]
    },
  },
  {
    key: 'banner',
    name: '號令旗',
    desc: '全場友軍攻擊力提高。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(200),
    detail: (lv) => `Lv.${lv}：攻擊 +${pct([0.08, 0.14, 0.2][lv - 1])}`,
    apply: (lv, p) => {
      p.atkMul = 1 + [0.08, 0.14, 0.2][lv - 1]
    },
  },
  {
    key: 'gale',
    name: '疾風令',
    desc: '全場友軍攻速提高。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(170),
    detail: (lv) => `Lv.${lv}：攻速 +${pct([0.08, 0.14, 0.2][lv - 1])}`,
    apply: (lv, p) => {
      p.apsMul = 1 + [0.08, 0.14, 0.2][lv - 1]
    },
  },
  {
    key: 'crit',
    name: '奇兵秘計',
    desc: '每次攻擊有機率爆擊，造成 1.8 倍傷害。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(220),
    detail: (lv) => `Lv.${lv}：爆擊機率 ${pct([0.12, 0.2, 0.28][lv - 1])}`,
    apply: (lv, p) => {
      p.critChance = [0.12, 0.2, 0.28][lv - 1]
      p.critMul = 1.8
    },
  },
  {
    key: 'fortify',
    name: '鐵壁工事',
    desc: '起始與上限生命增加。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(200),
    detail: (lv) => `Lv.${lv}：生命 +${[1, 2, 3][lv - 1]}`,
    apply: (lv, p) => {
      p.extraLives = [1, 2, 3][lv - 1]
    },
  },
  {
    key: 'thrift',
    name: '輕裝簡從',
    desc: '征兵與熔爐重抽的花費降低。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(160),
    detail: (lv) => `Lv.${lv}：花費 -${pct([0.08, 0.15, 0.22][lv - 1])}`,
    apply: (lv, p) => {
      p.costMul = 1 - [0.08, 0.15, 0.22][lv - 1]
    },
  },
  {
    key: 'familiar',
    name: '廣結善緣',
    desc: '手牌與場上已有的字，抽到的權重額外提高（疊在熟悉度加權上）。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(150),
    detail: (lv) => `Lv.${lv}：熟悉度加權 ×${[1.3, 1.6, 2.0][lv - 1]}`,
    apply: (lv, p) => {
      p.familiarBoostMul = [1.3, 1.6, 2.0][lv - 1]
    },
  },
  {
    key: 'leakshield',
    name: '回魂旗',
    desc: '敵人漏過大營時，有機率不扣血命。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(190),
    detail: (lv) => `Lv.${lv}：機率 ${pct([0.15, 0.28, 0.4][lv - 1])}`,
    apply: (lv, p) => {
      p.leakBlockChance = [0.15, 0.28, 0.4][lv - 1]
    },
  },
  {
    key: 'splash',
    name: '烽火連城',
    desc: '範圍與貫穿型攻擊（車兵、火計等）額外提高傷害。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(210),
    detail: (lv) => `Lv.${lv}：範圍／貫穿傷害 +${pct([0.1, 0.2, 0.3][lv - 1])}`,
    apply: (lv, p) => {
      p.splashMul = 1 + [0.1, 0.2, 0.3][lv - 1]
    },
  },
  {
    key: 'bounty',
    name: '狩獵好手',
    desc: '擊殺敵人獲得的糧食增加。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(150),
    detail: (lv) => `Lv.${lv}：擊殺收入 +${pct([0.15, 0.3, 0.45][lv - 1])}`,
    apply: (lv, p) => {
      p.bountyMul = 1 + [0.15, 0.3, 0.45][lv - 1]
    },
  },
  {
    key: 'enemyslow',
    name: '沼澤泥沼',
    desc: '全場敵人移動速度降低。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(180),
    detail: (lv) => `Lv.${lv}：敵速 -${pct([0.06, 0.12, 0.18][lv - 1])}`,
    apply: (lv, p) => {
      p.enemySpeedMul = 1 - [0.06, 0.12, 0.18][lv - 1]
    },
  },
  {
    key: 'range',
    name: '精工兵器',
    desc: '全場友軍射程再提高一截。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(190),
    detail: (lv) => `Lv.${lv}：射程 +${pct([0.05, 0.1, 0.15][lv - 1])}`,
    apply: (lv, p) => {
      p.rangeMul = 1 + [0.05, 0.1, 0.15][lv - 1]
    },
  },
  {
    key: 'bondcd',
    name: '兵法傳承',
    desc: '武將主動技與羈絆組合技的冷卻縮短。',
    max: MAX_ITEM_LEVEL,
    cost: stdCost(200),
    detail: (lv) => `Lv.${lv}：冷卻 -${pct([0.05, 0.1, 0.15][lv - 1])}`,
    apply: (lv, p) => {
      p.cdMul = 1 - [0.05, 0.1, 0.15][lv - 1]
    },
  },
]

export const SHOP_BY_KEY: Record<string, ShopItem> = Object.fromEntries(SHOP.map((s) => [s.key, s]))

const NEUTRAL_PERKS: Perks = {
  recruitEliteChance: 0,
  meteorInterval: 0,
  incomeMul: 1,
  healEveryWaves: 0,
  atkMul: 1,
  apsMul: 1,
  critChance: 0,
  critMul: 1,
  extraLives: 0,
  costMul: 1,
  familiarBoostMul: 1,
  leakBlockChance: 0,
  splashMul: 1,
  bountyMul: 1,
  enemySpeedMul: 1,
  rangeMul: 1,
  cdMul: 1,
}

/** 由「已購道具＋等級」推導出整局的被動效果；未購買（等級 0）一律中性值 */
export function perksFrom(items: Readonly<Record<string, number>> = {}): Perks {
  const p: Perks = { ...NEUTRAL_PERKS }
  for (const item of SHOP) {
    const lv = items[item.key] ?? 0
    if (lv > 0) item.apply(Math.min(lv, item.max), p)
  }
  return p
}

/** 目前等級（未購買為 0） */
export function itemLevel(meta: MetaProgress, key: string): number {
  return meta.items[key] ?? 0
}

export function buyItem(meta: MetaProgress, key: string): BuyResult {
  const def = SHOP_BY_KEY[key]
  if (!def) return { ok: false, msg: '沒有這個道具' }
  const lv = itemLevel(meta, key)
  if (lv >= def.max) return { ok: false, msg: `${def.name} 已達最高等級` }
  const cost = def.cost(lv)
  if (meta.renown < cost) return { ok: false, msg: `聲望不足（需要 ${cost}）` }
  meta.renown -= cost
  meta.items[key] = lv + 1
  return { ok: true, msg: `${def.name} 提升至 Lv.${lv + 1}` }
}
