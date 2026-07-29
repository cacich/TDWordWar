/**
 * 兵書：局外永久養成。花「聲望」購買，效果直接寫進 MetaProgress。
 *
 * 平衡基準：打完一關普通局大約 25～45 聲望，所以第一個升級大概 2 局內買得到；
 * 四項全買滿共 1230 聲望（≈28～50 局）。
 * ⚠ 聲望與商城共用（見 data/shop.ts，買滿另需 13590），所以實際會拉得更長——
 * 兵書是「先買哪一項」的短期決策，商城才是長期投資標的。
 */
import { MAX_HAND_SIZE, MAX_WISH_SLOTS, type MetaProgress } from '../sim/state'

export interface UpgradeDef {
  key: string
  name: string
  desc: string
  /** 目前等級（0 = 還沒買） */
  level: (m: MetaProgress) => number
  max: number
  /** 第 n 級（0-based）的價格 */
  cost: (level: number) => number
  apply: (m: MetaProgress) => void
}

export const UPGRADES: UpgradeDef[] = [
  {
    key: 'hand',
    name: '軍帳擴編',
    desc: '手牌 +1 格（起始 5，上限 8）',
    level: (m) => m.handSize - 5,
    max: MAX_HAND_SIZE - 5,
    cost: (lv) => 60 + lv * 60,
    apply: (m) => {
      m.handSize = Math.min(MAX_HAND_SIZE, m.handSize + 1)
    },
  },
  {
    key: 'wish',
    name: '求賢令',
    desc: '心願格 +1（起始 1，上限 3）',
    level: (m) => m.wishSlots - 1,
    max: MAX_WISH_SLOTS - 1,
    cost: (lv) => 80 + lv * 80,
    apply: (m) => {
      m.wishSlots = Math.min(MAX_WISH_SLOTS, m.wishSlots + 1)
    },
  },
  {
    key: 'food',
    name: '屯糧有備',
    desc: '每局起始糧 +6',
    level: (m) => Math.round(m.extraFood / 6),
    max: 4,
    cost: (lv) => 30 + lv * 25,
    apply: (m) => {
      m.extraFood += 6
    },
  },
  {
    key: 'lives',
    name: '深溝高壘',
    desc: '每局起始生命 +1',
    level: (m) => m.extraLives,
    max: 2,
    cost: (lv) => 120 + lv * 120,
    apply: (m) => {
      m.extraLives += 1
    },
  },
]

export interface BuyResult {
  ok: boolean
  msg: string
}

export function buyUpgrade(meta: MetaProgress, key: string): BuyResult {
  const def = UPGRADES.find((u) => u.key === key)
  if (!def) return { ok: false, msg: '沒有這個升級' }
  const lv = def.level(meta)
  if (lv >= def.max) return { ok: false, msg: `${def.name} 已達上限` }
  const cost = def.cost(lv)
  if (meta.renown < cost) return { ok: false, msg: `聲望不足（需要 ${cost}）` }
  meta.renown -= cost
  def.apply(meta)
  return { ok: true, msg: `${def.name} 提升至 ${lv + 1} 級` }
}
