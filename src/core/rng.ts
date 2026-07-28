/**
 * 種子隨機。同一顆種子 → 同一場對局，bug 可 100% 重現。
 * 全專案禁止使用 Math.random()，一律走此模組。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
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
