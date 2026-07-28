import { describe, expect, it } from 'vitest'
import { cellIndex } from '../board'
import { placeFromHand } from '../actions'
import { createGame, recalcUnits } from '../state'
import { stepGame } from '../step'
import type { Enemy, GameState } from '../types'

function put(state: GameState, char: string, col: number, row: number, level = 1): void {
  state.hand[0] = { char, level }
  placeFromHand(state, 0, cellIndex(state.board, col, row))
}

function spawnEnemy(state: GameState, over: Partial<Enemy> = {}): Enemy {
  const e: Enemy = {
    id: state.nextEnemyId++,
    defKey: 'thief',
    char: '賊',
    hp: 100000,
    maxHp: 100000,
    def: 0,
    speed: 0,
    flying: false,
    bounty: 2,
    damage: 1,
    troop: 'none',
    ccImmune: false,
    dist: 5,
    hitFlash: 0,
    slow: 0,
    stun: 0,
    vuln: 0,
    burnT: 0,
    burnDps: 0,
    ...over,
  }
  state.enemies.push(e)
  state.phase = 'battle'
  state.spawnQueue = []
  return e
}

describe('新增武將：配方正確組成', () => {
  const cases: { name: string; recipe: [string, string] }[] = [
    { name: '矛兵', recipe: ['矛', '兵'] },
    { name: '劍兵', recipe: ['劍', '兵'] },
    { name: '戟兵', recipe: ['戟', '兵'] },
    { name: '斧兵', recipe: ['斧', '兵'] },
    { name: '風令', recipe: ['風', '令'] },
    { name: '周泰', recipe: ['周', '泰'] },
    { name: '荀彧', recipe: ['荀', '彧'] },
    { name: '陳宮', recipe: ['陳', '宮'] },
    { name: '甘寧', recipe: ['甘', '寧'] },
    { name: '呂蒙', recipe: ['呂', '蒙'] },
    { name: '郭嘉', recipe: ['郭', '嘉'] },
    { name: '陸遜', recipe: ['陸', '遜'] },
    { name: '徐晃', recipe: ['徐', '晃'] },
    { name: '魏延', recipe: ['魏', '延'] },
    { name: '姜維', recipe: ['姜', '維'] },
  ]

  for (const { name, recipe } of cases) {
    it(`${recipe.join('+')} → ${name}`, () => {
      const s = createGame()
      put(s, recipe[0], 0, 1)
      put(s, recipe[1], 1, 1)
      const u = s.units.find((x) => x.kind === 'general' && x.defKey === name)
      expect(u, `沒有組成「${name}」`).toBeTruthy()
    })
  }

  it('斧兵繼承「斧」的定身效果（沒宣告 onHit 時自動合併成員字牌）', () => {
    const s = createGame()
    put(s, '斧', 0, 1)
    put(s, '兵', 1, 1)
    const u = s.units.find((x) => x.defKey === '斧兵')!
    expect(u.onHit?.stunDur).toBeGreaterThan(0)
  })
})

/** 巨鹿地圖是 9 欄，col2/3/4 在每一列都是空地——用來在不同列各放一組字牌，彼此不衝突 */
const OPEN_ROWS = [1, 2, 4, 5, 7, 8, 10, 11]

/** 把一組 2～3 字的配方放到第 rowIndex 個可用列（col 固定 2 起） */
function putRecipe(state: GameState, chars: string[], rowIndex: number): void {
  const row = OPEN_ROWS[rowIndex]
  chars.forEach((ch, i) => put(state, ch, 2 + i, row))
}

describe('新增羈絆', () => {
  it('呂布陳宮：組成後有羈絆，組合技「轅門射戟」會在冷卻歸零時施放', () => {
    const s = createGame()
    putRecipe(s, ['呂', '布'], 0)
    putRecipe(s, ['陳', '宮'], 1)
    expect(s.activeBonds.map((b) => b.name)).toContain('呂布陳宮')

    const e = spawnEnemy(s, { dist: 5 })
    for (let i = 0; i < 60 * 31; i++) stepGame(s, 1 / 60)
    expect(e.hp).toBeLessThan(100000)
    expect(s.bondCds['呂布陳宮']).toBeGreaterThan(0)
  })

  it('江東猛虎：4 名以上「吳」武將同時在場時攻擊 +20%', () => {
    const s = createGame()
    putRecipe(s, ['孫', '權'], 0)
    const sunquan = s.units.find((u) => u.defKey === '孫權')!
    const base = sunquan.atk
    putRecipe(s, ['周', '瑜'], 1)
    putRecipe(s, ['黃', '蓋'], 2)
    putRecipe(s, ['甘', '寧'], 3)
    recalcUnits(s)
    expect(s.activeBonds.map((b) => b.name)).toContain('江東猛虎')
    expect(sunquan.atk).toBeCloseTo(base * 1.2, 5)
  })

  it('魏武謀主：曹操、郭嘉、荀彧同時在場時技能冷卻 -25%', () => {
    const s = createGame()
    putRecipe(s, ['曹', '操'], 0)
    const caocao = s.units.find((u) => u.defKey === '曹操')!
    const full = caocao.skillCdMax
    putRecipe(s, ['郭', '嘉'], 1)
    putRecipe(s, ['荀', '彧'], 2)
    recalcUnits(s)
    expect(s.activeBonds.map((b) => b.name)).toContain('魏武謀主')
    expect(caocao.skillCdMax).toBeCloseTo(full * 0.75, 5)
  })

  it('武侯托孤：諸葛亮、姜維同時在場時技能冷卻 -25%', () => {
    const s = createGame()
    putRecipe(s, ['諸', '葛', '亮'], 0)
    const liang = s.units.find((u) => u.defKey === '諸葛亮')!
    const full = liang.skillCdMax
    putRecipe(s, ['姜', '維'], 1)
    recalcUnits(s)
    expect(s.activeBonds.map((b) => b.name)).toContain('武侯托孤')
    expect(liang.skillCdMax).toBeCloseTo(full * 0.75, 5)
  })

  it('蜀漢棟樑：6 名以上「蜀」武將同時在場時攻擊 +15%、攻速 +10%', () => {
    const s = createGame()
    // 刻意避開 桃園結義／五虎上將（缺 劉備 或缺全部五虎成員）、西涼鐵騎（只 1 名「馬」）、
    // 奇門遁甲（只 2 名「謀略」）——確保只有蜀漢棟樑單獨觸發，測出來的倍率才乾淨
    const recipes: [string, string][] = [
      ['趙', '雲'],
      ['馬', '超'],
      ['關', '興'],
      ['龐', '統'],
      ['魏', '延'],
      ['姜', '維'],
    ]
    recipes.forEach((r, i) => putRecipe(s, r, i))
    const zhaoyun = s.units.find((u) => u.defKey === '趙雲')!
    const baseAtk = zhaoyun.baseAtk
    const baseAps = zhaoyun.baseAps
    recalcUnits(s)
    expect(s.activeBonds.map((b) => b.name)).toEqual(['蜀漢棟樑'])
    expect(zhaoyun.atk).toBeCloseTo(baseAtk * 1.15, 4)
    expect(zhaoyun.aps).toBeCloseTo(baseAps * 1.1, 4)
  })
})

describe('新增武將主動技', () => {
  it('荀彧〈調度糧秣〉立即獲得糧草', () => {
    const s = createGame()
    put(s, '荀', 0, 1)
    put(s, '彧', 1, 1)
    const u = s.units.find((x) => x.defKey === '荀彧')!
    u.skillCd = 0
    const before = s.food
    spawnEnemy(s)
    stepGame(s, 1 / 60)
    expect(s.food).toBeGreaterThan(before)
  })

  it('姜維〈九伐中原〉對全場敵人減速並定身', () => {
    const s = createGame()
    put(s, '姜', 0, 1)
    put(s, '維', 1, 1)
    const u = s.units.find((x) => x.defKey === '姜維')!
    u.skillCd = 0
    const e = spawnEnemy(s, { dist: 40 }) // 遠離射程外，只測全場技能而非普通攻擊
    stepGame(s, 1 / 60)
    expect(e.slow).toBeGreaterThan(0)
  })
})
