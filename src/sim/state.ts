/**
 * GameState 的建立與衍生值重算。
 * 這裡是「單一狀態樹」的定義處；所有變更都走 sim/actions.ts。
 *
 * ⚠ 字牌與武將**同時存在**（武將是疊在字牌上的一層），格子會重疊。
 *   取用單位請用 glyphAt() / formsAt()，不要假設一格只有一個 unit。
 */
import { mulberry32 } from '../core/rng'
import { GENERAL_BY_NAME } from '../data/generals'
import { GLYPH_BY_CHAR, MAX_GLYPH_LEVEL, glyphDef, levelMul } from '../data/glyphs'
import { LEVELS } from '../data/levels'
import { parseMap } from './board'
import { computeBonds } from './bonds'
import { effectiveRange, troopFromTags, unitCenter } from './combat'
import { possibleRecipes } from './combine'
import { generateMap } from './mapgen'
import { buildGlyphPool } from './pool'
import { perksFrom } from '../data/shop'
import { SKILLS } from './skills'
import { PREP_SECONDS } from './waves'
import type { Aura, FxKind, GameState, GeneralDef, GlyphDef, OnHit, Unit } from './types'

/**
 * 跨局累計統計，成就的「征途」類用它當計數器。
 * 只在一局**真正結束**（勝或敗）時累加一次，中途離開回選單的那一局不計入——
 * 否則同一局會在每次回選單時被重複累加。定義放在這裡（而不是 data/achievements.ts）
 * 是為了讓 data → sim 維持單向：資料表只從 sim 取型別，不反過來。
 */
export interface RunTotals {
  /** 打完的局數 */
  runs: number
  /** 通關的局數 */
  wins: number
  /** 累計擊殺 */
  kills: number
  /** 累計抵達波次（各局相加） */
  waves: number
}

export const EMPTY_TOTALS: RunTotals = { runs: 0, wins: 0, kills: 0, waves: 0 }

/**
 * 局外進度（設計決定 #4：手牌可由兵書擴充至 8）。
 * cleared、seenGlyphs、seenGenerals、best、achievements、totals 是關卡／圖鑑／成就進度，
 * 由 app 層維護，sim 不讀。
 */
export interface MetaProgress {
  handSize: number
  extraFood: number
  extraLives: number
  /** 心願格數（局外養成可提升） */
  wishSlots: number
  /** 聲望：局外養成貨幣，每局結束依成績結算 */
  renown: number
  /** 已通關的關卡 key */
  cleared: string[]
  /** 圖鑑：見過的字 */
  seenGlyphs: string[]
  /** 圖鑑：組出過的武將 */
  seenGenerals: string[]
  /** 圖鑑：遭遇過的敵人 key（見 data/enemies.ts） */
  seenEnemies: string[]
  /** 每關的最佳波數 */
  best: Record<string, number>
  /**
   * 無盡模式的最佳波數（**鍵是原關 key**，不是 `endless_` 開頭的那個）。
   *
   * 刻意不跟 `best` 共用一份：無盡走的是 40 波參考弧（見 data/levels 的無盡節），
   * 比 12～32 波的關卡平緩得多。混進 `best` 會讓選關畫面的「最佳 N 波」變成
   * 兩把不同的尺，也會讓「撐到第 30 波」這種成就被無盡輕鬆帶過。
   */
  endless: Record<string, number>
  /** 每日挑戰成績：dateKey('YYYY-MM-DD') → 抵達波次。見 data/daily.ts */
  daily: Record<string, number>
  /** 商城已購買的道具等級（key → 目前等級，0 或不存在＝未購買，見 data/shop.ts） */
  items: Record<string, number>
  /**
   * 編隊：啟用後，字池只會出現 loadoutGlyphs／loadoutGenerals 指定的內容，
   * 加上所有「還沒解鎖過」的字（不受編隊限制，繼續留在池內讓玩家探索）。
   * 已解鎖但沒被選進編隊的字／武將會被排除。見 data/loadout.ts、sim/pool.ts。
   */
  loadoutActive: boolean
  /** 編隊選的字（最多 MAX_LOADOUT_GLYPHS 個，須是 seenGlyphs 裡「非姓名」的字） */
  loadoutGlyphs: string[]
  /**
   * 編隊選的武將（最多 MAX_LOADOUT_GENERALS 個）。
   * 解鎖判定比 seenGenerals 寬：配方字都在 seenGlyphs 裡也算解鎖，
   * 見 data/loadout.ts 的 isGeneralUnlocked()。
   */
  loadoutGenerals: string[]
  /**
   * 成就：key → 解鎖序號（1 起算，0 或不存在＝未解鎖）。
   * 存序號而不是時間戳，是為了讓 data/achievements.ts 維持純函式（不碰 Date）。
   */
  achievements: Record<string, number>
  /** 跨局累計統計（成就用）。只在一局真正結束時累加，見 app.ts 的 syncProgress */
  totals: RunTotals
}

export const DEFAULT_META: MetaProgress = {
  handSize: 5,
  extraFood: 0,
  extraLives: 0,
  wishSlots: 1,
  renown: 0,
  cleared: [],
  seenGlyphs: [],
  seenGenerals: [],
  seenEnemies: [],
  best: {},
  endless: {},
  daily: {},
  items: {},
  loadoutActive: false,
  loadoutGlyphs: [],
  loadoutGenerals: [],
  achievements: {},
  totals: { ...EMPTY_TOTALS },
}
export const MAX_HAND_SIZE = 8
export const MAX_WISH_SLOTS = 3
export const MAX_LOADOUT_GLYPHS = 8
/**
 * 5 = BONDS 裡最大的 requireGenerals 數量（五虎上將），編隊上限跟著看齊，
 * 才能讓玩家一次把某個羈絆需要的全部武將都排進編隊。
 *
 * ⚠ 新增羈絆時的硬約束：**任何靠姓名配方武將達成的門檻都不能超過這個數字**。
 * 姓名字無法選進 loadoutGlyphs（見 data/loadout.ts 的 isLoadoutableGlyph），
 * 只能透過 loadoutGenerals 帶入，所以 requireGenerals.length 或
 * requireTag.count 一旦大於 5，該羈絆在啟用編隊時就永遠湊不齊。
 * 例外：tag 掛在「部隊」武將上的羈絆（如虎狼之師）不受限——
 * 部隊的配方是兵器／兵種字，可以直接選進 loadoutGlyphs。
 */
export const MAX_LOADOUT_GENERALS = 5

/** 每局結束獲得的聲望：波次是主要來源，擊殺是零頭 */
export function renownFor(wave: number, kills: number, won: boolean): number {
  return Math.max(1, Math.round(wave * 1.5 + kills * 0.05) + (won ? 20 : 0))
}

export function createGame(levelKey = 'julu', seed = 20260727, meta: MetaProgress = DEFAULT_META): GameState {
  const level = LEVELS[levelKey]
  if (!level) throw new Error(`未知關卡：${levelKey}`)

  // 地圖與字池都吃同一顆種子 → 同種子必然得到同一場對局，方便重現 bug
  const rng = mulberry32(seed)
  const map = level.map ?? generateMap(rng, level.gen!)
  const board = parseMap(map, level.key)
  const loadout = meta.loadoutActive
    ? { glyphs: meta.loadoutGlyphs, generals: meta.loadoutGenerals, seenGlyphs: meta.seenGlyphs }
    : undefined
  const pool = buildGlyphPool(rng, level, loadout)
  const handSize = Math.min(meta.handSize, MAX_HAND_SIZE)
  const perks = perksFrom(meta.items)

  return {
    levelKey: level.key,
    levelName: level.name,
    hpMul: level.hpMul,
    bias: level.bias ?? [],
    mods: level.mods ?? {},
    board,
    rng,
    pool: pool.chars,
    poolGenerals: pool.generals,
    wishes: [],
    wishSlots: meta.wishSlots,
    events: [],
    units: [],
    enemies: [],
    effects: [],
    hand: new Array(handSize).fill(null),
    handSize,
    food: level.startFood + meta.extraFood,
    lives: level.lives + meta.extraLives + perks.extraLives,
    maxLives: level.lives + meta.extraLives + perks.extraLives,
    wave: 1,
    maxWave: level.maxWave,
    arc: level.arc,
    phase: 'prep',
    prepTimer: PREP_SECONDS,
    spawnQueue: [],
    waveTime: 0,
    recruitsThisWave: 0,
    frenzy: 0,
    stallT: 0,
    stallMark: 0,
    stallKills: 0,
    // 低水位以 Infinity 起算，第一幀就會被場上總血量取代（見 sim/step.ts 的 stepFrenzy）
    stallHp: Infinity,
    smeltFreeLeft: 3,
    lastIncome: { base: 0, units: 0 },
    activeBonds: [],
    bondCds: {},
    cdMul: 1,
    nextUnitId: 1,
    nextEnemyId: 1,
    time: 0,
    stats: { kills: 0, foodEarned: 0, leaks: 0 },
    perks,
    meteorTimer: perks.meteorInterval,
    hints: [],
    hintCells: [],
  }
}

// ── 查詢 ──────────────────────────────────────────────
/** 該格的字牌（一格最多一個） */
export function glyphAt(state: GameState, cell: number): Unit | undefined {
  return state.units.find((u) => u.kind === 'glyph' && u.cells[0] === cell)
}

/** 覆蓋該格的武將（0 個以上；⚠ 上限不是 2，見 types.ts 的 `Unit.formIds`） */
export function formsAt(state: GameState, cell: number): Unit[] {
  return state.units.filter((u) => u.kind === 'general' && u.cells.includes(cell))
}

export function unitById(state: GameState, id: number): Unit | undefined {
  return state.units.find((u) => u.id === id)
}

export function glyphsOf(state: GameState, form: Unit): Unit[] {
  const out: Unit[] = []
  for (const id of form.memberIds) {
    const g = state.units.find((u) => u.id === id)
    if (g) out.push(g)
  }
  return out
}

// ── 建立 ──────────────────────────────────────────────
export function makeGlyphUnit(state: GameState, char: string, level: number, cell: number): Unit {
  const def = glyphDef(char)
  const m = levelMul(level)
  return {
    id: state.nextUnitId++,
    kind: 'glyph',
    chars: [char],
    defKey: char,
    cells: [cell],
    level,
    formIds: [],
    memberIds: [],
    tier: 'common',
    tags: def.tags,
    baseAtk: def.atk * m,
    baseAps: def.aps,
    baseRange: def.range,
    shape: def.shape,
    atk: def.atk * m,
    aps: def.aps,
    range: def.range,
    cd: 0,
    targeting: 'front',
    troop: troopFromTags(def.tags),
    onHit: def.onHit,
    aura: scaleAura(def.aura, m),
    // 經濟產出用「線性 × 階級」而非指數倍率，否則五階「商」會直接破壞經濟曲線
    income: (def.income ?? 0) * level,
    fx: def.fx ?? deriveGlyphFx(def),
    skillCd: 0,
    skillCdMax: 0,
    skillFlash: 0,
    atkFlash: 0,
  }
}

/** 光環強度也隨品質階級成長（1.25 倍在三階變成約 1.4 倍） */
function scaleAura(aura: Aura | undefined, m: number): Aura | undefined {
  if (!aura) return undefined
  const grow = (v: number | undefined) => (v === undefined ? undefined : 1 + (v - 1) * Math.min(m, 3))
  return { radius: aura.radius, atkMul: grow(aura.atkMul), apsMul: grow(aura.apsMul) }
}

/** 沒指定 fx 的字（姓氏、名字）依攻擊型態給一個合理的預設 */
function deriveGlyphFx(def: GlyphDef): FxKind {
  if (def.atk <= 0) return 'none'
  if (def.tags.includes('弓')) return 'arrow'
  if (def.tags.includes('騎')) return 'charge'
  if (def.shape === 'pierce') return 'thrust'
  return 'blade'
}

/** 特效辨識度優先序：越前面的越有個性，武將繼承時優先採用 */
const FX_PRIORITY: FxKind[] = ['fire', 'bolt', 'venom', 'gale', 'plan', 'arrow', 'thrust', 'blade', 'charge', 'none']

/**
 * 武將繼承組成字牌的攻擊特效。
 * ⚠ 只看字表上「明確寫出」的 fx，不看 deriveGlyphFx() 推導出來的預設值——
 * 否則姓氏／名字字的填充值 'blade' 會蓋掉武將自己更貼切的推導（例如黃忠應該是 arrow）。
 */
function inheritFx(parts: Unit[]): FxKind | undefined {
  let best: FxKind | undefined
  for (const p of parts) {
    const declared = GLYPH_BY_CHAR[p.chars[0]]?.fx
    if (!declared || declared === 'none') continue
    if (best === undefined || FX_PRIORITY.indexOf(declared) < FX_PRIORITY.indexOf(best)) best = declared
  }
  return best
}

/** 取各欄位最強者合併——武將未自訂 onHit 時，繼承組成字牌的控場效果 */
function mergeOnHit(parts: Unit[]): OnHit | undefined {
  const out: OnHit = {}
  let any = false
  for (const p of parts) {
    const o = p.onHit
    if (!o) continue
    any = true
    if (o.slowDur) out.slowDur = Math.max(out.slowDur ?? 0, o.slowDur)
    if (o.stunDur) out.stunDur = Math.max(out.stunDur ?? 0, o.stunDur)
    if (o.vulnDur) out.vulnDur = Math.max(out.vulnDur ?? 0, o.vulnDur)
    if (o.knock) out.knock = Math.max(out.knock ?? 0, o.knock)
    if (o.chain) out.chain = Math.max(out.chain ?? 0, o.chain)
    if (o.burn) {
      out.burn = {
        mul: Math.max(out.burn?.mul ?? 0, o.burn.mul),
        dur: Math.max(out.burn?.dur ?? 0, o.burn.dur),
      }
    }
  }
  return any ? out : undefined
}

/**
 * 由組成字牌建立武將。字牌不會消失，武將只是記住它們的 id。
 * 屬性一律由 recomputeForm() 從成員字牌現算，所以事後把字疊高，武將會立刻變強。
 */
export function makeGeneralUnit(state: GameState, def: GeneralDef, parts: Unit[]): Unit {
  const form: Unit = {
    id: state.nextUnitId++,
    kind: 'general',
    chars: [...def.recipe],
    defKey: def.name,
    cells: parts.map((p) => p.cells[0]),
    level: 0,
    formIds: [],
    memberIds: parts.map((p) => p.id),
    tier: def.tier,
    tags: def.tags,
    baseAtk: 0,
    baseAps: 0,
    baseRange: def.range,
    shape: def.shape,
    atk: 0,
    aps: 0,
    range: def.range,
    cd: 0,
    targeting: 'front',
    troop: troopFromTags(def.tags),
    onHit: def.onHit ?? mergeOnHit(parts),
    aura: def.aura ?? parts.find((p) => p.aura)?.aura,
    income: 0,
    fx: def.fx ?? inheritFx(parts) ?? deriveGeneralFx(def),
    skillCd: def.skill ? def.skill.cd : 0,
    skillCdMax: def.skill && SKILLS[def.name] ? def.skill.cd : 0,
    skillFlash: 0,
    atkFlash: 0,
  }
  for (const p of parts) p.formIds.push(form.id)
  recomputeForm(state, form)
  return form
}

function deriveGeneralFx(def: GeneralDef): FxKind {
  if (def.tags.includes('弓')) return 'arrow'
  if (def.tags.includes('謀略')) return 'plan'
  if (def.tags.includes('騎')) return 'charge'
  if (def.shape === 'pierce') return 'thrust'
  return 'blade'
}

/**
 * 從成員字牌重算武將的基礎屬性。
 * 等級＝成員階級之和（三階張＋二階飛 = 5 級張飛），
 * 攻擊＝Σ成員攻擊 × 階級倍率，所以「先組將再疊字」和「先疊字再組將」結果一致。
 */
export function recomputeForm(state: GameState, form: Unit): void {
  const def = GENERAL_BY_NAME[form.defKey]
  if (!def) return
  const parts = glyphsOf(state, form)
  if (!parts.length) return

  let atkSum = 0
  let apsSum = 0
  let lvSum = 0
  for (const p of parts) {
    atkSum += p.baseAtk
    apsSum += p.baseAps
    lvSum += p.level
  }
  form.level = lvSum
  form.baseAtk = atkSum * def.atkMul
  form.baseAps = (apsSum / parts.length) * def.apsMul
  form.baseRange = def.range
  form.onHit = def.onHit ?? mergeOnHit(parts)
  form.aura = def.aura ?? parts.find((p) => p.aura)?.aura
  // 產糧同樣繼承品質：屯田用二階字組出來就是兩倍
  const avgLevel = lvSum / parts.length
  form.income =
    def.income !== undefined
      ? Math.round(def.income * avgLevel)
      : parts.reduce((s, p) => s + (GLYPH_BY_CHAR[p.chars[0]]?.income ?? 0) * p.level, 0)
}

/**
 * 重算武將屬性、羈絆、光環、技能冷卻上限與提示。
 * 任何單位／手牌變動後都要呼叫（不在每 tick 呼叫）。
 */
export function recalcUnits(state: GameState): void {
  // 1. 先從成員字牌重算武將（字牌可能剛剛升階）
  for (const u of state.units) {
    if (u.kind === 'general') recomputeForm(state, u)
  }

  // 2. 羈絆
  const bonds = computeBonds(state.units, state.bondCds, state.perks.cdMul)
  state.activeBonds = bonds.active
  // 兵法傳承：局外道具再疊一層冷卻倍率，跟羈絆的 cdMul 相乘
  state.cdMul = bonds.cdMul * state.perks.cdMul

  for (const u of state.units) {
    // 羈絆倍率之外，再乘上局外道具（號令旗／疾風令）的全場加成
    u.atk = u.baseAtk * bonds.atkMul * state.perks.atkMul
    u.aps = u.baseAps * bonds.apsMul * state.perks.apsMul
    // 精工兵器（道具）× 戰場特性（濃霧）：都疊在全域射程倍率（RANGE_MUL）之上
    u.range = effectiveRange(state.board, u) * state.perks.rangeMul * (state.mods.rangeMul ?? 1)
  }

  // 3. 光環：套在羈絆之後，兩者相乘。
  //    已成為武將成員的字牌不再單獨投射光環，否則會與武將繼承的光環重複計算。
  const sources = state.units.filter((u) => u.aura && !(u.kind === 'glyph' && u.formIds.length > 0))
  if (sources.length) {
    for (const target of state.units) {
      const tc = unitCenter(state.board, target)
      for (const src of sources) {
        if (src === target) continue
        const sc = unitCenter(state.board, src)
        if (Math.hypot(tc.x - sc.x, tc.y - sc.y) > src.aura!.radius) continue
        target.atk *= src.aura!.atkMul ?? 1
        target.aps *= src.aura!.apsMul ?? 1
      }
    }
  }

  // 4. 技能冷卻上限受羈絆與兵法傳承的 cdMul 影響（state.cdMul 已經是兩者相乘後的值）
  for (const u of state.units) {
    const def = u.kind === 'general' ? GENERAL_BY_NAME[u.defKey] : undefined
    const hasImpl = def?.skill && SKILLS[u.defKey]
    u.skillCdMax = hasImpl ? def!.skill!.cd * state.cdMul : 0
    if (u.skillCd > u.skillCdMax) u.skillCd = u.skillCdMax
  }

  const handCards = state.hand.filter((h) => h !== null) as { char: string; level: number }[]
  const handChars = handCards.map((h) => h.char)
  state.hints = possibleRecipes(state.units, handChars)
  state.hintCells = computeHintCells(state, handCards)
}

/**
 * 標記棋盤上「現在就有動作可做」的字牌，讓玩家在單位很多時一眼看出哪些能疊合／能湊將。
 * 純衍生值，不影響機制；判定寬鬆（升級只看有無同字同階夥伴，組詞沿用 possibleRecipes 的名單）。
 */
function computeHintCells(state: GameState, handCards: { char: string; level: number }[]): { cell: number; kind: 'upgrade' | 'combine' }[] {
  const glyphs = state.units.filter((u) => u.kind === 'glyph')

  // 升級：同字同階（且未滿階）的夥伴數，手牌與場上都算
  const stackCount = new Map<string, number>()
  const bump = (char: string, level: number) => {
    const key = `${char}:${level}`
    stackCount.set(key, (stackCount.get(key) ?? 0) + 1)
  }
  for (const h of handCards) bump(h.char, h.level)
  for (const g of glyphs) bump(g.chars[0], g.level)

  // 組詞：state.hints 是「用得到手牌就能湊」的配方名，取其配方字集合
  const recipeChars = new Set<string>()
  for (const name of state.hints) {
    const def = GENERAL_BY_NAME[name]
    if (def) for (const ch of def.recipe) recipeChars.add(ch)
  }

  const out: { cell: number; kind: 'upgrade' | 'combine' }[] = []
  for (const g of glyphs) {
    const canUpgrade =
      g.level < MAX_GLYPH_LEVEL && (stackCount.get(`${g.chars[0]}:${g.level}`) ?? 0) >= 2
    if (canUpgrade) {
      out.push({ cell: g.cells[0], kind: 'upgrade' })
    } else if (recipeChars.has(g.chars[0])) {
      out.push({ cell: g.cells[0], kind: 'combine' })
    }
  }
  return out
}

export function generalDefOf(u: Unit): GeneralDef | undefined {
  return u.kind === 'general' ? GENERAL_BY_NAME[u.defKey] : undefined
}
