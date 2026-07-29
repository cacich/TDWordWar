/**
 * 字表 — 全部可抽到的字都在這裡。
 * 平衡基準：兵器 rarity1「刀」= atk 12 / aps 1.0 / range 1.2。
 * 姓氏與名字字刻意壓到約 40% 戰力，製造「放著等組將 vs 先賣掉」的張力。
 *
 * onHit：命中附加的控場效果（謀略字的深度來源），武將會自動繼承組成字牌的 onHit。
 * aura ：光環，影響半徑內其他單位；帶 aura 的字通常 atk = 0，本身不攻擊。
 */
import type { GlyphDef } from '../sim/types'

export const GLYPHS: GlyphDef[] = [
  // ── 兵器 ────────────────────────────────────────────
  { char: '刀', category: 'weapon', rarity: 1, atk: 12, aps: 1.0, range: 1.2, shape: 'single', tags: ['兵器', '近戰', '步'], desc: '近身直劈，傷害高、射程短。', fx: 'blade' },
  { char: '弓', category: 'weapon', rarity: 1, atk: 7, aps: 1.1, range: 3.5, shape: 'single', tags: ['兵器', '遠程', '弓'], desc: '遠射，可打飛行單位。', fx: 'arrow' },
  { char: '矛', category: 'weapon', rarity: 2, atk: 10, aps: 0.8, range: 2.0, shape: 'pierce', tags: ['兵器', '步'], desc: '長刺穿透，一次貫穿路徑上多名敵人。', fx: 'thrust' },
  { char: '劍', category: 'weapon', rarity: 2, atk: 15, aps: 1.1, range: 1.2, shape: 'single', tags: ['兵器', '近戰'], desc: '快且銳，單體輸出之最。', fx: 'blade' },
  { char: '槍', category: 'weapon', rarity: 2, atk: 13, aps: 0.9, range: 1.9, shape: 'pierce', tags: ['兵器', '步'], desc: '長槍直取，貫穿且射程較長。', fx: 'thrust' },
  { char: '戟', category: 'weapon', rarity: 3, atk: 19, aps: 0.7, range: 1.6, shape: 'splash', tags: ['兵器', '近戰'], desc: '大開大合，濺射周圍敵人。', fx: 'blade' },
  { char: '弩', category: 'weapon', rarity: 3, atk: 12, aps: 1.4, range: 4.2, shape: 'single', tags: ['兵器', '遠程', '弓'], desc: '連發強弩，射程與攻速兼備。', fx: 'arrow' },
  {
    char: '斧', category: 'weapon', rarity: 3, atk: 24, aps: 0.5, range: 1.3, shape: 'single', tags: ['兵器', '近戰'],
    desc: '重斧劈砍，命中使敵人短暫定身。', onHit: { stunDur: 0.4 }, fx: 'blade' },

  // ── 兵種 ────────────────────────────────────────────
  { char: '兵', category: 'troop', rarity: 1, atk: 4, aps: 1.0, range: 1.2, shape: 'single', tags: ['兵種', '步'], desc: '尋常兵卒。與兵器或兵種相鄰可組成部隊。', fx: 'charge' },
  { char: '步', category: 'troop', rarity: 1, atk: 6, aps: 1.0, range: 1.5, shape: 'single', tags: ['兵種', '步'], desc: '步行陣列，穩健。', fx: 'charge' },
  { char: '盾', category: 'troop', rarity: 1, atk: 3, aps: 0.6, range: 1.2, shape: 'single', tags: ['兵種', '步'], desc: '攻擊極弱，但是組成部隊的好材料。', fx: 'charge' },
  { char: '騎', category: 'troop', rarity: 2, atk: 11, aps: 1.4, range: 1.2, shape: 'single', tags: ['兵種', '騎'], desc: '快馬衝擊，攻速優異。', fx: 'charge' },
  { char: '車', category: 'troop', rarity: 3, atk: 20, aps: 0.5, range: 2.5, shape: 'splash', tags: ['兵種'], desc: '戰車碾壓，慢但範圍大。', fx: 'charge' },

  // ── 謀略（控場與光環） ──────────────────────────────
  {
    char: '火', category: 'strategy', rarity: 3, atk: 9, aps: 0.7, range: 3.0, shape: 'splash', tags: ['謀略'],
    desc: '火攻。範圍傷害並使敵人灼燒。', onHit: { burn: { mul: 0.5, dur: 3 } }, fx: 'fire',
  },
  {
    char: '計', category: 'strategy', rarity: 2, atk: 5, aps: 0.6, range: 4.0, shape: 'single', tags: ['謀略'],
    desc: '運籌帷幄。射程極遠，命中減速敵人。', onHit: { slowDur: 1.5 }, fx: 'plan' },
  {
    char: '風', category: 'strategy', rarity: 2, atk: 6, aps: 0.8, range: 3.0, shape: 'single', tags: ['謀略'],
    desc: '狂風。命中把敵人往後吹退。', onHit: { knock: 0.7 }, fx: 'gale' },
  {
    char: '雷', category: 'strategy', rarity: 3, atk: 11, aps: 0.6, range: 3.2, shape: 'single', tags: ['謀略'],
    desc: '天雷。命中後連鎖擊中附近 2 名敵人。', onHit: { chain: 2 }, fx: 'bolt' },
  {
    char: '毒', category: 'strategy', rarity: 2, atk: 4, aps: 0.9, range: 2.6, shape: 'single', tags: ['謀略'],
    desc: '下毒。傷害低但持續灼蝕，對高血量敵人有效。', onHit: { burn: { mul: 0.8, dur: 4 } }, fx: 'venom',
  },
  {
    char: '陣', category: 'strategy', rarity: 3, atk: 0, aps: 0, range: 0, shape: 'single', tags: ['謀略', '光環'],
    // desc 給玩家看，講一階的效果；實際加成會隨品質階級由 scaleAura() 放大
    desc: '布陣。本身不攻擊，使半徑 2.2 格內的友軍攻擊 +25%（隨品質提升）。', aura: { radius: 2.2, atkMul: 1.25 }, fx: 'none' },
  {
    char: '令', category: 'strategy', rarity: 3, atk: 0, aps: 0, range: 0, shape: 'single', tags: ['謀略', '光環'],
    desc: '軍令。本身不攻擊，使半徑 2.2 格內的友軍攻速 +25%（隨品質提升）。', aura: { radius: 2.2, apsMul: 1.25 }, fx: 'none' },

  // ── 經濟（不攻擊，每波產糧；產出 = income × 品質階級） ──
  {
    char: '糧', category: 'economy', rarity: 2, atk: 0, aps: 0, range: 0, shape: 'single', tags: ['經濟'],
    desc: '糧倉。不攻擊，每波結算產出 3 糧（每提升一階 +3）。', income: 3, fx: 'none',
  },
  {
    char: '田', category: 'economy', rarity: 2, atk: 0, aps: 0, range: 0, shape: 'single', tags: ['經濟'],
    desc: '農田。不攻擊，每波結算產出 2 糧。與「屯」相鄰可成屯田。', income: 2, fx: 'none',
  },
  {
    char: '屯', category: 'economy', rarity: 3, atk: 0, aps: 0, range: 0, shape: 'single', tags: ['經濟'],
    desc: '屯駐。不攻擊，每波結算產出 4 糧。', income: 4, fx: 'none',
  },
  {
    char: '商', category: 'economy', rarity: 3, atk: 0, aps: 0, range: 0, shape: 'single', tags: ['經濟'],
    desc: '通商。不攻擊，每波結算產出 6 糧，是最強的單字經濟。', income: 6, fx: 'none',
  },

  // ── 姓氏（單獨弱，組將用） ──────────────────────────
  ...surnames([
    '劉', '關', '張', '趙', '馬', '黃', '呂', '曹', '孫', '周', '諸', '龐',
    '甘', '徐', '郭', '荀', '陳', '魏', '姜', '陸',
  ]),

  // ── 名字（單獨弱，組將用） ──────────────────────────
  ...givens([
    '備', '羽', '飛', '雲', '布', '忠', '超', '蓋', '岱', '興', '操', '權', '瑜', '亮', '葛', '遼', '統',
    '寧', '晃', '嘉', '彧', '宮', '延', '維', '遜', '蒙', '泰',
  ]),
]

/** 姓氏字規格一致，用產生器避免抄錯 */
function surnames(chars: string[]): GlyphDef[] {
  return chars.map((char) => ({
    char,
    category: 'surname' as const,
    rarity: 2 as const,
    atk: 5,
    aps: 0.9,
    range: 1.5,
    shape: 'single' as const,
    tags: ['姓氏'],
    desc: '姓氏。單獨戰力低，與正確的名字相鄰可成武將。',
  }))
}

function givens(chars: string[]): GlyphDef[] {
  return chars.map((char) => ({
    char,
    category: 'given' as const,
    rarity: 3 as const,
    atk: 5,
    aps: 0.9,
    range: 1.5,
    shape: 'single' as const,
    tags: ['名字'],
    desc: '名字。單獨戰力低，與正確的姓氏相鄰可成武將。',
  }))
}

export const GLYPH_BY_CHAR: Record<string, GlyphDef> = Object.fromEntries(
  GLYPHS.map((g) => [g.char, g]),
)

export function glyphDef(char: string): GlyphDef {
  const d = GLYPH_BY_CHAR[char]
  if (!d) throw new Error(`未知的字：${char}（請確認已加入 src/data/glyphs.ts）`)
  return d
}

// ── 字牌品質階級 ──────────────────────────────────────
/** 每階屬性倍率 ×1.55 */
export const LEVEL_MUL = 1.55
export const MAX_GLYPH_LEVEL = 5

export function levelMul(level: number): number {
  return Math.pow(LEVEL_MUL, level - 1)
}

/** 品質名稱：兩個一階疊成二階，以此類推 */
export const QUALITY_NAME = ['一階', '二階', '三階', '四階', '五階'] as const

export function qualityName(level: number): string {
  return QUALITY_NAME[Math.min(Math.max(level, 1), MAX_GLYPH_LEVEL) - 1]
}
