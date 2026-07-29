/**
 * 每日挑戰：所有人在同一天玩到**完全相同的一局**。
 *
 * 本專案已經保證「同種子 → 同一場對局」（core/rng.ts 的 mulberry32），
 * 所以只要用日期算出種子就成立，不需要伺服器、不需要對戰同步。
 *
 * ★ 這個檔案是純函式：**日期字串由呼叫端傳進來**，不在這裡讀 `Date`。
 * 理由跟 sim/ 禁用 `Date.now()` 一樣——可測試、可重播。
 * app 層負責取今天的日期（見 app.ts 的 `todayKey()`）。
 *
 * ⚠ **每日挑戰一律使用中性 meta**（不套用兵書／商城／編隊），這不只是公平問題，
 * 更是**重現性的必要條件**：
 *   - 編隊會讓 `buildGlyphPool` 不消耗 rng（sim/pool.ts:59 直接 return）
 *   - 商城的精兵符每張牌都會抽一次 rng（sim/actions.ts）
 *   - 兵書的手牌格數決定每次征兵抽幾張 → 直接改變 rng 的消耗量
 * 任何一項不同，同一顆種子就會長出不同的對局。
 */
import { LEVEL_ORDER } from './levels'

/** 一天的挑戰內容。由 `dailyChallenge(dateKey)` 推導，同一個 dateKey 永遠得到同一份 */
export interface DailyChallenge {
  /** 'YYYY-MM-DD'，同時是 meta.daily 的鍵 */
  dateKey: string
  levelKey: string
  seed: number
}

/** 把 'YYYY-MM-DD' 打成 uint32 種子。FNV-1a，夠散且完全決定性 */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * 依日期推導出當天的挑戰。關卡在 `LEVEL_ORDER` 上輪替，
 * 讓每天的地形與敵人偏好都不一樣（而不是永遠打同一關）。
 */
export function dailyChallenge(dateKey: string): DailyChallenge {
  const h = hash(dateKey)
  return {
    dateKey,
    // 用另一個位元段挑關卡，避免關卡與種子完全連動（同一關總是配到相近的種子）
    levelKey: LEVEL_ORDER[(h >>> 8) % LEVEL_ORDER.length],
    seed: h,
  }
}

/** 把 Date 轉成當地時區的 'YYYY-MM-DD'。⚠ 不能用 toISOString（那是 UTC，跨日會早於當地） */
export function dateKeyOf(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
