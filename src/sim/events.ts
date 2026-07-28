/**
 * 事件佇列的推入端。
 * 刻意獨立成一個只依賴 types 的小模組——如果把 emit() 放在 state.ts，
 * combat.ts 就會與 state.ts 互相 import 形成循環依賴。
 */
import { MAX_EVENTS, type GameState, type SimEvent } from './types'

/** 推入一筆事件供 app 層播音效／噴粒子。超過上限就丟棄（純視聽用途，不影響模擬） */
export function emit(state: GameState, ev: SimEvent): void {
  if (state.events.length >= MAX_EVENTS) return
  state.events.push(ev)
}
