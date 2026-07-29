/**
 * 全專案共用型別。此檔不可 import 任何 render/DOM 相關模組。
 */

// ── 棋盤 ──────────────────────────────────────────────
export type TileKind = 'plot' | 'path' | 'block' | 'spawn' | 'camp'

export interface Board {
  cols: number
  rows: number
  tiles: TileKind[] // 長度 cols*rows，索引 = r*cols+c
  /** 敵人行走路徑，元素為 cell 索引，依序從 spawn 到 camp */
  path: number[]
  spawn: number
  camp: number
}

// ── 字牌 ──────────────────────────────────────────────
export type GlyphCategory =
  | 'weapon' // 兵器
  | 'troop' // 兵種
  | 'surname' // 姓氏
  | 'given' // 名字
  | 'strategy' // 謀略
  | 'economy' // 經濟

/** 攻擊型態：單體 / 穿透（沿路徑貫穿多個） / 濺射（範圍） */
export type AttackShape = 'single' | 'pierce' | 'splash'

/** 兵種相剋：騎 → 弓 → 步 → 騎（克制方 +25%，被克方 −25%） */
export type Troop = '騎' | '弓' | '步' | 'none'

/** 命中時附加的控場效果。謀略字的深度來源 */
export interface OnHit {
  /** 減速秒數（減速幅度固定 50%） */
  slowDur?: number
  /** 灼燒：每秒 atk × mul，持續 dur 秒 */
  burn?: { mul: number; dur: number }
  /** 定身秒數 */
  stunDur?: number
  /** 擊退：沿路徑後退幾格 */
  knock?: number
  /** 連鎖：額外命中幾個附近目標（傷害 60%） */
  chain?: number
  /** 易傷：受到的傷害提升 30%，持續秒數 */
  vulnDur?: number
}

/** 光環：影響半徑內的其他單位。帶 aura 的字通常 atk = 0 */
export interface Aura {
  radius: number
  atkMul?: number
  apsMul?: number
}

export interface GlyphDef {
  char: string
  category: GlyphCategory
  /** 抽卡稀有度分級 1~4，同時決定抽取權重 */
  rarity: 1 | 2 | 3 | 4
  atk: number
  aps: number
  /** 射程，單位為格。<2 視為近戰，無法攻擊飛行單位 */
  range: number
  shape: AttackShape
  tags: string[]
  desc: string
  onHit?: OnHit
  aura?: Aura
  /** 每波結算時產出的糧（經濟字）。實際產出 = income × 品質階級 */
  income?: number
  /** 攻擊特效樣式；未指定則由 sim/state.ts 的 deriveGlyphFx() 推導 */
  fx?: FxKind
}

/**
 * 攻擊特效樣式。sim 只決定「語義」，顏色與畫法由 render/ 決定，
 * 這樣才能維持 sim 不依賴 render 的分層規則。
 */
export type FxKind =
  | 'blade' // 刀劍斧戟：弧形斬擊
  | 'arrow' // 弓弩：細箭
  | 'thrust' // 矛槍：直刺
  | 'fire' // 火：火球
  | 'bolt' // 雷：鋸齒閃電
  | 'venom' // 毒：綠色氣泡
  | 'gale' // 風：新月氣旋
  | 'plan' // 計：文字飛出
  | 'charge' // 騎車步盾：衝撞塵土
  | 'none' // 光環與經濟字，不攻擊

// ── 武將 ──────────────────────────────────────────────
export type Tier = 'common' | 'fine' | 'epic' | 'legendary' | 'mythic'

export interface GeneralDef {
  name: string
  /** 配方：依「橫向左→右 / 縱向上→下」的正讀順序 */
  recipe: string[]
  tier: Tier
  /** 對組成字牌總和取倍率 */
  atkMul: number
  apsMul: number
  range: number
  shape: AttackShape
  tags: string[]
  desc: string
  /** 主動技。實作註冊在 sim/skills.ts 的 SKILLS[武將名] */
  skill?: { name: string; cd: number; desc: string }
  /** 未指定時，由組成字牌的 onHit 自動合併繼承 */
  onHit?: OnHit
  aura?: Aura
  income?: number
  /** 未指定時繼承組成字牌的 fx */
  fx?: FxKind
}

// ── 場上單位 ──────────────────────────────────────────
/**
 * 字牌（glyph）與武將（general）共用同一個型別，但**兩者同時存在於棋盤上**：
 * 武將不會取代字牌，而是疊在字牌之上的一層（用 memberIds / formIds 互相指向）。
 *
 * 這個設計是為了支援三件事：
 *   1. 組成武將後還能繼續往上疊同一個字升階
 *   2. 個別搬動組成武將的單字（拖走「遼」換成「飛」→ 張遼變張飛）
 *   3. 同一個字同時參與橫向與縱向兩個武將（「張」右邊遼、下面飛 → 同時成兩將）
 *
 * 因此：`state.units` 裡的格子會重疊，不能再用「一格一個 unit」的假設。
 * 取用時請用 sim/state.ts 的 glyphAt() 與 formsAt()。
 */
export interface Unit {
  id: number
  kind: 'glyph' | 'general'
  /** glyph 為單字；general 為配方全字 */
  chars: string[]
  /** glyph=字，general=武將名 */
  defKey: string
  /** 占用的 cell 索引，依正讀順序 */
  cells: number[]
  /** 字牌為品質階級 1~5；武將為「組成字牌階級之和」 */
  level: number
  /** glyph 專用：所屬武將的 id（0～2 個：橫向與縱向各一） */
  formIds: number[]
  /** general 專用：組成字牌的 id，依正讀順序 */
  memberIds: number[]
  tier: Tier
  tags: string[]
  // 未計入任何加成的基礎值
  baseAtk: number
  baseAps: number
  baseRange: number
  shape: AttackShape
  // 實效值，由 recalcUnits() 覆寫：基礎值 × 羈絆 × 局外道具 perks × 光環
  atk: number
  aps: number
  range: number
  /** 攻擊冷卻剩餘秒數 */
  cd: number
  /** 索敵模式 */
  targeting: 'front' | 'near' | 'strong'
  troop: Troop
  onHit?: OnHit
  aura?: Aura
  /** 每波產糧（已含品質加成） */
  income: number
  fx: FxKind
  /** 主動技冷卻。cdMax = 0 表示沒有主動技 */
  skillCd: number
  skillCdMax: number
  /** 剛施放技能的閃光殘留秒數，純視覺 */
  skillFlash: number
  /** 剛攻擊的閃光殘留秒數，純視覺（讓玩家看得出是誰在打） */
  atkFlash: number
}

// ── 敵人 ──────────────────────────────────────────────
/**
 * 敵人特徵：描述「這隻敵人難對付的地方」。
 * 用途有兩個，共用同一份定義避免重複：
 *   1. 關卡的 `bias` 宣告偏好哪些特徵 → 加權該類敵人的出現率（sim/waves.ts）
 *   2. 經 TRAIT_COUNTERS（data/enemies.ts）推導出關卡卡片上的「推薦手段」（ui/screens.ts）
 */
export type EnemyTrait = 'swarm' | 'armored' | 'flying' | 'fast' | 'healer' | 'splitter' | 'tanky'

/** 應對手段。顯示在關卡卡片上，讓玩家知道這一關該帶什麼 */
export type CounterKind = 'splash' | 'pierce' | 'single' | 'air' | 'cc' | 'dot'

export interface EnemyDef {
  key: string
  char: string
  hpMul: number
  def: number
  /** 每秒前進格數 */
  speed: number
  flying: boolean
  bounty: number
  /** 抵達大營扣的生命 */
  damage: number
  /** 兵種，用於三向相剋 */
  troop: Troop
  desc: string
  /** 這隻敵人的難處，決定關卡加權與推薦手段 */
  traits: EnemyTrait[]
  /** true 表示免疫定身與擊退（BOSS 用） */
  ccImmune?: boolean
  /** 免疫灼燒。⚠ 灼燒無視防禦，所以這是唯一能逼玩家改用高單擊的手段 */
  burnImmune?: boolean
  /** 免疫減速 */
  slowImmune?: boolean
  /** 為半徑內其他敵人每秒回血（妖道系） */
  healAura?: { radius: number; hps: number }
  /** 自我每秒回血，數值是「最大血量的比例」，逼玩家用爆發而非磨血 */
  regen?: number
  /** 死亡時分裂出的小怪 */
  splitInto?: { key: string; count: number }
  /** 生成時一起帶出來的護衛（在 buildWave 展開） */
  escort?: { key: string; count: number }
  /** 是 BOSS 候選（波次為 5 的倍數時隨機挑一個） */
  boss?: boolean
  /** 最早可以出現的波次，用來把強力敵種擋在後期 */
  minWave?: number
}

export interface Enemy {
  id: number
  defKey: string
  char: string
  hp: number
  maxHp: number
  def: number
  speed: number
  flying: boolean
  bounty: number
  damage: number
  /** 已行進距離，單位為 path 的段數（float） */
  dist: number
  troop: Troop
  ccImmune: boolean
  burnImmune: boolean
  slowImmune: boolean
  /** 受擊閃白剩餘秒數 */
  hitFlash: number
  // ── 狀態（剩餘秒數） ──
  slow: number
  stun: number
  vuln: number
  burnT: number
  /** 灼燒每秒傷害 */
  burnDps: number
}

// ── 特效（純資料，render 負責畫） ─────────────────────
export interface Effect {
  kind: 'attack' | 'splash' | 'text' | 'ring' | 'beam'
  fromX: number
  fromY: number
  toX: number
  toY: number
  life: number
  maxLife: number
  text?: string
  color?: string
  /** kind==='attack' 時決定畫法 */
  fx?: FxKind
  /** 攻擊者的字，畫在命中點讓玩家知道是誰打的 */
  glyph?: string
  /** 攻擊者的階級，決定特效顏色濃度 */
  tier?: Tier
}

// ── 手牌 ──────────────────────────────────────────────
export interface HandCard {
  char: string
  level: number
}

// ── 模擬事件 ──────────────────────────────────────────
/**
 * sim 用來對外回報「發生了什麼」的純資料佇列。
 * 音效與粒子都靠它觸發——這樣 sim 依然不需要知道 Web Audio 或 canvas 的存在。
 * app 層每幀 drain 一次（見 app.ts 的 drainEvents）。
 */
export type SimEvent =
  | { kind: 'place'; char: string }
  | { kind: 'merge'; char: string; level: number }
  | { kind: 'combine'; name: string; tier: Tier; cells: number[] }
  | { kind: 'dissolve'; name: string }
  | { kind: 'attack'; fx: FxKind; x: number; y: number }
  | { kind: 'kill'; x: number; y: number; bounty: number }
  | { kind: 'skill'; name: string; x: number; y: number }
  | { kind: 'combo'; name: string }
  | { kind: 'leak' }
  | { kind: 'waveClear'; wave: number }
  | { kind: 'won' }
  | { kind: 'lost' }

/** 佇列上限：純視聽用途，超量直接丟棄，避免 Node 模擬時無限成長 */
export const MAX_EVENTS = 64

// ── 羈絆 ──────────────────────────────────────────────
export interface BondDef {
  name: string
  desc: string
  /** 條件：需要在場的武將名（全部滿足） */
  requireGenerals?: string[]
  /** 條件：帶有此 tag 的武將數量門檻 */
  requireTag?: { tag: string; count: number }
  atkMul?: number
  apsMul?: number
  /** 主動技冷卻倍率（0.7 = 縮短 30%） */
  cdMul?: number
  /** 組合技。實作註冊在 sim/skills.ts 的 COMBOS[羈絆名] */
  comboSkill?: { name: string; cd: number; desc: string }
}

export interface ActiveBond {
  name: string
  desc: string
  /** 有組合技時，回報剩餘冷卻供 UI 顯示 */
  combo?: { name: string; cd: number; cdMax: number }
}

// ── 局外道具（商城）帶來的被動效果 ────────────────────
/**
 * 由 data/shop.ts 依「已購買的道具」推導，createGame 時寫進 GameState。
 * 全部是被動、整局有效；未購買時為中性值（倍率 1、機率/間隔 0），
 * 所以 npm run sim 的預設 meta（無道具）難度基準完全不受影響。
 */
export interface Perks {
  /** 徵兵時每個字直接抽到二階的機率 */
  recruitEliteChance: number
  /** 天降火球間隔秒數；0 = 未啟用 */
  meteorInterval: number
  /** 每波固定收入倍率 */
  incomeMul: number
  /** 每通過幾波回復 1 點生命；0 = 未啟用 */
  healEveryWaves: number
  /** 全場友軍攻擊倍率 */
  atkMul: number
  /** 全場友軍攻速倍率 */
  apsMul: number
  /** 每次攻擊的爆擊機率 */
  critChance: number
  /** 爆擊傷害倍率（只在 critChance > 0 時有意義） */
  critMul: number
  /** 起始與上限生命額外加成 */
  extraLives: number
  /** 征兵／重抽花費倍率（<1 = 打折） */
  costMul: number
  /** 熟悉度加權的額外倍率（疊在 economy.FAMILIAR_BOOST 上） */
  familiarBoostMul: number
  /** 敵人漏過大營時，不扣血命的機率 */
  leakBlockChance: number
  /** 範圍／貫穿型攻擊（pierce／splash）的額外傷害倍率 */
  splashMul: number
  /** 擊殺獲得的糧食倍率 */
  bountyMul: number
  /** 敵人移動速度倍率（<1 = 減速） */
  enemySpeedMul: number
  /** 全場友軍射程的額外倍率（疊在 combat.RANGE_MUL 之上） */
  rangeMul: number
  /** 技能與羈絆組合技冷卻時間倍率（<1 = 更快回轉） */
  cdMul: number
}

// ── 遊戲狀態 ──────────────────────────────────────────
export type Phase = 'prep' | 'battle' | 'won' | 'lost'

export interface SpawnEntry {
  /** 本波開始後幾秒生成 */
  at: number
  defKey: string
  hp: number
}

export interface GameState {
  levelKey: string
  levelName: string
  /** 關卡難度：敵人血量倍率 */
  hpMul: number
  /** 本關的敵人偏好（見 data/levels），buildWave 依它加權敵種與 BOSS 的出現率 */
  bias: EnemyTrait[]
  board: Board
  rng: () => number
  /** 本局字池（見 sim/pool.ts）。征兵只會抽到這些字 */
  pool: string[]
  /** 這個字池可以組出的武將名稱，供 UI 顯示「本局可湊」 */
  poolGenerals: string[]
  /** 心願單：這些字的抽取權重大幅提高（本局有效，不跨局） */
  wishes: string[]
  /** 心願上限（可由局外養成提升） */
  wishSlots: number
  /** 本幀發生的事件，由 app 層 drain 後清空 */
  events: SimEvent[]

  units: Unit[]
  enemies: Enemy[]
  effects: Effect[]

  hand: (HandCard | null)[]
  handSize: number

  food: number
  lives: number
  maxLives: number
  wave: number
  maxWave: number
  phase: Phase

  /** prep 階段剩餘秒數 */
  prepTimer: number
  /** 本波尚未生成的敵人 */
  spawnQueue: SpawnEntry[]
  /** 本波已生成完畢且場上無敵人 → 進入下一波 */
  waveTime: number
  recruitsThisWave: number
  smeltFreeLeft: number
  /** 上一波的結算收入，供 UI 顯示 */
  lastIncome: { base: number; units: number }

  activeBonds: ActiveBond[]
  /** 組合技冷卻，key = 羈絆名 */
  bondCds: Record<string, number>
  /** 技能冷卻倍率，由 recalcUnits 寫入 = 羈絆的 cdMul × perks.cdMul（兵法傳承） */
  cdMul: number
  nextUnitId: number
  nextEnemyId: number
  time: number
  stats: { kills: number; foodEarned: number; leaks: number }
  /** 局外道具帶來的被動效果（由 createGame 依 meta.items 算好，整局固定） */
  perks: Perks
  /** 天降火球倒數（runtime，只在戰鬥階段遞減） */
  meteorTimer: number
  /** UI 提示：目前手牌+場上可組成的配方名稱 */
  hints: string[]
  /**
   * 棋盤上「現在就有動作可做」的字牌，供 render 在對應格子上畫提示光暈。
   * upgrade＝有可疊合的同字同階夥伴（手牌或場上另一枚）；combine＝是某個可湊配方的成員。
   */
  hintCells: HintCell[]
}

/** 場上字牌的提示標記（見 GameState.hintCells） */
export interface HintCell {
  cell: number
  kind: 'upgrade' | 'combine'
}
