/**
 * 配方表 — 相鄰的字組成這裡的 recipe 時合成武將。
 * recipe 順序 = 橫向左→右 / 縱向上→下 的正讀順序。
 * 武將 ATK = Σ(組成字牌 atk × 品質倍率) × atkMul，因此「先養字再組將」是有效策略。
 *
 * skill 只是宣告；真正的行為註冊在 sim/skills.ts 的 SKILLS[武將名]。
 * 沒有註冊實作的 skill 不會施放（資訊面板仍會顯示文字）。
 */
import type { GeneralDef, Tier } from '../sim/types'

/** 各階級的預設倍率，新增武將時直接沿用即可 */
export const TIER_MUL: Record<Tier, { atkMul: number; apsMul: number }> = {
  common: { atkMul: 1.6, apsMul: 1.1 },
  fine: { atkMul: 2.0, apsMul: 1.15 },
  epic: { atkMul: 2.4, apsMul: 1.2 },
  legendary: { atkMul: 3.0, apsMul: 1.3 },
  mythic: { atkMul: 3.8, apsMul: 1.4 },
}

function g(
  name: string,
  recipe: string[],
  tier: Tier,
  range: number,
  shape: GeneralDef['shape'],
  tags: string[],
  desc: string,
  skill?: GeneralDef['skill'],
  extra?: Pick<GeneralDef, 'fx' | 'income' | 'onHit' | 'aura'>,
): GeneralDef {
  return { name, recipe, tier, range, shape, tags, desc, skill, ...TIER_MUL[tier], ...extra }
}

export const GENERALS: GeneralDef[] = [
  // ── 普通：兵種部隊（「兵」是最容易取得的組詞鑰匙） ──
  g('刀兵', ['刀', '兵'], 'common', 1.3, 'single', ['部隊', '步'], '持刀列陣的正規軍。'),
  g('弓兵', ['弓', '兵'], 'common', 3.8, 'single', ['部隊', '弓'], '弓箭手隊，對飛行單位傷害提升。'),
  g('盾兵', ['盾', '兵'], 'common', 1.3, 'single', ['部隊', '步'], '盾陣。攻擊平庸但便宜。'),
  g('步兵', ['步', '兵'], 'common', 1.6, 'single', ['部隊', '步'], '基本步兵隊。'),
  g('騎兵', ['騎', '兵'], 'common', 1.3, 'single', ['部隊', '騎'], '騎兵隊，攻速快。'),
  g('弩兵', ['弩', '兵'], 'common', 4.4, 'single', ['部隊', '弓'], '弩兵隊，遠程連發。'),
  g('槍兵', ['槍', '兵'], 'common', 2.1, 'pierce', ['部隊', '步'], '長槍陣列，貫穿成排敵人。'),
  g('車兵', ['車', '兵'], 'common', 2.6, 'splash', ['部隊'], '戰車隊，範圍碾壓。'),
  g('矛兵', ['矛', '兵'], 'common', 2.0, 'pierce', ['部隊', '步'], '長矛陣列，貫穿直取。'),
  g('劍兵', ['劍', '兵'], 'common', 1.3, 'single', ['部隊'], '精銳劍士，出手兇猛。'),
  g('戟兵', ['戟', '兵'], 'common', 1.6, 'splash', ['部隊'], '持戟列陣，範圍掃蕩。'),
  g('斧兵', ['斧', '兵'], 'common', 1.3, 'single', ['部隊'], '重斧列陣，一擊定身。'),

  // ── 精良：謀略組合與副將 ────────────────────────────
  g('火計', ['火', '計'], 'fine', 3.4, 'splash', ['謀略'], '以計縱火，範圍傷害並灼燒。', {
    name: '燎原',
    cd: 10,
    desc: '大範圍火焰，造成傷害並延長灼燒。',
  }),
  g('毒計', ['毒', '計'], 'fine', 3.0, 'splash', ['謀略'], '投毒於水源，持續灼蝕。', {
    name: '疫疾',
    cd: 12,
    desc: '使範圍內敵人中毒並減速。',
  }),
  g('雷陣', ['雷', '陣'], 'fine', 3.4, 'single', ['謀略', '光環'], '雷法結陣，連鎖打擊並增益友軍。', {
    name: '落雷',
    cd: 11,
    desc: '對範圍內敵人降雷，並使其短暫定身。',
  }),
  g('風令', ['風', '令'], 'fine', 3.0, 'single', ['謀略', '光環'], '疾風軍令，鼓舞三軍、擊退近敵。', {
    name: '疾風令',
    cd: 12,
    desc: '範圍擊退敵人，並小幅傷害。',
  }),
  g(
    '屯田',
    ['屯', '田'],
    'fine',
    0,
    'single',
    ['經濟'],
    '屯田制。不攻擊，但每波產出大量糧草，是滾雪球的關鍵。',
    undefined,
    { income: 14, fx: 'none' },
  ),
  g('黃蓋', ['黃', '蓋'], 'fine', 1.4, 'splash', ['吳', '老將'], '苦肉之計。近身濺射。', {
    name: '苦肉計',
    cd: 14,
    desc: '捨身衝撞，範圍高額傷害並灼燒。',
  }),
  g('馬岱', ['馬', '岱'], 'fine', 1.4, 'single', ['蜀', '騎', '馬'], '西涼騎將，馬超族弟。', {
    name: '追擊',
    cd: 13,
    desc: '對最前方敵人連續突刺。',
  }),
  g('周泰', ['周', '泰'], 'fine', 1.3, 'single', ['吳', '老將'], '遍體鱗傷，捨身護主。', {
    name: '捨身擋箭',
    cd: 13,
    desc: '低傷害範圍衝撞，並使敵人短暫定身。',
  }),
  g('荀彧', ['荀', '彧'], 'fine', 1.5, 'single', ['魏', '謀略'], '王佐之才，鎮守後方調度糧秣。', {
    name: '調度糧秣',
    cd: 24,
    desc: '立即獲得一筆糧草。',
  }),
  g('陳宮', ['陳', '宮'], 'fine', 3.0, 'single', ['群雄', '謀略'], '呂布謀主，轅門定計。', {
    name: '獻計',
    cd: 12,
    desc: '使範圍內敵人減速。',
  }),

  // ── 史詩：名將 ──────────────────────────────────────
  g('馬超', ['馬', '超'], 'epic', 1.5, 'pierce', ['蜀', '五虎', '騎', '馬'], '錦馬超，衝陣穿透。', {
    name: '西涼突擊',
    cd: 12,
    desc: '沿路徑衝鋒，貫穿並擊退敵人。',
  }),
  g('關興', ['關', '興'], 'epic', 1.5, 'single', ['蜀', '將二代'], '關羽之子，承父之志。', {
    name: '承父之志',
    cd: 13,
    desc: '對直線敵人造成高額傷害。',
  }),
  g('甘寧', ['甘', '寧'], 'epic', 1.8, 'pierce', ['吳', '奇襲'], '錦帆賊帥，百騎劫營。', {
    name: '百騎劫營',
    cd: 12,
    desc: '衝鋒貫穿最前方敵人，並使其易傷。',
  }),
  g('呂蒙', ['呂', '蒙'], 'epic', 1.6, 'single', ['吳'], '士別三日，白衣渡江。', {
    name: '白衣渡江',
    cd: 13,
    desc: '範圍內敵人中計，減速並易傷。',
  }),
  g('郭嘉', ['郭', '嘉'], 'epic', 3.4, 'single', ['魏', '謀略'], '鬼才軍師，遺計定遼東。', {
    name: '遺計定遼東',
    cd: 14,
    desc: '大範圍重度減速並易傷，直接傷害不高。',
  }),

  // ── 傳說：頂級武將 ──────────────────────────────────
  g('張飛', ['張', '飛'], 'legendary', 1.6, 'splash', ['蜀', '五虎', '桃園', '步'], '燕人張飛，當陽橋一喝。', {
    name: '當陽橋喝',
    cd: 14,
    desc: '範圍定身 1.5 秒，並使敵人易傷。',
  }),
  g('趙雲', ['趙', '雲'], 'legendary', 1.6, 'pierce', ['蜀', '五虎', '騎'], '常山趙子龍，一身是膽。', {
    name: '七進七出',
    cd: 16,
    desc: '沿整條路徑衝鋒，穿透所有敵人。',
  }),
  g(
    '關羽',
    ['關', '羽'],
    'legendary',
    2.2,
    'pierce',
    ['蜀', '五虎', '桃園'],
    '美髯公，青龍偃月。',
    { name: '青龍偃月', cd: 15, desc: '對前方一段路徑造成 320% 傷害。' },
    { fx: 'blade' },
  ),
  g('黃忠', ['黃', '忠'], 'legendary', 4.2, 'single', ['蜀', '五虎', '弓'], '老當益壯，百步穿楊。', {
    name: '百步穿楊',
    cd: 12,
    desc: '狙擊全場血量最高的敵人，450% 傷害。',
  }),
  g('劉備', ['劉', '備'], 'legendary', 2.0, 'single', ['蜀', '桃園', '主公'], '仁德之君，凝聚全軍。', {
    name: '仁德',
    cd: 45,
    desc: '恢復 1 點生命（不超過上限）。',
  }),
  g('呂布', ['呂', '布'], 'legendary', 1.6, 'splash', ['群雄', '飛將'], '人中呂布，馬中赤兔。', {
    name: '無雙',
    cd: 15,
    desc: '連續三段濺射斬擊。',
  }),
  g('張遼', ['張', '遼'], 'legendary', 1.5, 'pierce', ['魏', '騎'], '八百破十萬，威震逍遙津。', {
    name: '突陣',
    cd: 13,
    desc: '衝鋒貫穿並定身命中的敵人。',
  }),
  g('曹操', ['曹', '操'], 'legendary', 2.4, 'splash', ['魏', '主公'], '治世之能臣，亂世之奸雄。', {
    name: '挾令',
    cd: 18,
    desc: '範圍傷害，並立即徵得糧草。',
  }),
  g('孫權', ['孫', '權'], 'legendary', 2.2, 'single', ['吳', '主公'], '生子當如孫仲謀。', {
    name: '制衡',
    cd: 20,
    desc: '立即獲得一筆糧草。',
  }),
  g(
    '周瑜',
    ['周', '瑜'],
    'legendary',
    3.6,
    'splash',
    ['吳', '謀略'],
    '公瑾雅量高致，長於火攻。',
    { name: '火攻', cd: 15, desc: '大範圍縱火，重度灼燒。' },
    { fx: 'fire', onHit: { burn: { mul: 0.7, dur: 4 } } },
  ),
  g('龐統', ['龐', '統'], 'legendary', 3.8, 'single', ['蜀', '謀略', '鳳雛'], '鳳雛先生，連環之計。', {
    name: '連環計',
    cd: 16,
    desc: '全場敵人減速並易傷。',
  }),
  g(
    '陸遜',
    ['陸', '遜'],
    'legendary',
    3.2,
    'splash',
    ['吳', '謀略'],
    '書生都督，火燒連營。',
    { name: '火燒連營', cd: 15, desc: '大範圍縱火，並延長灼燒。' },
    { fx: 'fire', onHit: { burn: { mul: 0.6, dur: 3 } } },
  ),
  g('徐晃', ['徐', '晃'], 'legendary', 2.0, 'pierce', ['魏', '步'], '整齊嚴謹，長蛇之陣。', {
    name: '長蛇陣',
    cd: 14,
    desc: '對一段路徑造成高額傷害。',
  }),
  g('魏延', ['魏', '延'], 'legendary', 1.6, 'pierce', ['蜀', '騎'], '子午奇謀，勇冠三軍。', {
    name: '子午奇謀',
    cd: 13,
    desc: '衝鋒貫穿路徑上的敵人，並使其易傷。',
  }),
  g('姜維', ['姜', '維'], 'legendary', 3.4, 'splash', ['蜀', '謀略'], '文武雙全，繼武侯之志。', {
    name: '九伐中原',
    cd: 16,
    desc: '全場敵人減速並短暫定身。',
  }),

  // ── 神話：三字配方 ──────────────────────────────────
  g('諸葛亮', ['諸', '葛', '亮'], 'mythic', 4.0, 'splash', ['蜀', '謀略', '臥龍'], '臥龍先生，八陣圖鎖敵。', {
    name: '八陣圖',
    cd: 14,
    desc: '全路徑減速與定身，並造成範圍傷害。',
  }),
]

export const GENERAL_BY_NAME: Record<string, GeneralDef> = Object.fromEntries(
  GENERALS.map((x) => [x.name, x]),
)

/** 配方查表：'張飛' → GeneralDef。組詞判定的核心索引 */
export const RECIPE_INDEX: Map<string, GeneralDef> = new Map(
  GENERALS.map((x) => [x.recipe.join(''), x]),
)

export const TIER_ORDER: Record<Tier, number> = {
  common: 1,
  fine: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
}

/** 配方中最長的字數，組詞掃描時作為上界 */
export const MAX_RECIPE_LEN = GENERALS.reduce((m, x) => Math.max(m, x.recipe.length), 0)
