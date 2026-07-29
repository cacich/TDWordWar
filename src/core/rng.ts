/**
 * 種子隨機。同一顆種子 → 同一場對局，bug 可 100% 重現。
 * 全專案禁止使用 Math.random()，一律走此模組。
 *
 * `Rng` 介面定義在 sim/types.ts（型別集中在那裡，且 types.ts 不 import 任何東西）。
 */
import type { Rng } from '../sim/types'
/**
 * 建立亂數產生器。**整個產生器的狀態就只有一個 uint32**，
 * 所以透過 `getState`／`setState` 就能精確存續一局進行到一半的對局，
 * 不必重播整局（見 core/save.ts 的局內存檔）。
 *
 * ⚠ 回傳值仍然可以直接當函式呼叫（`state.rng()`），既有程式碼不受影響。
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  const next = function (): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  } as Rng
  next.getState = () => a
  next.setState = (v: number) => {
    a = v >>> 0
  }
  return next
}

export function pickWeighted<T>(rng: () => number, items: T[], weight: (it: T) => number): T {
  let total = 0
  for (const it of items) total += weight(it)
  let r = rng() * total
  for (const it of items) {
    r -= weight(it)
    if (r <= 0) return it
  }
  return items[items.length - 1]
}

export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}
