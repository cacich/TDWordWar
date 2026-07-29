/**
 * 敵表。HP = BASE_HP × HP_GROWTH^(wave × WAVE_REF/maxWave) × hpMul（見 sim/waves.ts）
 * ⚠ 指數吃的是「相對進度」而不是絕對波次，所以同一個 hpMul 在 12 波的關卡遠比 40 波的硬。
 * troop 用於三向相剋：騎 → 弓 → 步 → 騎（克制 +25%，被克 −25%）
 *
 * ★ 設計骨架：每隻敵人宣告 `traits`（它難對付的地方），這一個欄位同時驅動兩件事：
 *   1. 關卡的 `bias` 加權該類敵人的出現率（sim/waves.ts 的 composition）
 *   2. 經 TRAIT_COUNTERS 推導出關卡卡片上的「推薦手段」（ui/screens.ts）
 *   所以新增敵人只要填對 traits，關卡偏好與 UI 推薦都會自動跟上，不需要第二處維護。
 *
 * 平衡基準（一般兵）：`thief` = hpMul 1 / def 0 / speed 0.95 / bounty 1。
 * 其餘一般兵以它為 1.0 的基準調整；BOSS 另有一套基準見下方。
 *
 * ⚠ 灼燒（burn）走 damageEnemy() **不經過 mitigate()，完全無視防禦**，
 *   所以「高防」敵人的解法是持續傷害或高單擊，而不是多打幾下。
 *   `burnImmune` 是唯一能封掉這條路、逼玩家改帶高單擊的手段，只給少數 BOSS。
 *
 * ⚠ `bounty` 是全遊戲最大的糧食來源（約佔總收入 65%）。經濟的設計目標是
 *   「一波只夠征兵 1～2 次」，所以**動這一欄之前先跑 `npm run econ`**，
 *   它比 `waveIncome` 更能左右玩家的滾雪球速度。
 */
import type { CounterKind, EnemyDef, EnemyTrait } from '../sim/types'

/**
 * 特徵 → 應對手段的**單一對照表**。
 * 關卡的推薦標籤完全由這裡推導，不在關卡資料裡重複宣告。
 */
export const TRAIT_COUNTERS: Record<EnemyTrait, CounterKind[]> = {
  swarm: ['splash', 'pierce'],
  armored: ['dot', 'single'],
  flying: ['air'],
  fast: ['cc'],
  healer: ['single'],
  splitter: ['splash'],
  tanky: ['dot', 'single'],
}

export const COUNTER_LABEL: Record<CounterKind, string> = {
  splash: '範圍攻擊',
  pierce: '貫穿',
  single: '單體高傷',
  air: '對空',
  cc: '控場',
  dot: '持續傷害',
}

export const TRAIT_LABEL: Record<EnemyTrait, string> = {
  swarm: '成群',
  armored: '重甲',
  flying: '飛行',
  fast: '高速',
  healer: '治療',
  splitter: '分裂',
  tanky: '高血',
}

export const ENEMIES: EnemyDef[] = [
  // ── 一般兵 ────────────────────────────────────────────
  { key: 'thief', char: '賊', hpMul: 1, def: 0, speed: 0.95, flying: false, bounty: 1, damage: 1, troop: '步', traits: [], desc: '尋常賊寇（步）。' },
  { key: 'shield', char: '盾', hpMul: 1.9, def: 45, speed: 0.7, flying: false, bounty: 2, damage: 1, troop: '步', traits: ['armored'], desc: '盾賊（步）：防禦極高，怕穿透與灼燒。' },
  { key: 'swift', char: '快', hpMul: 0.55, def: 0, speed: 2.1, flying: false, bounty: 1, damage: 1, troop: '騎', traits: ['fast'], desc: '快賊（騎）：移速極快，血薄，怕步兵。' },
  { key: 'flyer', char: '飛', hpMul: 0.9, def: 10, speed: 1.35, flying: true, bounty: 2, damage: 1, troop: '弓', traits: ['flying'], desc: '飛賊（弓）：只有射程 ≥2 的單位打得到，怕騎兵。' },

  // 新敵種：每一種都對應一個玩家既有工具，讓後期的敵人組成不再只是血量變多
  {
    key: 'shaman', char: '妖', hpMul: 0.8, def: 5, speed: 0.8, flying: false, bounty: 3, damage: 1, troop: '步',
    traits: ['healer'], minWave: 6, healAura: { radius: 2.4, hps: 0.05 },
    desc: '妖道（步）：不攻擊，但每秒為周圍敵人回血。優先集火解決。',
  },
  {
    key: 'armor', char: '甲', hpMul: 2.4, def: 75, speed: 0.6, flying: false, bounty: 3, damage: 1, troop: '步',
    traits: ['armored'], minWave: 8,
    desc: '甲賊（步）：防禦誇張，普通攻擊幾乎打不動。灼燒無視防禦，是最好的解法。',
  },
  {
    key: 'splitter', char: '裂', hpMul: 1.5, def: 10, speed: 0.85, flying: false, bounty: 2, damage: 1, troop: '步',
    traits: ['splitter'], minWave: 9, splitInto: { key: 'swarmlet', count: 2 },
    desc: '分裂賊（步）：死亡時分裂成兩隻蟻賊。純單體輸出會被拖住。',
  },
  {
    key: 'gale', char: '疾', hpMul: 0.7, def: 0, speed: 2.4, flying: false, bounty: 2, damage: 1, troop: '騎',
    traits: ['fast'], minWave: 10, slowImmune: true,
    desc: '疾風賊（騎）：比快賊更快，且免疫減速。只能用定身或爆發攔下。',
  },
  {
    key: 'swarmlet', char: '蟻', hpMul: 0.3, def: 0, speed: 1.5, flying: false, bounty: 1, damage: 1, troop: '步',
    traits: ['swarm'], minWave: 7,
    desc: '蟻賊（步）：血極薄但成群湧上。範圍攻擊一掃就清。',
  },
  {
    key: 'stone', char: '磐', hpMul: 4.5, def: 30, speed: 0.4, flying: false, bounty: 4, damage: 1, troop: '步',
    traits: ['tanky'], minWave: 12,
    desc: '磐石賊（步）：極慢但血量厚重，考驗持續輸出而非瞬間爆發。',
  },

  // ── BOSS（每 5 波出現一隻，從合格者中隨機挑選） ────────
  // 基準：hpMul 8～22、def 25～95、bounty 10～17、damage 2～3、全部 ccImmune。
  // 每一隻都有一個「必須改變打法」的鉤子，而不是只有血量差異。
  {
    key: 'boss', char: '將', hpMul: 14, def: 60, speed: 0.6, flying: false, bounty: 10, damage: 2, troop: '騎',
    traits: ['tanky'], boss: true, ccImmune: true,
    desc: '賊將（騎）：最基本的首領，免疫定身與擊退。',
  },
  {
    key: 'bossIron', char: '甲', hpMul: 13, def: 95, speed: 0.5, flying: false, bounty: 12, damage: 2, troop: '步',
    traits: ['armored', 'tanky'], boss: true, ccImmune: true, burnImmune: true, minWave: 10,
    desc: '鐵甲將（步）：極高防禦且免疫灼燒——只有高單擊傷害打得動。',
  },
  {
    key: 'bossGale', char: '疾', hpMul: 9, def: 30, speed: 1.7, flying: false, bounty: 11, damage: 2, troop: '騎',
    traits: ['fast'], boss: true, ccImmune: true, slowImmune: true, minWave: 10,
    desc: '疾風將（騎）：高速且免疫減速與定身，會直接衝過防線。',
  },
  {
    key: 'bossShaman', char: '巫', hpMul: 11, def: 40, speed: 0.65, flying: false, bounty: 12, damage: 2, troop: '步',
    traits: ['healer', 'tanky'], boss: true, ccImmune: true, healAura: { radius: 3.0, hps: 0.09 }, minWave: 10,
    desc: '妖道首（步）：強力回血光環，會把整批雜兵一起奶起來。',
  },
  {
    key: 'bossSplit', char: '裂', hpMul: 12, def: 45, speed: 0.7, flying: false, bounty: 13, damage: 2, troop: '步',
    traits: ['splitter', 'tanky'], boss: true, ccImmune: true, splitInto: { key: 'splitter', count: 3 }, minWave: 15,
    desc: '分裂將（步）：死亡時裂成三隻分裂賊，沒有範圍攻擊會被淹沒。',
  },
  {
    key: 'bossFly', char: '翼', hpMul: 10, def: 35, speed: 1.1, flying: true, bounty: 13, damage: 2, troop: '弓',
    traits: ['flying'], boss: true, ccImmune: true, minWave: 10,
    desc: '飛將（弓）：飛行首領。沒有射程 ≥2 的單位完全打不到它。',
  },
  {
    key: 'bossSwarm', char: '群', hpMul: 10, def: 40, speed: 0.75, flying: false, bounty: 13, damage: 2, troop: '步',
    traits: ['swarm', 'tanky'], boss: true, ccImmune: true, escort: { key: 'swarmlet', count: 10 }, minWave: 15,
    desc: '群將（步）：帶著十隻蟻賊一起現身，範圍攻擊是唯一解。',
  },
  {
    key: 'bossRegen', char: '生', hpMul: 12, def: 50, speed: 0.6, flying: false, bounty: 13, damage: 2, troop: '步',
    traits: ['tanky'], boss: true, ccImmune: true, regen: 0.02, minWave: 15,
    desc: '再生將（步）：每秒回復自身血量，磨血打不死，必須爆發。',
  },
  {
    key: 'bossToxic', char: '毒', hpMul: 11, def: 45, speed: 0.8, flying: false, bounty: 14, damage: 3, troop: '步',
    traits: ['tanky'], boss: true, ccImmune: true, minWave: 15,
    desc: '毒將（步）：漏過大營會扣 3 點生命，絕對不能放它過去。',
  },
  {
    key: 'bossStone', char: '磐', hpMul: 22, def: 55, speed: 0.35, flying: false, bounty: 15, damage: 2, troop: '步',
    traits: ['tanky'], boss: true, ccImmune: true, minWave: 20,
    desc: '磐石將（步）：慢得誇張但血量巨大，是純粹的輸出量測驗。',
  },
  {
    // 與疾風將的差異：疾風將還能靠灼燒磨，影將連灼燒都免疫 → 只能在它衝到大營前爆發掉
    key: 'bossShadow', char: '影', hpMul: 8, def: 25, speed: 2.0, flying: false, bounty: 13, damage: 2, troop: '騎',
    traits: ['fast'], boss: true, ccImmune: true, slowImmune: true, burnImmune: true, minWave: 20,
    desc: '影將（騎）：全場最快，且免疫減速與灼燒。血量偏低，但只有純爆發攔得住。',
  },
  {
    key: 'bossWarlord', char: '霸', hpMul: 18, def: 80, speed: 0.7, flying: false, bounty: 17, damage: 3, troop: '騎',
    traits: ['armored', 'tanky'], boss: true, ccImmune: true, minWave: 25,
    desc: '霸將（騎）：高血高防又不慢，後期的綜合考驗。',
  },
]

export const ENEMY_BY_KEY: Record<string, EnemyDef> = Object.fromEntries(
  ENEMIES.map((e) => [e.key, e]),
)

/** 一般兵（非 BOSS）。波次組成只從這裡抽 */
export const REGULARS: EnemyDef[] = ENEMIES.filter((e) => !e.boss)

/** BOSS 候選。波次為 5 的倍數時從這裡隨機挑一隻 */
export const BOSSES: EnemyDef[] = ENEMIES.filter((e) => e.boss)

/** 射程未達此值視為近戰，無法攻擊飛行單位 */
export const ANTI_AIR_RANGE = 2.0

/**
 * 由關卡的 bias 推導出「推薦手段」，供關卡卡片顯示。
 * 保持順序穩定（依 TRAIT_COUNTERS 的宣告順序）並去重。
 */
export function countersFor(bias: readonly EnemyTrait[] = []): CounterKind[] {
  const out: CounterKind[] = []
  for (const t of bias) {
    for (const c of TRAIT_COUNTERS[t] ?? []) if (!out.includes(c)) out.push(c)
  }
  return out
}
