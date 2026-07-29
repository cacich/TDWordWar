/**
 * 局內存檔：把進行到一半的 `GameState` 壓成純資料，之後精確還原。
 *
 * ★ 為什麼做得到：`GameState` 唯一不可序列化的東西是 `rng` 閉包，
 * 而 mulberry32 的**整個狀態就只有一個 uint32**（core/rng.ts），
 * 所以存下 `rng.getState()` 就夠了，不需要「存 seed + 重播整局」。
 *
 * ★ 還原策略是「**重建骨架 + 覆蓋可變欄位**」而不是逐欄反序列化：
 *   1. `createGame(levelKey, seed, meta)` 重建 `board`——地圖由 (關卡, 種子) 完全決定，
 *      所以不必存進存檔（隨機地圖也一樣，`generateMap` 吃的是同一顆種子）
 *   2. 把快照裡的可變欄位蓋回去
 *   3. `rng.setState()` 接回亂數流
 *   4. `recalcUnits()` 重算所有衍生值
 *
 * 因此**衍生值一律不存**（`activeBonds` / `cdMul` / `hints` / `hintCells` / `range` / `atk`…），
 * 存了反而會在資料表改版後變成過期的假資料。同理 `effects`（純視覺）與 `events`（每幀 drain）也不存。
 *
 * ⚠ 這個檔案必須維持**純函式、不碰 localStorage**——存取由 core/save.ts 負責，
 * 否則 `npm run sim` 與單元測試會因為 Node 沒有 localStorage 而炸掉。
 */
import { createGame, recalcUnits, type MetaProgress } from './state'
import type { GameState, HandCard, SpawnEntry, Unit } from './types'

/** 存檔格式版本。結構有破壞性改動時 +1，載入端會直接丟掉舊版 */
export const RUN_SAVE_VERSION = 3

export interface RunSnapshot {
  v: number
  levelKey: string
  seed: number
  /** mulberry32 的完整狀態（一個 uint32） */
  rngState: number
  /** 若這一局是每日挑戰，記下它的 dateKey，續玩後成績才記得回同一天 */
  dailyKey?: string
  units: Unit[]
  enemies: GameState['enemies']
  hand: (HandCard | null)[]
  handSize: number
  spawnQueue: SpawnEntry[]
  pool: string[]
  poolGenerals: string[]
  wishes: string[]
  wishSlots: number
  food: number
  lives: number
  maxLives: number
  wave: number
  phase: GameState['phase']
  prepTimer: number
  waveTime: number
  recruitsThisWave: number
  smeltFreeLeft: number
  lastIncome: GameState['lastIncome']
  bondCds: Record<string, number>
  nextUnitId: number
  nextEnemyId: number
  time: number
  stats: GameState['stats']
  perks: GameState['perks']
  meteorTimer: number
}

/**
 * 把目前的對局壓成快照。**只在 `phase` 是 `prep` 或 `battle` 時有意義**——
 * 已經分出勝負的局沒有續玩的必要，呼叫端應該直接清掉存檔。
 */
export function snapshotRun(state: GameState, seed: number, dailyKey?: string): RunSnapshot {
  return {
    v: RUN_SAVE_VERSION,
    levelKey: state.levelKey,
    seed,
    rngState: state.rng.getState(),
    ...(dailyKey ? { dailyKey } : {}),
    // 深拷貝：呼叫端存完之後這一局還會繼續跑，共用參考會讓存檔跟著變
    units: structuredClone(state.units),
    enemies: structuredClone(state.enemies),
    hand: structuredClone(state.hand),
    handSize: state.handSize,
    spawnQueue: structuredClone(state.spawnQueue),
    pool: [...state.pool],
    poolGenerals: [...state.poolGenerals],
    wishes: [...state.wishes],
    wishSlots: state.wishSlots,
    food: state.food,
    lives: state.lives,
    maxLives: state.maxLives,
    wave: state.wave,
    phase: state.phase,
    prepTimer: state.prepTimer,
    waveTime: state.waveTime,
    recruitsThisWave: state.recruitsThisWave,
    smeltFreeLeft: state.smeltFreeLeft,
    lastIncome: { ...state.lastIncome },
    bondCds: { ...state.bondCds },
    nextUnitId: state.nextUnitId,
    nextEnemyId: state.nextEnemyId,
    time: state.time,
    stats: { ...state.stats },
    perks: { ...state.perks },
    meteorTimer: state.meteorTimer,
  }
}

/**
 * 從快照還原對局。`meta` 只用來重建骨架（棋盤），
 * **局內的 perks／手牌大小一律取快照裡的值**——否則存檔期間買的道具會回溯生效，
 * 違反「商城效果只在下一局開始套用」這條既有規則。
 *
 * 回傳 `null` 代表存檔不可用（版本不符、關卡已被刪除等），呼叫端應該當成沒有存檔。
 */
export function restoreRun(snap: RunSnapshot, meta: MetaProgress): GameState | null {
  if (!snap || snap.v !== RUN_SAVE_VERSION) return null
  let state: GameState
  try {
    // 只借它重建 board（由 levelKey + seed 完全決定），其餘欄位馬上被覆蓋
    state = createGame(snap.levelKey, snap.seed, meta)
  } catch {
    return null // 關卡被刪掉或改名
  }

  state.units = snap.units
  state.enemies = snap.enemies
  state.hand = snap.hand
  state.handSize = snap.handSize
  state.spawnQueue = snap.spawnQueue
  state.pool = snap.pool
  state.poolGenerals = snap.poolGenerals
  state.wishes = snap.wishes
  state.wishSlots = snap.wishSlots
  state.food = snap.food
  state.lives = snap.lives
  state.maxLives = snap.maxLives
  state.wave = snap.wave
  state.phase = snap.phase
  state.prepTimer = snap.prepTimer
  state.waveTime = snap.waveTime
  state.recruitsThisWave = snap.recruitsThisWave
  state.smeltFreeLeft = snap.smeltFreeLeft
  state.lastIncome = snap.lastIncome
  state.bondCds = snap.bondCds
  state.nextUnitId = snap.nextUnitId
  state.nextEnemyId = snap.nextEnemyId
  state.time = snap.time
  state.stats = snap.stats
  state.perks = snap.perks
  state.meteorTimer = snap.meteorTimer
  // 視覺佇列刻意不存，重建成空的
  state.effects = []
  state.events = []

  // 亂數流接回存檔當下的位置——這是「同種子可重現」在續玩之後仍然成立的關鍵
  state.rng.setState(snap.rngState)
  // 衍生值（羈絆、光環、實效攻防、組詞提示）全部重算，不從存檔讀
  recalcUnits(state)
  return state
}
