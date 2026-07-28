/**
 * 每局的字池（M4b）。
 *
 * ★ 問題：字表有 53 個字，全部丟進抽卡池的話「想疊高某個字」或「想湊某個武將」的機率極低，
 *   玩家會覺得抽卡沒有方向感。
 *
 * ★ 解法：每一局只啟用其中一部分字，而且**姓名字是成組加入的**——
 *   選中「張飛」這個配方，就把「張」和「飛」一起放進池子。
 *   於是池子裡不會出現湊不成任何配方的孤兒字，池子變小也讓每個字更容易重複抽到。
 *
 *   兵器與兵種字永遠在池內（它們是骨幹，也是「兵」系部隊的來源）。
 *
 * 同一顆種子必然產生同一個字池，所以整場對局仍然可完整重現。
 */
import { GENERALS } from '../data/generals'
import { GLYPHS } from '../data/glyphs'
import type { LevelDef } from '../data/levels'

export interface GlyphPool {
  chars: string[]
  /** 這個池子理論上可以組出的武將名稱（給 UI 顯示「本局可湊」） */
  generals: string[]
}

/** 從 list 隨機取 n 個（不重複），順序穩定由 rng 決定 */
function sample<T>(rng: () => number, list: readonly T[], n: number): T[] {
  const pool = [...list]
  const out: T[] = []
  const take = Math.min(n, pool.length)
  for (let i = 0; i < take; i++) {
    const k = Math.floor(rng() * pool.length)
    out.push(pool.splice(k, 1)[0])
  }
  return out
}

const ALWAYS = GLYPHS.filter((g) => g.category === 'weapon' || g.category === 'troop').map((g) => g.char)
const SUPPORT = GLYPHS.filter((g) => g.category === 'strategy' || g.category === 'economy').map((g) => g.char)
/** 由姓氏／名字組成的配方——它們才需要「成組加入」 */
const NAMED_RECIPES = GENERALS.filter((g) =>
  g.recipe.every((ch) => {
    const def = GLYPHS.find((x) => x.char === ch)
    return def?.category === 'surname' || def?.category === 'given'
  }),
)

export function buildGlyphPool(rng: () => number, level: LevelDef): GlyphPool {
  const chars = new Set<string>(ALWAYS)

  for (const ch of sample(rng, SUPPORT, level.pool.support)) chars.add(ch)
  for (const def of sample(rng, NAMED_RECIPES, level.pool.generals)) {
    for (const ch of def.recipe) chars.add(ch)
  }

  // 池子裡的字能湊出哪些武將（含兵種部隊與謀略組合）
  const generals = GENERALS.filter((g) => g.recipe.every((ch) => chars.has(ch))).map((g) => g.name)

  return { chars: [...chars], generals }
}
