/**
 * ★ 主動技與羈絆組合技（M3）。
 *
 * 設計原則：技能全部是「立即結算」的純函式，沒有排程器。
 *   - 多段技（例如呂布無雙）以一次結算的總傷害表示，只是特效畫三次
 *   - 這讓技能能在 Node 的自動平衡模擬裡跑，也不必處理施法中被鏟除的情況
 *
 * 註冊方式：SKILLS[武將名] / COMBOS[羈絆名]。
 * data/generals.ts 宣告了 skill 但這裡沒註冊的武將，不會施放（面板仍顯示文字）。
 */
import { emit } from './events'
import {
  aliveEnemies,
  canHit,
  damageEnemy,
  dealDamage,
  enemiesInRadius,
  enemyPos,
  mitigate,
  applyStatus,
  pushEffect,
  unitCenter,
} from './combat'
import type { Enemy, GameState, OnHit, Unit } from './types'

export type SkillFn = (state: GameState, u: Unit) => boolean

/** 技能作用半徑：以單位射程為基礎再放大 */
function radiusOf(u: Unit, extra: number): number {
  return Math.max(u.range, 1.5) + extra
}

function ring(state: GameState, x: number, y: number, r: number, color: string, life = 0.45): void {
  pushEffect(state.effects, {
    kind: 'ring',
    fromX: x,
    fromY: y,
    toX: x + r, // toX−fromX 帶半徑資訊給 renderer
    toY: y,
    life,
    maxLife: life,
    color,
  })
}

function shout(state: GameState, u: Unit, text: string, color: string): void {
  const c = unitCenter(state.board, u)
  u.skillFlash = 0.5
  pushEffect(state.effects, {
    kind: 'text',
    fromX: c.x,
    fromY: c.y - 0.4,
    toX: 0,
    toY: 0,
    life: 1.1,
    maxLife: 1.1,
    text,
    color,
  })
}

/** 無施放者的固定傷害（組合技用），仍走防禦減免 */
function flatDamage(state: GameState, e: Enemy, raw: number): void {
  damageEnemy(state, e, mitigate(raw, e.def))
}

// ── 技能原型 ──────────────────────────────────────────

/** 範圍爆發：半徑內所有敵人受傷，可附加狀態；repeat 只影響特效段數 */
function burst(mul: number, extra: number, onHit?: OnHit, repeat = 1): SkillFn {
  return (state, u) => {
    const r = radiusOf(u, extra)
    const targets = enemiesInRadius(state, u, r)
    if (!targets.length) return false
    for (const e of targets) {
      dealDamage(state, u, e, u.atk * mul)
      if (onHit) applyStatus(state, e, onHit, u.atk)
    }
    const c = unitCenter(state.board, u)
    for (let i = 0; i < repeat; i++) ring(state, c.x, c.y, r, '#c85a28', 0.35 + i * 0.12)
    return true
  }
}

/** 純控場：半徑內施加狀態，傷害很低 */
function crowd(onHit: OnHit, extra: number, mul = 0.4): SkillFn {
  return (state, u) => {
    const r = radiusOf(u, extra)
    const targets = enemiesInRadius(state, u, r)
    if (!targets.length) return false
    for (const e of targets) {
      dealDamage(state, u, e, u.atk * mul, false)
      applyStatus(state, e, onHit, u.atk)
    }
    const c = unitCenter(state.board, u)
    ring(state, c.x, c.y, r, '#4a6fb5', 0.5)
    return true
  }
}

/** 直線／路徑段打擊：以最前方目標為基準，往後涵蓋 len 段路徑 */
function lineStrike(mul: number, len: number, onHit?: OnHit): SkillFn {
  return (state, u) => {
    const inRange = enemiesInRadius(state, u, radiusOf(u, 0.4))
    if (!inRange.length) return false
    const head = inRange.reduce((a, b) => (b.dist > a.dist ? b : a))
    const hit = aliveEnemies(state).filter(
      (e) => canHit(u, e) && e.dist <= head.dist + 0.5 && e.dist >= head.dist - len,
    )
    for (const e of hit) {
      dealDamage(state, u, e, u.atk * mul)
      if (onHit) applyStatus(state, e, onHit, u.atk)
    }
    const from = unitCenter(state.board, u)
    const to = enemyPos(state.board, head)
    pushEffect(state.effects, {
      kind: 'beam',
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      life: 0.35,
      maxLife: 0.35,
      color: '#2f6b3f',
    })
    return true
  }
}

/** 衝鋒：無視射程，打擊路徑上最前方的 count 名敵人 */
function charge(mul: number, onHit?: OnHit, count = 8): SkillFn {
  return (state, u) => {
    const list = aliveEnemies(state)
      .filter((e) => canHit(u, e))
      .sort((a, b) => b.dist - a.dist)
      .slice(0, count)
    if (!list.length) return false
    for (const e of list) {
      dealDamage(state, u, e, u.atk * mul)
      if (onHit) applyStatus(state, e, onHit, u.atk)
    }
    const from = unitCenter(state.board, u)
    const to = enemyPos(state.board, list[0])
    pushEffect(state.effects, {
      kind: 'beam',
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      life: 0.4,
      maxLife: 0.4,
      color: '#8a4fd4',
    })
    return true
  }
}

/** 狙擊：全場血量最高的敵人 */
function snipe(mul: number): SkillFn {
  return (state, u) => {
    const list = aliveEnemies(state).filter((e) => canHit(u, e))
    if (!list.length) return false
    const target = list.reduce((a, b) => (b.hp > a.hp ? b : a))
    dealDamage(state, u, target, u.atk * mul)
    const from = unitCenter(state.board, u)
    const to = enemyPos(state.board, target)
    pushEffect(state.effects, {
      kind: 'beam',
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      life: 0.3,
      maxLife: 0.3,
      color: '#a3271a',
    })
    return true
  }
}

/** 全場：不看射程也不看位置 */
function global(mul: number, onHit?: OnHit): SkillFn {
  return (state, u) => {
    const list = aliveEnemies(state).filter((e) => canHit(u, e))
    if (!list.length) return false
    for (const e of list) {
      dealDamage(state, u, e, u.atk * mul)
      if (onHit) applyStatus(state, e, onHit, u.atk)
      const p = enemyPos(state.board, e)
      ring(state, p.x, p.y, 0.8, '#c85a28', 0.3)
    }
    return true
  }
}

/** 恢復生命 */
function healLife(n: number): SkillFn {
  return (state, u) => {
    if (state.lives >= state.maxLives) return false
    state.lives = Math.min(state.maxLives, state.lives + n)
    shout(state, u, '仁德', '#c8402f')
    return true
  }
}

/** 徵糧 */
function gainFood(base: number, perWave = 0.6): SkillFn {
  return (state, u) => {
    const gain = Math.round(base + state.wave * perWave)
    state.food += gain
    state.stats.foodEarned += gain
    shout(state, u, `+${gain} 糧`, '#2f6b3f')
    return true
  }
}

/** 先範圍傷害再徵糧（曹操） */
function burstAndFood(mul: number, extra: number, food: number): SkillFn {
  const b = burst(mul, extra)
  const f = gainFood(food)
  return (state, u) => {
    const hit = b(state, u)
    if (!hit) return false
    f(state, u)
    return true
  }
}

// ── 武將主動技註冊表 ──────────────────────────────────
export const SKILLS: Record<string, SkillFn> = {
  // 非姓名配方（兵器／兵種／謀略組合）。倍率刻意低於同階的姓名武將——
  // 它們的字永遠在池內、湊起來容易得多，技能只是「錦上添花」而不是主力
  戟斧: burst(1.6, 0.6, { stunDur: 0.7 }),
  火雷: burst(1.7, 0.9, { burn: { mul: 0.8, dur: 4 }, chain: 2 }),
  雷車: lineStrike(1.5, 2.0, { chain: 2 }),

  // 謀略
  火計: burst(1.8, 1.0, { burn: { mul: 0.9, dur: 4 } }),
  毒計: crowd({ burn: { mul: 1.1, dur: 5 }, slowDur: 2 }, 1.2),
  雷陣: burst(2.0, 0.8, { stunDur: 0.8, chain: 2 }),
  風令: burst(1.2, 1.0, { knock: 1.0 }),
  周瑜: global(1.2, { burn: { mul: 1.0, dur: 5 } }),
  龐統: global(0.5, { slowDur: 3, vulnDur: 5 }),
  諸葛亮: global(1.4, { slowDur: 3, stunDur: 0.8 }),
  姜維: global(1.0, { slowDur: 2, stunDur: 0.5 }),
  郭嘉: crowd({ vulnDur: 5, slowDur: 2 }, 1.4, 0.3),
  荀彧: gainFood(10),
  陳宮: crowd({ slowDur: 2.5 }, 1.0, 0.4),

  // 副將與名將
  黃蓋: burst(2.6, 0.5, { burn: { mul: 0.6, dur: 3 } }),
  馬岱: lineStrike(1.6, 1.5),
  馬超: charge(2.0, { knock: 1 }, 6),
  關興: lineStrike(2.6, 2.5),
  周泰: crowd({ stunDur: 1.0 }, 0.8, 0.6),
  甘寧: charge(2.2, { vulnDur: 3 }, 8),
  呂蒙: crowd({ vulnDur: 4, slowDur: 2 }, 1.0),

  // 傳說
  張飛: crowd({ stunDur: 1.5, vulnDur: 4 }, 1.2, 1.0),
  趙雲: charge(2.4, undefined, 10),
  關羽: lineStrike(3.2, 3),
  黃忠: snipe(4.5),
  劉備: healLife(1),
  呂布: burst(1.5, 0.6, undefined, 3),
  張遼: charge(2.0, { stunDur: 1.0 }, 6),
  曹操: burstAndFood(1.6, 0.8, 8),
  孫權: gainFood(14),
  陸遜: burst(1.6, 1.0, { burn: { mul: 1.0, dur: 5 } }),
  徐晃: lineStrike(3.0, 3),
  魏延: charge(2.6, { vulnDur: 2 }, 8),
}

/**
 * 每個 tick 推進技能冷卻並施放。
 * 施放失敗（沒有目標／不需要）時不重設冷卻，下一 tick 再試。
 */
export function stepSkills(state: GameState, dt: number): void {
  for (const u of state.units) {
    if (u.skillFlash > 0) u.skillFlash -= dt
    if (u.skillCdMax <= 0) continue
    if (u.skillCd > 0) {
      u.skillCd -= dt
      continue
    }
    const fn = SKILLS[u.defKey]
    if (!fn) continue
    if (fn(state, u)) {
      u.skillCd = u.skillCdMax
      u.skillFlash = 0.5
      const c = unitCenter(state.board, u)
      emit(state, { kind: 'skill', name: u.defKey, x: c.x, y: c.y })
    }
  }
}

// ── 羈絆組合技 ────────────────────────────────────────
export type ComboFn = (state: GameState, members: Unit[]) => boolean

function sumAtk(members: Unit[]): number {
  return members.reduce((s, u) => s + u.atk, 0)
}

function comboBanner(state: GameState, members: Unit[], text: string, color: string): void {
  for (const m of members) m.skillFlash = 0.7
  emit(state, { kind: 'combo', name: text })
  const c = unitCenter(state.board, members[0])
  pushEffect(state.effects, {
    kind: 'text',
    fromX: c.x,
    fromY: c.y - 0.5,
    toX: 0,
    toY: 0,
    life: 1.4,
    maxLife: 1.4,
    text,
    color,
  })
}

export const COMBOS: Record<string, ComboFn> = {
  桃園結義: (state, members) => {
    const list = aliveEnemies(state)
    if (!list.length) return false
    const target = list.reduce((a, b) => (b.hp > a.hp ? b : a))
    flatDamage(state, target, sumAtk(members) * 3)
    applyStatus(state, target, { stunDur: 1.2, vulnDur: 4 }, 0)
    const p = enemyPos(state.board, target)
    ring(state, p.x, p.y, 1.6, '#d9a520', 0.6)
    comboBanner(state, members, '三英戰呂布', '#d9a520')
    return true
  },

  五虎上將: (state, members) => {
    const list = aliveEnemies(state)
    if (list.length < 2) return false
    const dmg = sumAtk(members) * 1.2
    for (const e of list) {
      flatDamage(state, e, dmg)
      const p = enemyPos(state.board, e)
      ring(state, p.x, p.y, 1.0, '#d9a520', 0.4)
    }
    comboBanner(state, members, '五虎齊出', '#d9a520')
    return true
  },

  西涼鐵騎: (state, members) => {
    const list = aliveEnemies(state)
    if (!list.length) return false
    const dmg = sumAtk(members) * 1.5
    for (const e of list) {
      flatDamage(state, e, dmg)
      applyStatus(state, e, { knock: 1.2 }, 0)
    }
    comboBanner(state, members, '鐵騎踏陣', '#8a4fd4')
    return true
  },

  江東基業: (state, members) => {
    const list = aliveEnemies(state)
    if (!list.length) return false
    const total = sumAtk(members)
    for (const e of list) {
      flatDamage(state, e, total * 0.5)
      applyStatus(state, e, { burn: { mul: 1, dur: 5 } }, total * 0.6)
    }
    comboBanner(state, members, '火燒赤壁', '#c85a28')
    return true
  },

  呂布陳宮: (state, members) => {
    const list = aliveEnemies(state)
    if (!list.length) return false
    const target = list.reduce((a, b) => (b.hp > a.hp ? b : a))
    flatDamage(state, target, sumAtk(members) * 2.5)
    applyStatus(state, target, { vulnDur: 5 }, 0)
    const p = enemyPos(state.board, target)
    ring(state, p.x, p.y, 1.2, '#8a4fd4', 0.5)
    comboBanner(state, members, '轅門射戟', '#8a4fd4')
    return true
  },
}

/** 找出參與某羈絆的武將（供組合技結算傷害用） */
export function bondMembers(state: GameState, bondName: string, names?: string[], tag?: string): Unit[] {
  const generals = state.units.filter((u) => u.kind === 'general')
  if (names) return generals.filter((u) => names.includes(u.defKey))
  if (tag) return generals.filter((u) => u.tags.includes(tag))
  return generals.filter(() => bondName.length > 0)
}
