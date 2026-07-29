/**
 * 索敵、傷害、控場狀態、投射特效。
 * 設計決定 #2：障礙不阻擋射線 → 索敵只算歐氏距離，不做視線判定。
 *
 * 傷害入口只有兩個：
 *   dealDamage()   —— 由單位攻擊或技能造成，會套用相剋／易傷／onHit
 *   damageEnemy()  —— 純扣血（灼燒等持續傷害用），不套修正
 */
import { cellCenter } from './board'
import { emit } from './events'
import { ANTI_AIR_RANGE } from '../data/enemies'
import type { Board, Effect, Enemy, GameState, OnHit, Troop, Unit } from './types'

export const DEF_K = 60
export const SLOW_FACTOR = 0.5
export const VULN_MUL = 1.3
export const COUNTER_BONUS = 1.25
export const COUNTER_PENALTY = 0.75

/** 全域射程倍率：所有會攻擊的單位射程一律先 ×2（字牌與武將皆是），再疊上各自的加成 */
export const RANGE_MUL = 2
/** 武將的額外射程加成，疊在 RANGE_MUL 之上——武將需要比單字更大的覆蓋範圍 */
export const GENERAL_RANGE_BONUS = 1.25
/** 單個字（尚未組成武將）的射程收斂到 8 成，跟武將的射程優勢拉開差距，鼓勵組將 */
export const GLYPH_RANGE_MUL = 0.8

export function mitigate(atk: number, def: number): number {
  return Math.max(1, atk * (1 - def / (def + DEF_K)))
}

/** 三向相剋：騎 → 弓 → 步 → 騎 */
export function counterMul(attacker: Troop, defender: Troop): number {
  if (attacker === 'none' || defender === 'none') return 1
  const beats: Record<string, Troop> = { 騎: '弓', 弓: '步', 步: '騎' }
  if (beats[attacker] === defender) return COUNTER_BONUS
  if (beats[defender] === attacker) return COUNTER_PENALTY
  return 1
}

/** 由 tags 推導兵種，供相剋使用 */
export function troopFromTags(tags: string[]): Troop {
  if (tags.includes('騎')) return '騎'
  if (tags.includes('弓')) return '弓'
  if (tags.includes('步')) return '步'
  return 'none'
}

/** 單位中心座標（格為單位）。多格武將取所有格的平均 */
export function unitCenter(board: Board, u: Unit): { x: number; y: number } {
  let x = 0
  let y = 0
  for (const c of u.cells) {
    const p = cellCenter(board, c)
    x += p.x
    y += p.y
  }
  return { x: x / u.cells.length, y: y / u.cells.length }
}

/**
 * 實效射程。除了全域倍率與武將加成外，還補償「多格單位中心外移」的問題：
 * 直立／橫向合成的武將，其中心是所有格的平均，會比單格字牌更遠離路徑，
 * 使得（尤其是直立）武將的射程看起來變短、甚至打不到。這裡把「中心到最遠成員格」
 * 的距離加回射程，等同於從最靠近敵人的那一格量起，直立與橫向就一致了。
 * 光環／經濟字（baseRange 0）維持 0，不會攻擊。
 */
export function effectiveRange(board: Board, u: Unit): number {
  if (u.baseRange <= 0) return 0
  let r = u.baseRange * RANGE_MUL
  if (u.kind === 'general') r *= GENERAL_RANGE_BONUS
  else r *= GLYPH_RANGE_MUL
  if (u.cells.length > 1) {
    const c = unitCenter(board, u)
    let maxOff = 0
    for (const cell of u.cells) {
      const p = cellCenter(board, cell)
      maxOff = Math.max(maxOff, Math.hypot(p.x - c.x, p.y - c.y))
    }
    r += maxOff
  }
  return r
}

/** 敵人在路徑上的座標（格為單位） */
export function enemyPos(board: Board, e: Enemy): { x: number; y: number } {
  const path = board.path
  const last = path.length - 1
  const d = Math.min(Math.max(e.dist, 0), last)
  const i = Math.min(Math.floor(d), last)
  const frac = d - i
  const a = cellCenter(board, path[i])
  const b = cellCenter(board, path[Math.min(i + 1, last)])
  return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac }
}

export function canHit(u: Unit, e: Enemy): boolean {
  if (!e.flying) return true
  // 對空資格看「本身射程等級」（baseRange），不受全域射程倍率影響——
  // 否則射程一放大，近戰單位也會變成能打飛行，破壞弓系對空的設計。
  return u.baseRange >= ANTI_AIR_RANGE
}

/** 弓系對飛行單位 1.5 倍 */
function airBonus(u: Unit, e: Enemy): number {
  return e.flying && u.tags.includes('弓') ? 1.5 : 1
}

export function aliveEnemies(state: GameState): Enemy[] {
  return state.enemies.filter((e) => e.hp > 0)
}

/** 射程內、打得到的敵人 */
export function enemiesInRadius(state: GameState, u: Unit, radius: number): Enemy[] {
  const c = unitCenter(state.board, u)
  return aliveEnemies(state).filter((e) => {
    if (!canHit(u, e)) return false
    const p = enemyPos(state.board, e)
    return Math.hypot(p.x - c.x, p.y - c.y) <= radius
  })
}

function pickTarget(state: GameState, u: Unit): Enemy | null {
  const c = unitCenter(state.board, u)
  let best: Enemy | null = null
  let bestScore = -Infinity
  for (const e of state.enemies) {
    if (e.hp <= 0 || !canHit(u, e)) continue
    const p = enemyPos(state.board, e)
    const dist = Math.hypot(p.x - c.x, p.y - c.y)
    if (dist > u.range) continue
    let score: number
    switch (u.targeting) {
      case 'near':
        score = -dist
        break
      case 'strong':
        score = e.hp
        break
      default:
        score = e.dist // 最前方（離大營最近）
    }
    if (score > bestScore) {
      bestScore = score
      best = e
    }
  }
  return best
}

/** 純扣血 + 死亡結算。灼燒等持續傷害直接走這裡 */
export function damageEnemy(state: GameState, e: Enemy, dmg: number): void {
  if (e.hp <= 0) return
  e.hp -= dmg
  e.hitFlash = 0.12
  if (e.hp <= 0) {
    // 狩獵好手：擊殺收入倍率，預設中性值 1 不影響原本整數收益
    const bounty = Math.round(e.bounty * state.perks.bountyMul)
    state.food += bounty
    state.stats.kills++
    state.stats.foodEarned += bounty
    const p = enemyPos(state.board, e)
    emit(state, { kind: 'kill', x: p.x, y: p.y, bounty })
    pushEffect(state.effects, {
      kind: 'text',
      fromX: p.x,
      fromY: p.y,
      toX: 0,
      toY: 0,
      life: 0.7,
      maxLife: 0.7,
      text: `+${bounty}`,
    })
  }
}

/** 套用相剋、對空、易傷後造成傷害，並施加 onHit 狀態 */
export function dealDamage(
  state: GameState,
  u: Unit,
  e: Enemy,
  raw: number,
  applyOnHit = true,
): void {
  if (e.hp <= 0) return
  let mul = airBonus(u, e) * counterMul(u.troop, e.troop) * (e.vuln > 0 ? VULN_MUL : 1)
  // 奇兵秘計：機率爆擊，中性值 critChance=0 時 rng() < 0 恆假，完全不影響原本傷害
  const crit = state.perks.critChance > 0 && state.rng() < state.perks.critChance
  if (crit) mul *= state.perks.critMul
  damageEnemy(state, e, mitigate(raw * mul, e.def))
  if (crit) {
    const p = enemyPos(state.board, e)
    pushEffect(state.effects, {
      kind: 'text',
      fromX: p.x,
      fromY: p.y,
      toX: 0,
      toY: 0,
      life: 0.6,
      maxLife: 0.6,
      text: '會心!',
      color: '#d94f2a',
    })
  }
  if (applyOnHit && u.onHit) applyStatus(state, e, u.onHit, raw)
}

/**
 * 施加控場狀態。三種免疫各自擋掉不同的東西：
 *   ccImmune   → 定身與擊退（BOSS 幾乎都有）
 *   slowImmune → 減速（疾風系）
 *   burnImmune → 灼燒（因為灼燒無視防禦，這是唯一能逼玩家改帶高單擊的手段）
 * 易傷（vuln）刻意不給任何免疫，否則控場流會完全失去對 BOSS 的作用。
 */
export function applyStatus(state: GameState, e: Enemy, onHit: OnHit, baseAtk: number): void {
  if (onHit.slowDur && !e.slowImmune) e.slow = Math.max(e.slow, onHit.slowDur)
  if (onHit.vulnDur) e.vuln = Math.max(e.vuln, onHit.vulnDur)
  if (onHit.burn && !e.burnImmune) {
    e.burnT = Math.max(e.burnT, onHit.burn.dur)
    e.burnDps = Math.max(e.burnDps, baseAtk * onHit.burn.mul)
  }
  if (!e.ccImmune) {
    if (onHit.stunDur) e.stun = Math.max(e.stun, onHit.stunDur)
    if (onHit.knock) e.dist = Math.max(0, e.dist - onHit.knock)
  }
  if (onHit.knock && !e.ccImmune) {
    const p = enemyPos(state.board, e)
    pushEffect(state.effects, {
      kind: 'ring',
      fromX: p.x,
      fromY: p.y,
      toX: p.x,
      toY: p.y,
      life: 0.25,
      maxLife: 0.25,
      color: '#5a96c8',
    })
  }
}

export function pushEffect(list: Effect[], eff: Effect): void {
  // 上限保護：特效只是視覺，超量直接丟棄
  if (list.length > 240) return
  list.push(eff)
}

export function stepCombat(state: GameState, dt: number): void {
  const board = state.board
  for (const u of state.units) {
    // 已組成武將的字牌不再單獨攻擊——由武將那一層代表出手，否則傷害會重複計算
    if (u.kind === 'glyph' && u.formIds.length > 0) continue
    if (u.atk <= 0 || u.aps <= 0) continue
    u.cd -= dt
    if (u.cd > 0) continue

    const target = pickTarget(state, u)
    if (!target) {
      u.cd = 0
      continue
    }
    u.cd = 1 / u.aps
    u.atkFlash = 0.18

    const from = unitCenter(board, u)
    const to = enemyPos(board, target)
    // 每次攻擊都帶著「誰打的」資訊：fx 決定畫法、glyph 畫在命中點、tier 決定濃度
    const label = u.kind === 'glyph' ? u.chars[0] : u.defKey
    emit(state, { kind: 'attack', fx: u.fx, x: from.x, y: from.y })
    const attackEffect = (life: number): void => {
      pushEffect(state.effects, {
        kind: 'attack',
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        life,
        maxLife: life,
        fx: u.fx,
        glyph: label,
        tier: u.tier,
      })
    }

    if (u.shape === 'single') {
      dealDamage(state, u, target, u.atk)
      // 連鎖（雷）：附近再打 chain 個目標，傷害 60%
      if (u.onHit?.chain) {
        let left = u.onHit.chain
        for (const e of state.enemies) {
          if (left <= 0) break
          if (e === target || e.hp <= 0 || !canHit(u, e)) continue
          const p = enemyPos(board, e)
          if (Math.hypot(p.x - to.x, p.y - to.y) > 1.8) continue
          dealDamage(state, u, e, u.atk * 0.6, false)
          pushEffect(state.effects, {
            kind: 'beam',
            fromX: to.x,
            fromY: to.y,
            toX: p.x,
            toY: p.y,
            life: 0.2,
            maxLife: 0.2,
            color: '#785ac8',
          })
          left--
        }
      }
      attackEffect(0.24)
    } else if (u.shape === 'pierce') {
      // 沿路徑貫穿：命中目標前後 1.3 段內、最多 3 名。烽火連城：貫穿/範圍傷害額外加成
      let hits = 0
      for (const e of state.enemies) {
        if (e.hp <= 0 || !canHit(u, e)) continue
        if (Math.abs(e.dist - target.dist) > 1.3) continue
        dealDamage(state, u, e, u.atk * state.perks.splashMul)
        if (++hits >= 3) break
      }
      attackEffect(0.28)
    } else {
      // splash：目標周圍 1.3 格。烽火連城：範圍傷害額外加成
      for (const e of state.enemies) {
        if (e.hp <= 0 || !canHit(u, e)) continue
        const p = enemyPos(board, e)
        if (Math.hypot(p.x - to.x, p.y - to.y) > 1.3) continue
        dealDamage(state, u, e, u.atk * state.perks.splashMul)
      }
      attackEffect(0.3)
      pushEffect(state.effects, {
        kind: 'splash',
        fromX: to.x,
        fromY: to.y,
        toX: to.x,
        toY: to.y,
        life: 0.3,
        maxLife: 0.3,
        fx: u.fx,
      })
    }
  }
}

export function stepEffects(state: GameState, dt: number): void {
  const keep: Effect[] = []
  for (const e of state.effects) {
    e.life -= dt
    if (e.life > 0) keep.push(e)
  }
  state.effects = keep
}
