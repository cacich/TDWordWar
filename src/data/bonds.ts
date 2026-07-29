/**
 * 羈絆表。因設計決定 #3（武將不再融合），羈絆是後期構築的主要深度來源。
 * comboSkill 的實作註冊在 sim/skills.ts 的 COMBOS[羈絆名]；沒有註冊就只有數值加成。
 */
import type { BondDef } from '../sim/types'

export const BONDS: BondDef[] = [
  {
    name: '桃園結義',
    desc: '劉備、關羽、張飛同時在場：全體攻擊 +30%',
    requireGenerals: ['劉備', '關羽', '張飛'],
    atkMul: 1.3,
    comboSkill: { name: '三英戰呂布', cd: 40, desc: '三人合擊最強敵人，並將其定身。' },
  },
  {
    name: '五虎上將',
    desc: '關羽、張飛、趙雲、馬超、黃忠同時在場：全體攻擊 +50%、攻速 +20%',
    requireGenerals: ['關羽', '張飛', '趙雲', '馬超', '黃忠'],
    atkMul: 1.5,
    apsMul: 1.2,
    comboSkill: { name: '五虎齊出', cd: 45, desc: '五道衝鋒清掃全路徑上的所有敵人。' },
  },
  {
    name: '西涼鐵騎',
    desc: '場上 2 名以上「馬」姓武將：攻速 +40%',
    requireTag: { tag: '馬', count: 2 },
    apsMul: 1.4,
    comboSkill: { name: '鐵騎踏陣', cd: 35, desc: '全路徑突擊並擊退所有敵人。' },
  },
  {
    name: '江東基業',
    desc: '孫權、周瑜、黃蓋同時在場：攻速 +25%',
    requireGenerals: ['孫權', '周瑜', '黃蓋'],
    apsMul: 1.25,
    comboSkill: { name: '火燒赤壁', cd: 40, desc: '全場敵人陷入重度灼燒。' },
  },
  {
    name: '臥龍鳳雛',
    desc: '諸葛亮、龐統同時在場：所有主動技冷卻 −30%',
    requireGenerals: ['諸葛亮', '龐統'],
    cdMul: 0.7,
  },
  {
    name: '魏武雄兵',
    desc: '曹操、張遼同時在場：全體攻擊 +25%',
    requireGenerals: ['曹操', '張遼'],
    atkMul: 1.25,
  },
  {
    name: '虎狼之師',
    desc: '場上 4 支以上「部隊」：全體攻擊 +15%',
    requireTag: { tag: '部隊', count: 4 },
    atkMul: 1.15,
  },
  {
    name: '奇門遁甲',
    desc: '場上 3 名以上「謀略」武將：全體攻擊 +20%、技能冷卻 −15%',
    requireTag: { tag: '謀略', count: 3 },
    atkMul: 1.2,
    cdMul: 0.85,
  },
  {
    name: '江東猛虎',
    desc: '場上 4 名以上「吳」武將：全體攻擊 +20%',
    requireTag: { tag: '吳', count: 4 },
    atkMul: 1.2,
  },
  {
    name: '魏武謀主',
    desc: '曹操、郭嘉、荀彧同時在場：所有主動技冷卻 −25%',
    requireGenerals: ['曹操', '郭嘉', '荀彧'],
    cdMul: 0.75,
  },
  {
    name: '呂布陳宮',
    desc: '呂布、陳宮同時在場：全體攻擊 +20%',
    requireGenerals: ['呂布', '陳宮'],
    atkMul: 1.2,
    comboSkill: { name: '轅門射戟', cd: 30, desc: '精準狙擊血量最高的敵人，造成重傷並使其易傷。' },
  },
  {
    name: '武侯托孤',
    desc: '諸葛亮、姜維同時在場：所有主動技冷卻 −25%',
    requireGenerals: ['諸葛亮', '姜維'],
    cdMul: 0.75,
  },
  {
    // ⚠ 門檻不能超過 MAX_LOADOUT_GENERALS（見 sim/state.ts）：「蜀」只掛在姓名配方武將上，
    // 而姓名字無法選進編隊的「攜帶的字」，只能靠武將欄位帶入，所以門檻 > 上限就永遠湊不齊。
    name: '蜀漢棟樑',
    desc: '場上 5 名以上「蜀」武將：全體攻擊 +15%、攻速 +10%',
    requireTag: { tag: '蜀', count: 5 },
    atkMul: 1.15,
    apsMul: 1.1,
  },
]
