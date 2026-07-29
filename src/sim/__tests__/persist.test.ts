import { describe, expect, it } from 'vitest'
import { dailyChallenge, dateKeyOf } from '../../data/daily'
import { LEVEL_ORDER } from '../../data/levels'
import { mulberry32 } from '../../core/rng'
import { cellIndex } from '../board'
import { RUN_SAVE_VERSION, restoreRun, snapshotRun, type RunSnapshot } from '../persist'
import { DEFAULT_META, createGame, makeGlyphUnit, recalcUnits } from '../state'
import { stepGame } from '../step'
import type { GameState } from '../types'

const DT = 1 / 60

/** 推進 n 幀，讓對局處於「進行到一半」的狀態 */
function run(state: GameState, frames: number): void {
  for (let i = 0; i < frames; i++) stepGame(state, DT)
}

/** 走一趟 JSON，模擬真正經過 localStorage 的來回 */
function roundTrip(snap: RunSnapshot): RunSnapshot {
  return JSON.parse(JSON.stringify(snap)) as RunSnapshot
}

describe('mulberry32 的狀態存取', () => {
  it('setState 之後產生的序列與原本完全一致', () => {
    const a = mulberry32(12345)
    for (let i = 0; i < 50; i++) a()
    const mid = a.getState()
    const expected = [a(), a(), a(), a()]

    const b = mulberry32(999)
    b.setState(mid)
    expect([b(), b(), b(), b()]).toEqual(expected)
  })

  it('getState 不會消耗亂數', () => {
    const a = mulberry32(7)
    a.getState()
    a.getState()
    const b = mulberry32(7)
    expect(a()).toBe(b())
  })
})

describe('局內存檔：快照與還原', () => {
  it('還原後的對局與原本逐欄一致', () => {
    const s = createGame('julu', 4242)
    run(s, 900)
    const snap = roundTrip(snapshotRun(s, 4242))
    const r = restoreRun(snap, DEFAULT_META)!
    expect(r).not.toBeNull()
    expect(r.wave).toBe(s.wave)
    expect(r.food).toBe(s.food)
    expect(r.lives).toBe(s.lives)
    expect(r.phase).toBe(s.phase)
    expect(r.enemies.length).toBe(s.enemies.length)
    expect(r.units.length).toBe(s.units.length)
    expect(r.stats).toEqual(s.stats)
    expect(r.spawnQueue).toEqual(s.spawnQueue)
  })

  it('★ 還原後繼續跑，會走出跟沒中斷過完全相同的一局', () => {
    const a = createGame('julu', 777)
    run(a, 600)
    const snap = roundTrip(snapshotRun(a, 777))

    // a 繼續跑；b 從快照還原後跑同樣的幀數
    const b = restoreRun(snap, DEFAULT_META)!
    run(a, 1800)
    run(b, 1800)

    expect(b.wave).toBe(a.wave)
    expect(b.food).toBe(a.food)
    expect(b.lives).toBe(a.lives)
    expect(b.stats).toEqual(a.stats)
    expect(b.enemies.map((e) => [e.defKey, Math.round(e.hp)])).toEqual(
      a.enemies.map((e) => [e.defKey, Math.round(e.hp)]),
    )
  })

  it('棋盤由 (關卡, 種子) 重建，不必存進快照', () => {
    const s = createGame('guandu', 31337) // 隨機地形關
    const snap = roundTrip(snapshotRun(s, 31337))
    expect('board' in snap).toBe(false)
    const r = restoreRun(snap, DEFAULT_META)!
    expect(r.board.tiles).toEqual(s.board.tiles)
    expect(r.board.path).toEqual(s.board.path)
  })

  it('字牌與武將的雙向指標還原後仍然接得上', () => {
    const s = createGame('julu', 5)
    // 手動組一個張飛：兩個字牌 + 一個武將
    const c0 = cellIndex(s.board, 0, 1)
    const c1 = cellIndex(s.board, 1, 1)
    s.units.push(makeGlyphUnit(s, '張', 1, c0), makeGlyphUnit(s, '飛', 1, c1))
    recalcUnits(s)
    const before = s.units.map((u) => ({ id: u.id, formIds: [...u.formIds], memberIds: [...u.memberIds] }))

    const r = restoreRun(roundTrip(snapshotRun(s, 5)), DEFAULT_META)!
    expect(r.units.map((u) => ({ id: u.id, formIds: u.formIds, memberIds: u.memberIds }))).toEqual(before)
  })

  it('衍生值是重算的，不是從存檔讀的', () => {
    const s = createGame('julu', 8)
    s.units.push(makeGlyphUnit(s, '刀', 3, cellIndex(s.board, 0, 1)))
    recalcUnits(s)
    const snap = snapshotRun(s, 8)
    // 竄改快照裡的實效值——還原後應該被 recalcUnits 蓋掉
    snap.units[0].atk = 99999
    const r = restoreRun(roundTrip(snap), DEFAULT_META)!
    expect(r.units[0].atk).toBe(s.units[0].atk)
    expect(r.units[0].atk).not.toBe(99999)
  })

  it('版本不符或關卡不存在時回傳 null（呼叫端當成沒有存檔）', () => {
    const s = createGame('julu', 1)
    const bad = { ...snapshotRun(s, 1), v: RUN_SAVE_VERSION + 1 }
    expect(restoreRun(bad, DEFAULT_META)).toBeNull()

    const gone = { ...snapshotRun(s, 1), levelKey: '已被刪除的關卡' }
    expect(restoreRun(gone, DEFAULT_META)).toBeNull()
  })

  it('快照是深拷貝：存檔之後繼續動 state 不會回頭改到存檔', () => {
    const s = createGame('julu', 2)
    s.units.push(makeGlyphUnit(s, '刀', 1, cellIndex(s.board, 0, 1)))
    recalcUnits(s)
    const snap = snapshotRun(s, 2)

    // 存檔之後這一局還會繼續跑，共用參考的話存檔會跟著一起變
    s.units[0].level = 5
    s.units.push(makeGlyphUnit(s, '弓', 1, cellIndex(s.board, 1, 1)))
    s.stats.kills += 10
    s.hand[0] = { char: '劍', level: 1 }

    expect(snap.units).toHaveLength(1)
    expect(snap.units[0].level).toBe(1)
    expect(snap.stats.kills).toBe(0)
    expect(snap.hand[0]).toBeNull()
  })
})

describe('每日挑戰', () => {
  it('同一個日期永遠得到同一份挑戰', () => {
    expect(dailyChallenge('2026-07-30')).toEqual(dailyChallenge('2026-07-30'))
  })

  it('不同日期會換關卡或換種子', () => {
    const days = ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03']
    const seeds = new Set(days.map((d) => dailyChallenge(d).seed))
    expect(seeds.size).toBe(days.length)
  })

  it('挑到的關卡一定在 LEVEL_ORDER 裡，且一年之內每一關都會輪到', () => {
    const seen = new Set<string>()
    const d = new Date(2026, 0, 1)
    for (let i = 0; i < 365; i++) {
      const c = dailyChallenge(dateKeyOf(d))
      expect(LEVEL_ORDER).toContain(c.levelKey)
      seen.add(c.levelKey)
      d.setDate(d.getDate() + 1)
    }
    expect(seen.size).toBe(LEVEL_ORDER.length)
  })

  it('同一天的挑戰可以真的開起來，而且兩次開出同一局', () => {
    const c = dailyChallenge('2026-07-30')
    const a = createGame(c.levelKey, c.seed, DEFAULT_META)
    const b = createGame(c.levelKey, c.seed, DEFAULT_META)
    run(a, 1200)
    run(b, 1200)
    expect(b.wave).toBe(a.wave)
    expect(b.stats).toEqual(a.stats)
    expect(a.pool).toEqual(b.pool)
  })

  it('dateKeyOf 用當地時區，不會因為 UTC 而早一天', () => {
    // 當地時間 1/1 00:30；toISOString 在 UTC+8 會變成前一年的 12/31
    expect(dateKeyOf(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
    expect(dateKeyOf(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31')
  })
})
