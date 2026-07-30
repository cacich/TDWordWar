/**
 * AI 代管 —— 會實際遊玩並通關的自動操作策略。
 *
 * ⚠ 與 `tools/dumb-ai.ts` 的關係：**兩者刻意分開，不可合併。**
 * 傻 AI 是本專案的難度量尺（`npm run sim` 的所有基準都建立在它身上），
 * 必須永遠停在「一般玩家的直覺」；這一份則是「會下棋」的那個，允許隨時變強。
 * 把量尺換成強 AI 會讓九關的平衡基準一夜失效。強 AI 的成績量表在 `npm run ai`。
 *
 * ★ 核心想法：把所有可能的操作換算成**同一個單位**——
 *     「一隻敵人走完全程會吃到的傷害」≈ dps × 路徑覆蓋格數
 *   然後貪婪地做增益最大的那一個。有了共同單位，「放這張字」「疊高那個字」
 *   「搬到更好的格子」「鏟掉弱的換強的」「先湊將」就能直接互比，
 *   不必寫一堆互相打架的 if 優先序（傻 AI 就是那樣，所以它只會照直覺走）。
 *
 * ★ 湊將靠「窗格（Win）」機制：列舉棋盤上所有「連續 n 格、方向正確、已有的字都對得上
 *   配方」的線段，把「完成後的淨增益」按完成度折算成每一格的落點加分。於是 AI 會自然
 *   把字往同一條線上堆、最後一格補上就成將——不需要另外維護一套「保留位置」的狀態機。
 *
 * 這個檔在 sim 層（純邏輯、不碰 DOM），所以遊戲內的「AI 代管」開關與 `npm run ai`
 * 跑的是**同一份程式碼**：工具量到的通關率就是玩家開開關會得到的表現。
 */
import { BONDS } from '../data/bonds'
import { GENERALS } from '../data/generals'
import { GLYPH_BY_CHAR, MAX_GLYPH_LEVEL, levelMul } from '../data/glyphs'
import {
  mergeHand,
  moveGlyph,
  placeFromHand,
  recruit,
  rerollHand,
  sellGlyph,
  toggleWish,
} from './actions'
import { ANTI_AIR_RANGE } from '../data/enemies'
import { cellCenter, cellIndex, isPlot } from './board'
import { GENERAL_RANGE_BONUS, GLYPH_RANGE_MUL, RANGE_MUL, unitCenter } from './combat'
import { recruitCost, rerollCost } from './economy'
import type { AttackShape, Aura, Board, GameState, GeneralDef, OnHit, Unit } from './types'

// ── 旋鈕 ──────────────────────────────────────────────
/**
 * 三個最影響風格的估值旋鈕，集中成一個可調物件（`npm run ai` 是它的量表）。
 * 現值是掃過主線九關後、讓**整體平均深度最高**的一組——並非通關（見下）。
 *
 *   SAT   飽和覆蓋的半衰點。越大越傾向「鋪滿整條路」，越小越傾向「少而精、疊高」。
 *   STACK 疊高（升階）的估值放大係數。線性 dps 模型看不見高階單位的複利
 *         （羈絆／光環／tier 倍率相乘、爆掉高血 BOSS），所以要人工放大它。
 *   FOOD  「每波 1 點產糧」值多少傷害——經濟字沒有輸出，靠這個匯率才能跟攻擊字比較。
 *
 * ⚠ 誠實說明：這支 AI 打得比難度量尺（`tools/dumb-ai.ts`，設計上死在總波數一半）深得多，
 * 但**不保證通關**。本作的難度弧是指數成長，末段需要人類級的長線規劃（深度養成單一主力
 * ＋羈絆＋光環爆發打 BOSS），逐拍貪婪的策略掃過所有合理旋鈕都跨不過那道牆
 * （實測連最簡單的黃巾都停在第 8 波／共 12 波）。要再往上得換成有前瞻的規劃器，
 * 那是另一個量級的工程。調這裡只會改變「在哪一關撐得比較深」，不會變出通關。
 */
export const TUNE = { SAT: 350, STACK: 2.2, FOOD: 22 }

/**
 * 決策間隔（模擬秒）。它吃的是模擬時間，所以 3× 速時思考也跟著變快。
 *
 * ⚠ 這是**手機發熱的主旋鈕**。一輪決策要重掃棋盤、列舉所有窗格、對每個窗格做
 * 覆蓋積分，成本遠高於一幀模擬；曾經是 0.35 秒一輪（≈ 2.9 輪/秒），實測會讓手機燙手。
 * 現值 1.2 秒一輪：12 秒的佈陣期還有 10 輪，而**一輪不再有動作數上限**（見 runActions），
 * 所以「少想幾次」不等於「少做幾件事」——該擺的陣還是會在同一輪裡擺完。
 * 想再省電就往上加；往下調之前先想清楚為什麼「一輪做完」不夠。
 */
const THINK_INTERVAL = 1.2
/** 增益低於這個值就不值得動手（單位同上：一趟路的傷害量） */
const MIN_GAIN = 1

/**
 * 佔位成本：好格子（覆蓋路徑多）是稀缺資源，任何單位站上去都要付這個代價。
 * 它的唯一作用是把經濟字與光環字趕到邊緣，把靠路的格子留給會打的單位——
 * 少了它，AI 會把糧倉蓋在最好的射擊位上。
 */
const OCCUPY_COST = 7
const OCCUPY_RADIUS = 3

/** 搬動的門檻倍率：新位置要比原位置好這麼多才值得搬，否則 AI 會在兩格之間來回擺盪 */
const MOVE_MARGIN = 1.3
/** 鏟掉舊字換新字的門檻倍率。比搬動高，因為鏟除會退款打折、還可能解除武將 */
const REPLACE_MARGIN = 1.45
/** 每次只考慮最弱的幾個字牌當鏟除對象，避免掃全場 */
const REPLACE_CANDIDATES = 6

/**
 * 有飛行威脅時，打不到空中的單位（`baseRange < ANTI_AIR_RANGE`）估值打的折扣。
 * 少了它，AI 只會鋪近戰塔，飛賊直接穿過去——在只有 2 條命的洛陽第一波就會被秒。
 * 弓／弩是骨幹字（永遠在池內、射程足以對空），所以折扣一下，AI 就會自己去湊對空火力。
 */
const NO_AIR_PENALTY = 0.5

/** 同一個武將已經有 n 個時，第 n+1 個的估值乘上這個數的 n 次方（邊際效用遞減） */
const DUP_DECAY = 0.7

// ── 對外介面 ──────────────────────────────────────────
/**
 * AI 的記憶。刻意**放在 GameState 之外**：它全是可重算的快取，
 * 不該進局內存檔（`sim/persist.ts`），也不該影響同種子的重現性。
 */
export interface AutoBrain {
  /** 距離下一次決策的剩餘秒數 */
  cooldown: number
  geom: Geom | null
  /** 本局可湊的配方（吃 state.pool，換局才重算） */
  defs: GeneralDef[]
  poolRef: readonly string[] | null
}

export function createBrain(): AutoBrain {
  return { cooldown: 0, geom: null, defs: [], poolRef: null }
}

/**
 * 由呼叫端每個模擬步呼叫（app 層的 loop 與 `npm run ai` 都走這裡）。
 * 節流後才真正思考——決策成本遠高於一幀模擬。
 */
export function stepAuto(brain: AutoBrain, state: GameState, dt: number): void {
  if (state.phase === 'won' || state.phase === 'lost') return
  brain.cooldown -= dt
  if (brain.cooldown > 0) return
  brain.cooldown = THINK_INTERVAL
  autoThink(brain, state)
}

/**
 * 一輪完整決策。回傳實際執行的動作數（0 表示這一輪無事可做）。
 *
 * 順序上刻意先征兵再放置：一次征兵會填滿整個手牌，先把牌拿齊再一起評分，
 * 才有機會看見「這兩張剛好能湊成將」這種只有整手一起看才成立的落點。
 */
export function autoThink(brain: AutoBrain, state: GameState): number {
  if (state.phase === 'won' || state.phase === 'lost') return 0
  // 早退閘門：沒牌又沒糧時什麼都做不了。戰鬥中大部分時間都落在這裡，
  // 少了它，整局會有九成的思考成本花在「確認自己無事可做」上。
  if (!state.hand.some((h) => h !== null) && state.food < recruitCost(state)) return 0

  const geom = geomOf(brain, state.board)
  let acted = 0

  // 有飛行威脅卻沒對空時，先許願再征兵——否則第一次征兵抽到的都是沒許願的字，
  // 糧一花光就再也抽不到弓弩，整場都對空真空（洛陽只有 2 命，飛賊漏一隻就近乎輸）。
  ensureAntiAirWish(state)
  acted += mergeHandPairs(state, boardGlyphKeys(state))
  acted += recruitIfWorth(state)
  acted += mergeHandPairs(state, boardGlyphKeys(state))
  const run = runActions(brain, state, geom)
  acted += run.acted

  // 沿用 runActions 最後建的那份 ctx（它是在「已經沒有值得做的事」時建的，所以與現況一致）。
  // buildCtx 會列舉全部窗格，是整輪最貴的一步，能省一次就省一次。
  syncWishes(brain, state, geom, run.fresh)
  if (acted === 0) acted += idleTurn(state)
  return acted
}

/**
 * 反覆挑「增益最大的單一動作」直到沒有值得做的事，回傳執行的動作數。
 *
 * **刻意沒有動作數上限**：想的次數少（THINK_INTERVAL 拉長省電）就得讓每一輪把該做的事做完，
 * 否則手上有六張牌卻一輪只擺得下幾張，剩下的要等下一輪——擺陣會比敵人來得慢。
 * 一輪的實際上界由資源本身決定：place/stack/replace 各吃掉一張手牌，補牌要花糧且征兵費會漲。
 *
 * 沒有上限就得自己保證「每一輪一定會停」，靠兩道閘：
 *   1. `apply()` 回報動作是否真的生效——沒生效就跳出，否則會永遠重選同一個動作
 *   2. 同一枚字一輪只搬一次（`movedIds`）——搬動不消耗任何資源，是唯一可能繞圈的動作
 *
 * @returns `acted` 執行的動作數；`fresh` 最後建的 ctx，**僅在它仍與現況一致時**才回傳
 *   （正常收尾＝沒有值得做的事就跳出，狀態自那時起沒變），給 syncWishes 重用。
 */
function runActions(brain: AutoBrain, state: GameState, geom: Geom): { acted: number; fresh: Ctx | null } {
  let acted = 0
  const movedIds = new Set<number>()
  for (;;) {
    const ctx = buildCtx(brain, state, geom)
    const best = bestAction(state, geom, ctx, movedIds)
    if (!best || best.gain < MIN_GAIN) return { acted, fresh: ctx }
    // 動作被拒絕：狀態可能已經被動過一半（replace 會先賣再放），這份 ctx 不可信
    if (!apply(state, best)) return { acted, fresh: null }
    if (best.kind === 'move') movedIds.add(best.id)
    acted++
    acted += recruitIfWorth(state) // 手牌空出格子後可能又買得起，順手補征
  }
}

// ── 棋盤幾何：路徑覆蓋 ────────────────────────────────
/**
 * 每格到路徑各點的距離（已排序）。**這是整個估值函式的地基**：
 * 路徑上的相鄰點間距固定 1 格、敵人等速前進，所以「射程內的路徑點個數」
 * 正比於「一隻敵人待在射程內的時間」，也就正比於它會吃到的總傷害。
 * 同一局內棋盤不變，所以只算一次。
 */
interface Geom {
  board: Board
  /** 路徑點的中心座標 */
  pts: { x: number; y: number }[]
  /** 索引 = cell，值 = 到各路徑點的距離（依 pts 順序，未排序，供逐點加權） */
  dists: Float64Array[]
  plots: number[]
}

function geomOf(brain: AutoBrain, board: Board): Geom {
  if (brain.geom && brain.geom.board === board) return brain.geom
  const n = board.cols * board.rows
  const pts = board.path.map((p) => cellCenter(board, p))
  const dists: Float64Array[] = new Array(n)
  const plots: number[] = []
  for (let i = 0; i < n; i++) {
    const c = cellCenter(board, i)
    const arr = new Float64Array(pts.length)
    for (let k = 0; k < pts.length; k++) arr[k] = Math.hypot(pts[k].x - c.x, pts[k].y - c.y)
    dists[i] = arr
    if (isPlot(board, i)) plots.push(i)
  }
  const geom: Geom = { board, pts, dists, plots }
  brain.geom = geom
  return geom
}

/** 射程 r 內的路徑點個數（給佔位成本用；不看飽和） */
function coverage(geom: Geom, cell: number, r: number): number {
  if (r <= 0) return 0
  const a = geom.dists[cell]
  let n = 0
  for (let k = 0; k < a.length; k++) if (a[k] <= r) n++
  return n
}

/**
 * ★ 飽和覆蓋 —— 整個估值函式從「數格子」升級成這個的關鍵。
 *
 * 純數格子（coverage）把每座塔當獨立看待，於是估值 = Σ dps × 覆蓋格數是**線性**的，
 * 第 20 座塔看起來跟第 2 座一樣有價值 → AI 只會不停鋪新的一階塔，把棋盤攤平。
 *
 * 這裡改成：每個路徑點的「這一格已經有多少 dps 打得到」（load）越高，
 * 再往上加 dps 的邊際價值就越低（`SAT/(SAT+load)`）。於是：
 *   - 還沒被涵蓋的路段 → 滿額回報（要先把整條路蓋起來）
 *   - 已經火力充足的路段 → 幾乎沒有回報（別再往那裡疊平價塔）
 * 一旦整條路都飽和，鋪新塔不再划算，多出來的糧就會轉去**疊高**既有單位——
 * 那正是本作「後期戰力指數成長」的設計出口（見 CLAUDE.md 的 HP_GROWTH 註解）。
 *
 * ⚠ `load` 由 ctx.pathLoad 提供（每輪重算）；為 null 時退回線性覆蓋（開局還沒有塔）。
 */

function satCoverage(geom: Geom, cell: number, r: number, load: Float64Array | null): number {
  if (r <= 0) return 0
  const a = geom.dists[cell]
  let sum = 0
  for (let k = 0; k < a.length; k++) {
    if (a[k] > r) continue
    sum += load ? TUNE.SAT / (TUNE.SAT + load[k]) : 1
  }
  return sum
}

/** 多格單位取「最靠路徑的那一格」量起——`effectiveRange` 已把中心外移補回射程 */
function bestSatCoverage(geom: Geom, cells: readonly number[], r: number, load: Float64Array | null): number {
  let best = 0
  for (const c of cells) best = Math.max(best, satCoverage(geom, c, r, load))
  return best
}

// ── 估值 ──────────────────────────────────────────────
/**
 * 攻擊型態與控場的加權。全部是啟發式權重，不是模擬結果：
 * 貫穿／濺射一次打多隻，控場則透過拖時間或提高他人輸出間接貢獻傷害。
 */
function utilityMul(shape: AttackShape, onHit?: OnHit): number {
  let m = shape === 'pierce' ? 1.7 : shape === 'splash' ? 1.8 : 1
  if (!onHit) return m
  if (onHit.burn) m *= 1 + Math.min(1.2, onHit.burn.mul * onHit.burn.dur * 0.3)
  if (onHit.chain) m *= 1 + 0.35 * onHit.chain
  if (onHit.stunDur) m *= 1.2
  if (onHit.slowDur) m *= 1.15
  if (onHit.vulnDur) m *= 1.15
  if (onHit.knock) m *= 1.1
  return m
}

function glyphRangeOf(state: GameState, baseRange: number): number {
  return baseRange * RANGE_MUL * GLYPH_RANGE_MUL * state.perks.rangeMul
}

function generalRangeOf(state: GameState, baseRange: number): number {
  return baseRange * RANGE_MUL * GENERAL_RANGE_BONUS * state.perks.rangeMul
}

/** 光環強度隨品質成長，與 `sim/state.ts` 的 scaleAura() 同一條公式 */
function auraStrength(aura: Aura, m: number): number {
  const grow = (v: number | undefined) => (v === undefined ? 1 : 1 + (v - 1) * Math.min(m, 3))
  return grow(aura.atkMul) * grow(aura.apsMul) - 1
}

/** 光環放在這一格能替多少既有輸出加成 */
function auraValue(ctx: Ctx, geom: Geom, cell: number, aura: Aura, m: number): number {
  const mul = auraStrength(aura, m)
  if (mul <= 0) return 0
  const c = cellCenter(geom.board, cell)
  let sum = 0
  for (const a of ctx.attackers) {
    if (Math.hypot(a.x - c.x, a.y - c.y) > aura.radius) continue
    sum += a.value
  }
  return sum * mul
}

/** 一枚字牌單獨站在某格的價值（含佔位成本，所以可能是負的） */
function glyphSpotValue(
  state: GameState,
  geom: Geom,
  ctx: Ctx,
  char: string,
  level: number,
  cell: number,
): number {
  const def = GLYPH_BY_CHAR[char]
  const m = levelMul(level)
  let v = 0
  if (def.atk > 0 && def.aps > 0) {
    const air = ctx.flyingThreat && def.range < ANTI_AIR_RANGE ? NO_AIR_PENALTY : 1
    v += def.atk * m * def.aps * satCoverage(geom, cell, glyphRangeOf(state, def.range), ctx.pathLoad) *
      utilityMul(def.shape, def.onHit) * air
  }
  if (def.aura) v += auraValue(ctx, geom, cell, def.aura, m)
  if (def.income) v += def.income * level * TUNE.FOOD
  return v - OCCUPY_COST * coverage(geom, cell, OCCUPY_RADIUS)
}

/** 場上單位「現在」的輸出價值（吃飽和覆蓋）。已被武將接手的字牌回傳 0（它不再單獨出手） */
function attackValueOf(geom: Geom, u: Unit, load: Float64Array | null): number {
  if (u.kind === 'glyph' && u.formIds.length > 0) return 0
  if (u.atk <= 0 || u.aps <= 0) return 0
  return u.atk * u.aps * bestSatCoverage(geom, u.cells, u.range, load) * utilityMul(u.shape, u.onHit)
}

/** 這座單位對每個路徑點貢獻的原始 dps（atk×aps），加進 pathLoad。多格取最近的一格 */
function addToLoad(geom: Geom, u: Unit, load: Float64Array): void {
  if (u.kind === 'glyph' && u.formIds.length > 0) return
  const dps = u.atk * u.aps
  if (dps <= 0 || u.range <= 0) return
  for (let k = 0; k < geom.pts.length; k++) {
    let min = Infinity
    for (const c of u.cells) min = Math.min(min, geom.dists[c][k])
    if (min <= u.range) load[k] += dps
  }
}

/** 場上單位的總價值：輸出 + 光環 + 產糧。鏟除決策看的就是這個 */
function liveValue(geom: Geom, ctx: Ctx, u: Unit): number {
  let v = attackValueOf(geom, u, ctx.pathLoad)
  if (u.aura && !(u.kind === 'glyph' && u.formIds.length > 0)) {
    v += auraValue(ctx, geom, u.cells[0], u.aura, levelMul(u.level))
  }
  if (u.income > 0) v += u.income * TUNE.FOOD
  return v - OCCUPY_COST * coverage(geom, u.cells[0], OCCUPY_RADIUS)
}

/**
 * 羈絆加分：能讓某個還沒成立的羈絆更接近達成的武將值得優先湊。
 * 只取最好的那一個羈絆，不累乘——否則同時卡在三個羈絆上的武將會被高估成天神。
 */
function bondMul(ctx: Ctx, def: GeneralDef): number {
  let best = 1
  for (const b of BONDS) {
    if (ctx.activeBonds.has(b.name)) continue
    if (b.requireGenerals) {
      if (!b.requireGenerals.includes(def.name)) continue
      if (ctx.formed.has(def.name)) continue
      const have = b.requireGenerals.filter((n) => ctx.formed.has(n)).length
      best = Math.max(best, have + 1 >= b.requireGenerals.length ? 1.6 : 1.15)
    } else if (b.requireTag) {
      if (!def.tags.includes(b.requireTag.tag)) continue
      const have = ctx.tagCount.get(b.requireTag.tag) ?? 0
      best = Math.max(best, have + 1 >= b.requireTag.count ? 1.6 : 1.1)
    }
  }
  return best
}

// ── 窗格：可以湊成武將的線段 ──────────────────────────
interface Win {
  def: GeneralDef
  /** 依正讀順序的格子 */
  cells: number[]
  /** 每格目前的字牌（undefined = 空格，要補） */
  have: (Unit | undefined)[]
  /** 已就位的格數 */
  filled: number
  /** 完成後的淨增益（已扣掉成員原本各自單打的價值） */
  gain: number
}

/**
 * 完成這個窗格後的估值。屬性算法與 `recomputeForm` 一致
 * （atk = Σ成員 atk × atkMul、aps = 平均 aps × apsMul），空格以一階字估。
 */
function winValue(state: GameState, geom: Geom, ctx: Ctx, def: GeneralDef, cells: number[], have: (Unit | undefined)[]): number {
  let atkSum = 0
  let apsSum = 0
  for (let i = 0; i < cells.length; i++) {
    const d = GLYPH_BY_CHAR[def.recipe[i]]
    const lv = have[i]?.level ?? 1
    atkSum += d.atk * levelMul(lv)
    apsSum += d.aps
  }
  const atk = atkSum * def.atkMul
  const aps = (apsSum / cells.length) * def.apsMul
  const onHit = def.onHit ?? mergedOnHit(def)
  let v = 0
  if (atk > 0 && aps > 0) {
    const air = ctx.flyingThreat && def.range < ANTI_AIR_RANGE ? NO_AIR_PENALTY : 1
    v = atk * aps * bestSatCoverage(geom, cells, generalRangeOf(state, def.range), ctx.pathLoad) *
      utilityMul(def.shape, onHit) * air
  }
  if (def.income) v += def.income * TUNE.FOOD
  const dup = Math.pow(DUP_DECAY, ctx.formed.get(def.name) ?? 0)
  return v * bondMul(ctx, def) * dup
}

/** 武將未自訂 onHit 時會繼承成員的控場效果（見 state.ts 的 mergeOnHit），估值也要跟著算進去 */
function mergedOnHit(def: GeneralDef): OnHit | undefined {
  const out: OnHit = {}
  let any = false
  for (const ch of def.recipe) {
    const o = GLYPH_BY_CHAR[ch]?.onHit
    if (!o) continue
    any = true
    if (o.slowDur) out.slowDur = Math.max(out.slowDur ?? 0, o.slowDur)
    if (o.stunDur) out.stunDur = Math.max(out.stunDur ?? 0, o.stunDur)
    if (o.vulnDur) out.vulnDur = Math.max(out.vulnDur ?? 0, o.vulnDur)
    if (o.knock) out.knock = Math.max(out.knock ?? 0, o.knock)
    if (o.chain) out.chain = Math.max(out.chain ?? 0, o.chain)
    if (o.burn) out.burn = { mul: Math.max(out.burn?.mul ?? 0, o.burn.mul), dur: Math.max(out.burn?.dur ?? 0, o.burn.dur) }
  }
  return any ? out : undefined
}

/**
 * 列舉所有還有機會完成的窗格。
 *
 * 「有機會」= 每一格都是空地、已有的字都對得上配方、缺的字拿得到（手牌或本局字池）。
 * ⚠ 不要求窗格前後沒有其他字牌：`sim/combine.ts` 會掃過所有「包含變動格」的子串，
 * 所以線段更長不影響判定，兩個武將也可以共用字牌。
 */
function enumerateWindows(state: GameState, geom: Geom, ctx: Ctx): Win[] {
  const board = geom.board
  const out: Win[] = []
  for (const def of ctx.defs) {
    const n = def.recipe.length
    for (let vertical = 0; vertical < 2; vertical++) {
      const span = vertical ? board.rows : board.cols
      const other = vertical ? board.cols : board.rows
      if (n > span) continue
      for (let o = 0; o < other; o++) {
        for (let s = 0; s + n <= span; s++) {
          const cells: number[] = []
          const have: (Unit | undefined)[] = []
          let filled = 0
          let ok = true
          for (let i = 0; i < n; i++) {
            const cell = vertical ? cellIndex(board, o, s + i) : cellIndex(board, s + i, o)
            if (!isPlot(board, cell)) {
              ok = false
              break
            }
            const g = ctx.glyphByCell.get(cell)
            if (g) {
              if (g.chars[0] !== def.recipe[i]) {
                ok = false
                break
              }
              filled++
            } else if (!ctx.obtainable.has(def.recipe[i])) {
              ok = false
              break
            }
            cells.push(cell)
            have.push(g)
          }
          if (!ok || filled === n) continue // 全滿表示已經成將（或正被別的武將占用）
          const value = winValue(state, geom, ctx, def, cells, have)
          let standalone = 0
          for (const g of have) if (g) standalone += attackValueOf(geom, g, ctx.pathLoad)
          const gain = value - standalone
          if (gain < MIN_GAIN) continue
          out.push({ def, cells, have, filled, gain })
        }
      }
    }
  }
  return out
}

/**
 * 把窗格折算成「在這一格放這個字」的加分（`cell → 字 → 加分`）。
 * 完成度以平方折算：只差最後一格時給滿分（那就是真的會成將），
 * 半途則只給一小部分，免得 AI 為了遙遠的配方把好格子全部占住。
 *
 * `completeOnly` 版只收「差最後一格」的窗格，給**搬動**用。
 * ⚠ 這個區分是必要的：半完成窗格的加分是一個「跟著空格跑」的位置吸子——
 * 搬走一枚字會讓它原本的格子重新變成空缺、加分又冒出來，於是一枚孤字會在
 * 兩個窗格槽之間無限來回搬動。只認「這一步就成將」的窗格才不會震盪：成將後窗格消失。
 */
function slotBonusMap(wins: Win[], completeOnly = false): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>()
  for (const w of wins) {
    const n = w.cells.length
    if (completeOnly && w.filled + 1 !== n) continue
    const weight = w.filled + 1 === n ? 1 : Math.pow((w.filled + 1) / n, 2) * 0.6
    const bonus = w.gain * weight
    for (let i = 0; i < n; i++) {
      if (w.have[i]) continue
      const cell = w.cells[i]
      const char = w.def.recipe[i]
      let byChar = out.get(cell)
      if (!byChar) out.set(cell, (byChar = new Map()))
      if ((byChar.get(char) ?? 0) < bonus) byChar.set(char, bonus)
    }
  }
  return out
}

// ── 每輪重建的決策脈絡 ────────────────────────────────
interface Ctx {
  defs: GeneralDef[]
  glyphByCell: Map<number, Unit>
  /** 拿得到的字：手牌上的 + 本局字池 */
  obtainable: Set<string>
  /** 已組成的武將名 → 數量 */
  formed: Map<string, number>
  tagCount: Map<string, number>
  activeBonds: Set<string>
  /** 場上會攻擊的單位（供光環估值） */
  attackers: { x: number; y: number; value: number }[]
  /** 每個路徑點目前承受的總 dps，飽和覆蓋的依據（見 satCoverage） */
  pathLoad: Float64Array
  /** 這一關有沒有飛行威脅（關卡 bias 宣告，或場上已出現飛賊）→ 逼 AI 準備對空 */
  flyingThreat: boolean
  emptyPlots: number[]
  /** 這一輪列舉出的窗格。留著給 syncWishes 重用——列舉是整輪最貴的一步，不要算兩次 */
  wins: Win[]
  /** 放置／疊合／替換用：所有窗格（含半完成，會折價） */
  slot: Map<number, Map<string, number>>
  /** 搬動專用：只認「這一步就成將」的窗格，避免孤字在半完成槽之間來回震盪 */
  complete: Map<number, Map<string, number>>
}

function buildCtx(brain: AutoBrain, state: GameState, geom: Geom): Ctx {
  if (brain.poolRef !== state.pool) {
    brain.poolRef = state.pool
    const inPool = new Set(state.pool)
    brain.defs = GENERALS.filter((d) => d.recipe.every((ch) => inPool.has(ch)))
  }

  const glyphByCell = new Map<number, Unit>()
  const formed = new Map<string, number>()
  const tagCount = new Map<string, number>()
  // 先算 pathLoad（原始 dps），飽和覆蓋才有依據；attacker 的「價值」要等它算完才能算
  const pathLoad = new Float64Array(geom.pts.length)
  for (const u of state.units) {
    if (u.kind === 'glyph') glyphByCell.set(u.cells[0], u)
    else {
      formed.set(u.defKey, (formed.get(u.defKey) ?? 0) + 1)
      for (const t of u.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1)
    }
    addToLoad(geom, u, pathLoad)
  }

  const attackers: { x: number; y: number; value: number }[] = []
  for (const u of state.units) {
    const v = attackValueOf(geom, u, pathLoad)
    if (v > 0) {
      const c = unitCenter(geom.board, u)
      attackers.push({ x: c.x, y: c.y, value: v })
    }
  }

  const obtainable = new Set(state.pool)
  for (const h of state.hand) if (h) obtainable.add(h.char)

  const emptyPlots = geom.plots.filter((c) => !glyphByCell.has(c))

  const ctx: Ctx = {
    defs: brain.defs,
    glyphByCell,
    obtainable,
    formed,
    tagCount,
    activeBonds: new Set(state.activeBonds.map((b) => b.name)),
    attackers,
    pathLoad,
    flyingThreat: state.bias.includes('flying') || state.enemies.some((e) => e.flying && e.hp > 0),
    emptyPlots,
    wins: [],
    slot: new Map(),
    complete: new Map(),
  }
  const wins = enumerateWindows(state, geom, ctx)
  ctx.wins = wins
  ctx.slot = slotBonusMap(wins)
  ctx.complete = slotBonusMap(wins, true)
  return ctx
}

function slotBonus(ctx: Ctx, cell: number, char: string): number {
  return ctx.slot.get(cell)?.get(char) ?? 0
}

/** 搬動時只認「這一步就成將」的加分（見 slotBonusMap 的 completeOnly 說明） */
function moveBonus(ctx: Ctx, cell: number, char: string): number {
  return ctx.complete.get(cell)?.get(char) ?? 0
}

// ── 動作 ──────────────────────────────────────────────
type Action =
  /** 從手牌放到空地 */
  | { kind: 'place'; gain: number; hand: number; cell: number }
  /** 從手牌疊到同字同階的字牌上（升階） */
  | { kind: 'stack'; gain: number; hand: number; cell: number }
  /** 搬動場上的字牌（只搬沒有組成武將的） */
  | { kind: 'move'; gain: number; id: number; cell: number }
  /** 鏟掉最弱的字牌，把手牌換上去 */
  | { kind: 'replace'; gain: number; hand: number; id: number; cell: number }

/**
 * 執行動作，回傳「是否真的生效」。
 * ⚠ 回傳值不是裝飾用的：`runActions` 沒有動作數上限，靠它跳出——
 * 動作若被 `sim/actions.ts` 拒絕（估值端與驗證端對不上），下一圈會選到同一個動作而無限迴圈。
 */
function apply(state: GameState, a: Action): boolean {
  switch (a.kind) {
    case 'place':
    case 'stack':
      return placeFromHand(state, a.hand, a.cell).ok
    case 'move':
      return moveGlyph(state, a.id, a.cell).ok
    case 'replace':
      return sellGlyph(state, a.id).ok && placeFromHand(state, a.hand, a.cell).ok
  }
}

/** 疊高一枚字牌的增益。成員字牌升階會讓它所屬的武將同步變強，那才是主要收益 */
function stackGain(state: GameState, geom: Geom, ctx: Ctx, target: Unit): number {
  const char = target.chars[0]
  const lv = target.level
  if (target.formIds.length === 0) {
    const before = glyphSpotValue(state, geom, ctx, char, lv, target.cells[0])
    const after = glyphSpotValue(state, geom, ctx, char, lv + 1, target.cells[0])
    // 疊高不占新格子，所以佔位成本在兩邊互相抵銷，只剩下純粹的屬性成長
    return (after - before) * TUNE.STACK
  }
  // 武將的 atk 與成員 baseAtk 成正比 → 升一階等於這名成員的 baseAtk 多出 (LEVEL_MUL−1) 倍
  const d = GLYPH_BY_CHAR[char]
  const delta = d.atk * (levelMul(lv + 1) - levelMul(lv))
  let gain = 0
  for (const id of target.formIds) {
    const form = state.units.find((u) => u.id === id)
    if (!form) continue
    let atkSum = 0
    for (const mid of form.memberIds) {
      const m = state.units.find((u) => u.id === mid)
      if (m) atkSum += m.baseAtk
    }
    if (atkSum <= 0) continue
    gain += attackValueOf(geom, form, ctx.pathLoad) * (delta / atkSum)
  }
  return gain * TUNE.STACK
}

/**
 * 挑出增益最大的單一動作。這裡是整個 AI 的心臟：
 * 四種動作都換算成同一個單位後直接比大小，不做優先序。
 *
 * @param movedIds 這一輪已經搬過的字牌 id，不再納入搬動來源（見 runActions 的終止保證）
 */
function bestAction(state: GameState, geom: Geom, ctx: Ctx, movedIds: ReadonlySet<number>): Action | null {
  let best: Action | null = null
  const take = (a: Action) => {
    if (!best || a.gain > best.gain) best = a
  }

  // 沒被武將接手的字牌：既是「鏟掉換人」的對象，也是搬動的來源
  const loose = state.units.filter((u) => u.kind === 'glyph' && u.formIds.length === 0)
  // 場上最弱的幾個 → 鏟除候選（鏟除會吃掉一張手牌，不必防繞圈，所以不排除搬過的）
  const weakest = loose
    .map((u) => ({ u, value: liveValue(geom, ctx, u) }))
    .sort((a, b) => a.value - b.value)
    .slice(0, REPLACE_CANDIDATES)
  const movable = loose.filter((u) => !movedIds.has(u.id))

  for (let h = 0; h < state.hand.length; h++) {
    const card = state.hand[h]
    if (!card) continue

    // 1. 放到空地
    for (const cell of ctx.emptyPlots) {
      const gain = glyphSpotValue(state, geom, ctx, card.char, card.level, cell) +
        slotBonus(ctx, cell, card.char)
      take({ kind: 'place', gain, hand: h, cell })
    }

    // 2. 疊到同字同階的字牌上
    for (const [cell, g] of ctx.glyphByCell) {
      if (g.chars[0] !== card.char || g.level !== card.level || g.level >= MAX_GLYPH_LEVEL) continue
      take({ kind: 'stack', gain: stackGain(state, geom, ctx, g), hand: h, cell })
    }

    // 3. 鏟掉弱的換上這張（棋盤放滿之後唯一還能變強的路）
    for (const { u, value } of weakest) {
      const cell = u.cells[0]
      const after = glyphSpotValue(state, geom, ctx, card.char, card.level, cell) +
        slotBonus(ctx, cell, card.char)
      if (after < value * REPLACE_MARGIN) continue
      // 鏟除會退還糧，算進增益
      const refund = Math.max(1, Math.round(u.baseAtk * 0.35 + u.income * 0.5))
      take({ kind: 'replace', gain: after - value + refund * TUNE.FOOD * 0.2, hand: h, id: u.id, cell })
    }
  }

  // 4. 搬動：修正先前的壞落點，或把字挪去補上某個武將的最後一格。
  //    ⚠ 搬動只認 moveBonus（差最後一格的窗格），不認半完成窗格——否則孤字會震盪（見 moveBonus）。
  for (const u of movable) {
    const from = u.cells[0]
    const now = glyphSpotValue(state, geom, ctx, u.chars[0], u.level, from)
    for (const cell of ctx.emptyPlots) {
      const after =
        glyphSpotValue(state, geom, ctx, u.chars[0], u.level, cell) + moveBonus(ctx, cell, u.chars[0])
      // 純位置微調要贏過 MOVE_MARGIN；若是「搬過去就成將」則 moveBonus 會直接壓過門檻
      if (after < now * MOVE_MARGIN) continue
      take({ kind: 'move', gain: after - now, id: u.id, cell })
    }
    // 搬到同字同階的字牌上 = 用場上兩枚換一枚更高階的。棋盤滿了才划算，交給估值判斷
    for (const [cell, g] of ctx.glyphByCell) {
      if (g === u || g.chars[0] !== u.chars[0] || g.level !== u.level || g.level >= MAX_GLYPH_LEVEL) continue
      take({ kind: 'move', gain: stackGain(state, geom, ctx, g) - now, id: u.id, cell })
    }
  }

  return best
}

// ── 手牌與經濟 ────────────────────────────────────────
/** 場上字牌的 `字:階` 集合——它們是潛在的升階對象，手牌併牌時要避開（見下） */
function boardGlyphKeys(state: GameState): Set<string> {
  const s = new Set<string>()
  for (const u of state.units) if (u.kind === 'glyph') s.add(`${u.chars[0]}:${u.level}`)
  return s
}

/**
 * 把手牌裡同字同階的組合併掉，用來消化沒有去處的雜牌（一堆「盾」「兵」）。
 *
 * ⚠ `protect` 裡的 `字:階` **不併**：它們在場上有同字同階的字牌可以疊上去升階
 * （尤其是武將成員——疊上去整個武將跟著變強）。手上先併成高一階就再也疊不回去了
 * （品質不同無法疊合），本作「後期戰力指數成長」的升階路徑就是這樣斷掉的。
 */
function mergeHandPairs(state: GameState, protect: Set<string> = new Set()): number {
  let n = 0
  for (;;) {
    let did = false
    for (let i = 0; i < state.hand.length && !did; i++) {
      const a = state.hand[i]
      if (!a || a.level >= MAX_GLYPH_LEVEL) continue
      if (protect.has(`${a.char}:${a.level}`)) continue
      for (let j = i + 1; j < state.hand.length; j++) {
        const b = state.hand[j]
        if (!b || b.char !== a.char || b.level !== a.level) continue
        if (mergeHand(state, i, j).ok) {
          did = true
          n++
        }
        break
      }
    }
    if (!did) return n
  }
}

/**
 * 征兵。一次征兵會填滿**所有**空手牌格但只收一次錢，
 * 所以「只差一格就滿」時等一等更划算——除非糧已經多到花不完。
 * 這是強 AI 對傻 AI 最直接的一項改善（同一波內每征一次還會漲 RECRUIT_STEP）。
 */
function recruitIfWorth(state: GameState): number {
  let n = 0
  for (;;) {
    const empty = state.hand.filter((h) => h === null).length
    if (empty === 0) return n
    const cost = recruitCost(state)
    if (state.food < cost) return n
    if (empty === 1 && state.food < cost * 2.5) return n
    if (!recruit(state).ok) return n
    n++
  }
}

/**
 * 心願單：AI 唯一的長期規劃——讓抽卡朝「最值得做的事」收斂。兩類目標一起排序：
 *   1. 補完「已經開始湊」的窗格所缺的字（成新將）
 *   2. 疊高場上最強武將的成員字（把主力推向高階，這才是通關的爆發來源）
 * 兩者用同一把尺（估計增益）競爭有限的心願格。
 */
function syncWishes(brain: AutoBrain, state: GameState, geom: Geom, reuse: Ctx | null): void {
  if (state.wishSlots <= 0) return
  const ctx = reuse ?? buildCtx(brain, state, geom)
  const score = new Map<string, number>()
  const bump = (ch: string, v: number) => {
    if (!state.pool.includes(ch)) return
    if ((score.get(ch) ?? 0) < v) score.set(ch, v)
  }

  // 0. 對空優先：有飛行威脅、場上卻一個對空單位都沒有時，先許願把弓／弩之類的遠程字抽出來。
  //    這一條刻意給極高分（壓過其他所有目標）——洛陽只有 2 條命，第一波的飛賊漏一隻就近乎輸掉。
  const hasAir = state.units.some(
    (u) => u.baseRange >= ANTI_AIR_RANGE && u.atk > 0 && !(u.kind === 'glyph' && u.formIds.length > 0),
  )
  if (ctx.flyingThreat && !hasAir) {
    for (const ch of state.pool) {
      const d = GLYPH_BY_CHAR[ch]
      if (d && d.atk > 0 && d.range >= ANTI_AIR_RANGE) bump(ch, 1e9 + d.atk * d.aps)
    }
  }

  // 1. 補完進行中的窗格（用 ctx 已經列舉好的那份，別再列一次——那是整輪最貴的一步）
  for (const w of ctx.wins) {
    if (w.filled === 0) continue // 還沒動工的配方不許願，否則會亂點
    const weight = w.gain * (w.filled / w.cells.length)
    for (let i = 0; i < w.cells.length; i++) {
      if (!w.have[i]) bump(w.def.recipe[i], weight)
    }
  }

  // 2. 疊高場上武將的成員字：可升階的成員愈強，愈值得許願把同字同階抽出來
  for (const u of state.units) {
    if (u.kind !== 'general') continue
    for (const mid of u.memberIds) {
      const m = state.units.find((x) => x.id === mid)
      if (!m || m.level >= MAX_GLYPH_LEVEL) continue
      bump(m.chars[0], stackGain(state, geom, ctx, m))
    }
  }

  const want = [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, state.wishSlots)
    .map((x) => x[0])
  if (want.length === 0) return
  // 先退掉不要的再許新的，否則心願格滿了就換不動
  for (const ch of [...state.wishes]) if (!want.includes(ch)) toggleWish(state, ch)
  for (const ch of want) if (!state.wishes.includes(ch)) toggleWish(state, ch)
}

/** 場上有沒有打得到飛行單位的攻擊單位 */
function hasAntiAir(state: GameState): boolean {
  return state.units.some(
    (u) => u.baseRange >= ANTI_AIR_RANGE && u.atk > 0 && !(u.kind === 'glyph' && u.formIds.length > 0),
  )
}

/**
 * 有飛行威脅、場上又沒有對空火力時，確保心願單裡有一個能對空的字（弓弩之類）。
 * 刻意在**征兵之前**呼叫：不然第一手抽的都是沒許願的字，糧花光就再也補不上對空。
 */
function ensureAntiAirWish(state: GameState): void {
  if (state.wishSlots <= 0) return
  if (!state.bias.includes('flying')) return
  if (hasAntiAir(state)) return
  // 已經有對空字在願單或手上就不必再許
  if (state.wishes.some((c) => GLYPH_BY_CHAR[c]?.range >= ANTI_AIR_RANGE)) return
  if (state.hand.some((h) => h && GLYPH_BY_CHAR[h.char]?.range >= ANTI_AIR_RANGE)) return
  let best: string | null = null
  let bestDps = 0
  for (const ch of state.pool) {
    const d = GLYPH_BY_CHAR[ch]
    if (!d || d.atk <= 0 || d.range < ANTI_AIR_RANGE) continue
    const dps = d.atk * d.aps
    if (dps > bestDps) {
      bestDps = dps
      best = ch
    }
  }
  if (best && !state.wishes.includes(best)) {
    // 願單滿了就先讓一格給對空（對空在有飛行威脅時比什麼都重要）
    if (state.wishes.length >= state.wishSlots) toggleWish(state, state.wishes[0])
    toggleWish(state, best)
  }
}

/**
 * 這一輪什麼都做不了時的收尾。
 *   - 整手都是沒有用處的一階字 → 重抽（比放到爛格子上有價值）
 *   - 佈陣階段無事可做 → 提前開戰，把剩下的佈陣時間換成糧
 */
function idleTurn(state: GameState): number {
  // 放不下又快塞爆手牌時，先把同字同階併掉，至少換來更高階的牌留著之後用
  const full = state.hand.filter((h) => h === null).length <= 1
  if (full) {
    const merged = mergeHandPairs(state)
    if (merged) return merged
  }
  const held = state.hand.filter((h) => h !== null)
  if (
    held.length === state.hand.length &&
    held.every((h) => h!.level === 1) &&
    state.food >= rerollCost(state) * 3
  ) {
    if (rerollHand(state).ok) return 1
  }
  // ⚠ 刻意**不**提前開戰：搶那點提前開戰的糧不值得——佈陣時間是免費的反應緩衝，
  // 提早招來下一波只會在戰力還沒到位時把自己送死。讓 prepTimer 自然歸零即可。
  return 0
}
