/**
 * 成就：達成條件後一次性發放聲望，是兵書／商城之外的第三個聲望來源。
 *
 * 設計骨架：**每個成就都是「一個計數器 >= 一個門檻」**，沒有布林條件。
 * 判定與 UI 進度條因此共用同一份 `progress()`（單一真相），
 * 布林類的成就就寫成「回傳 0 或 1、goal 為 1」。
 *
 * `scope` 決定計數器的時間範圍，也決定 UI 標籤：
 *   'run'    —— 只看目前這一局（state 為 null 時一律 0，因為選單畫面沒有局內狀態）
 *   'career' —— 看 MetaProgress，跨局累積，選單裡也看得到進度
 *
 * 平衡基準：全部 24 個成就共 2130 聲望，約等於 50～85 局的收入（一局 25～45）。
 * 刻意設在「兵書買滿 1230」與「商城買滿 13590」之間——足以明顯加速前中期的養成，
 * 但遠不足以跳過商城這個長期目標。⚠ 調整任何一項的獎勵都要回頭看這三個數字的關係。
 */
import { GENERALS } from './generals'
import { GLYPHS } from './glyphs'
import { LEVEL_ORDER } from './levels'
import type { MetaProgress } from '../sim/state'
import type { GameState } from '../sim/types'

/* 註：跨局計數器的型別 `RunTotals` 定義在 sim/state.ts 的 MetaProgress 旁邊，
   讓 data → sim 這條邊維持「只取型別、不反向」。 */

/** UI 的分區，順序即顯示順序 */
export type AchieveGroup = 'battle' | 'build' | 'collect' | 'journey'

export const GROUP_LABEL: Record<AchieveGroup, string> = {
  battle: '戰陣',
  build: '布陣',
  collect: '圖鑑',
  journey: '征途',
}

export const GROUP_ORDER: AchieveGroup[] = ['battle', 'build', 'collect', 'journey']

export interface AchievementDef {
  key: string
  name: string
  desc: string
  group: AchieveGroup
  /** 'run' 只看目前這一局，'career' 看跨局累積 */
  scope: 'run' | 'career'
  /** 達成門檻。判定一律是 progress() >= goal */
  goal: number
  /** 聲望獎勵，解鎖時一次性發放 */
  renown: number
  /**
   * 目前進度。**這是達成判定與 UI 進度條的唯一來源**。
   * state 為 null 代表玩家在選單畫面（沒有局內狀態），scope 為 'run' 的一律回 0。
   */
  progress: (state: GameState | null, meta: MetaProgress) => number
}

/** 場上武將數（字牌不算） */
function generalCount(s: GameState): number {
  return s.units.filter((u) => u.kind === 'general').length
}

/** 全部關卡最佳波次裡的最大值。沒有紀錄時為 0 */
function bestWave(meta: MetaProgress): number {
  const vs = Object.values(meta.best)
  return vs.length ? Math.max(...vs) : 0
}

/** 通關那一刻才計分的成就都用它包一層：沒贏就是 0 進度 */
function onWin(s: GameState | null, ok: (s: GameState) => boolean): number {
  return s && s.phase === 'won' && ok(s) ? 1 : 0
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // ── 戰陣：單局戰績。門檻對著「傻 AI 中位數 12～20 波」這條基準線設 ──
  {
    key: 'firstClear',
    name: '初陣告捷',
    desc: '通關任何一個關卡',
    group: 'battle',
    scope: 'career',
    goal: 1,
    renown: 30,
    progress: (_s, m) => m.cleared.length,
  },
  {
    key: 'noLeak',
    name: '滴水不漏',
    desc: '通關一局，且全程沒有任何敵人抵達大營',
    group: 'battle',
    scope: 'run',
    goal: 1,
    renown: 80,
    progress: (s) => onWin(s, (g) => g.stats.leaks === 0),
  },
  {
    key: 'flawless',
    name: '毫髮無傷',
    desc: '通關一局，且生命一點都沒掉',
    group: 'battle',
    scope: 'run',
    goal: 1,
    renown: 100,
    // 回魂旗擋下的漏怪不扣命，所以這個比「滴水不漏」寬鬆一點——刻意的，兩者不完全重疊
    progress: (s) => onWin(s, (g) => g.lives >= g.maxLives),
  },
  {
    key: 'lastStand',
    name: '力挽狂瀾',
    desc: '只剩 1 點生命時通關',
    group: 'battle',
    scope: 'run',
    goal: 1,
    renown: 80,
    progress: (s) => onWin(s, (g) => g.lives === 1),
  },
  {
    key: 'kills500',
    name: '破竹之勢',
    desc: '單局擊殺 500 名敵人',
    group: 'battle',
    scope: 'run',
    goal: 500,
    renown: 60,
    progress: (s) => s?.stats.kills ?? 0,
  },
  {
    key: 'kills1500',
    name: '屍山血海',
    desc: '單局擊殺 1500 名敵人',
    group: 'battle',
    scope: 'run',
    goal: 1500,
    renown: 100,
    progress: (s) => s?.stats.kills ?? 0,
  },
  {
    key: 'wave30',
    name: '長驅直入',
    desc: '在任一關撐到第 30 波',
    group: 'battle',
    scope: 'career',
    goal: 30,
    renown: 60,
    progress: (_s, m) => bestWave(m),
  },

  // ── 布陣：構築成就。每一項對應一個核心機制（疊階／組將／羈絆／十字成雙／經濟） ──
  {
    key: 'tier5',
    name: '五階登峰',
    desc: '把一個字牌疊到五階',
    group: 'build',
    scope: 'run',
    goal: 5,
    renown: 60,
    progress: (s) => (s ? Math.max(0, ...s.units.filter((u) => u.kind === 'glyph').map((u) => u.level)) : 0),
  },
  {
    key: 'legendary',
    name: '名將降世',
    desc: '組出一名傳說級武將',
    group: 'build',
    scope: 'run',
    goal: 1,
    renown: 50,
    progress: (s) =>
      s ? s.units.filter((u) => u.kind === 'general' && (u.tier === 'legendary' || u.tier === 'mythic')).length : 0,
  },
  {
    key: 'mythic',
    name: '神將臨凡',
    desc: '組出一名神話級武將',
    group: 'build',
    scope: 'run',
    goal: 1,
    renown: 120,
    progress: (s) => (s ? s.units.filter((u) => u.kind === 'general' && u.tier === 'mythic').length : 0),
  },
  {
    key: 'bond1',
    name: '羈絆初成',
    desc: '同時觸發 1 個羈絆',
    group: 'build',
    scope: 'run',
    goal: 1,
    renown: 30,
    progress: (s) => s?.activeBonds.length ?? 0,
  },
  {
    key: 'bond3',
    name: '三軍用命',
    desc: '同時觸發 3 個羈絆',
    group: 'build',
    scope: 'run',
    goal: 3,
    renown: 90,
    progress: (s) => s?.activeBonds.length ?? 0,
  },
  {
    key: 'generals8',
    name: '群將林立',
    desc: '場上同時有 8 名武將',
    group: 'build',
    scope: 'run',
    goal: 8,
    renown: 70,
    progress: (s) => (s ? generalCount(s) : 0),
  },
  {
    key: 'crossForm',
    name: '十字成雙',
    desc: '讓一個字同時屬於兩名武將（橫豎各一）',
    group: 'build',
    scope: 'run',
    goal: 1,
    renown: 50,
    progress: (s) => (s ? s.units.filter((u) => u.kind === 'glyph' && u.formIds.length >= 2).length : 0),
  },
  {
    key: 'food3000',
    name: '富甲一方',
    desc: '單局累計獲得 3000 糧',
    group: 'build',
    scope: 'run',
    goal: 3000,
    renown: 60,
    progress: (s) => s?.stats.foodEarned ?? 0,
  },

  // ── 圖鑑：收集進度。門檻取全表的 40% 與 100% 兩段 ──
  {
    key: 'glyphs30',
    name: '博聞強記',
    desc: '圖鑑收集 30 個字',
    group: 'collect',
    scope: 'career',
    goal: 30,
    renown: 40,
    progress: (_s, m) => m.seenGlyphs.length,
  },
  {
    key: 'glyphsAll',
    name: '學富五車',
    desc: '圖鑑收集全部的字',
    group: 'collect',
    scope: 'career',
    goal: GLYPHS.length,
    renown: 150,
    progress: (_s, m) => m.seenGlyphs.length,
  },
  {
    key: 'generals20',
    name: '群英譜',
    desc: '圖鑑組出 20 名武將',
    group: 'collect',
    scope: 'career',
    goal: 20,
    renown: 60,
    progress: (_s, m) => m.seenGenerals.length,
  },
  {
    key: 'generalsAll',
    name: '三國群英',
    desc: '圖鑑組出全部武將',
    group: 'collect',
    scope: 'career',
    goal: GENERALS.length,
    renown: 200,
    progress: (_s, m) => m.seenGenerals.length,
  },

  // ── 征途：跨局累積。這一區是長期目標，獎勵也最重 ──
  {
    key: 'runs50',
    name: '身經百戰',
    desc: '打完 50 局',
    group: 'journey',
    scope: 'career',
    goal: 50,
    renown: 60,
    progress: (_s, m) => m.totals.runs,
  },
  {
    key: 'runs200',
    name: '百戰之師',
    desc: '打完 200 局',
    group: 'journey',
    scope: 'career',
    goal: 200,
    renown: 150,
    progress: (_s, m) => m.totals.runs,
  },
  {
    key: 'killsTotal',
    name: '積屍成塔',
    desc: '累計擊殺 20000 名敵人',
    group: 'journey',
    scope: 'career',
    goal: 20000,
    renown: 120,
    progress: (_s, m) => m.totals.kills,
  },
  {
    key: 'handMax',
    name: '軍帳恢弘',
    desc: '把兵書的「軍帳擴編」買滿',
    group: 'journey',
    scope: 'career',
    goal: 8,
    renown: 60,
    progress: (_s, m) => m.handSize,
  },
  {
    key: 'clearAll',
    name: '天下歸心',
    desc: '通關全部關卡',
    group: 'journey',
    scope: 'career',
    goal: LEVEL_ORDER.length,
    renown: 250,
    progress: (_s, m) => m.cleared.length,
  },
]

export const ACHIEVEMENT_BY_KEY: Record<string, AchievementDef> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.key, a]),
)

/** 全部成就的聲望總和，供 UI 顯示與平衡對照 */
export const TOTAL_ACHIEVE_RENOWN = ACHIEVEMENTS.reduce((n, a) => n + a.renown, 0)

export function isUnlocked(meta: MetaProgress, key: string): boolean {
  return (meta.achievements[key] ?? 0) > 0
}

/** 已解鎖數量 */
export function unlockedCount(meta: MetaProgress): number {
  return ACHIEVEMENTS.filter((a) => isUnlocked(meta, a.key)).length
}

/**
 * 檢查全部成就，把新達成的解鎖並發放聲望。**原地改 meta**，回傳這次新解鎖的清單
 * （呼叫端負責 toast、音效與 saveMeta，慣例與 buyUpgrade／buyItem 一致）。
 *
 * 解鎖時存的值是「第幾個解鎖的」序號（1 起算）而不是時間戳：
 * UI 只需要解鎖順序，而序號不必碰 Date，資料表這一層因此維持純函式、可在測試裡重播。
 */
export function claimAchievements(meta: MetaProgress, state: GameState | null): AchievementDef[] {
  const got: AchievementDef[] = []
  let seq = Object.keys(meta.achievements).length
  for (const a of ACHIEVEMENTS) {
    if (isUnlocked(meta, a.key)) continue
    if (a.progress(state, meta) < a.goal) continue
    meta.achievements[a.key] = ++seq
    meta.renown += a.renown
    got.push(a)
  }
  return got
}
