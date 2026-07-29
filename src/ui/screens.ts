/**
 * 全螢幕畫面（七個）：選單 menu／圖鑑 codex／兵書 forge／商城 shop／編隊 loadout／
 * 成就 achieve／開發密技 dev。
 * 由 show(ScreenName) 統一切換，一次只顯示一個；screen === null 代表回到對局畫面。
 * 與 hud.ts 一樣只碰 DOM，所有狀態變更都經由 ScreensHost 交回 app 層。
 */
import {
  ACHIEVEMENTS,
  GROUP_LABEL,
  GROUP_ORDER,
  TOTAL_ACHIEVE_RENOWN,
  isUnlocked,
  unlockedCount,
} from '../data/achievements'
import { BONDS } from '../data/bonds'
import { BOSSES, COUNTER_LABEL, ENEMY_BY_KEY, REGULARS, TRAIT_LABEL, countersFor } from '../data/enemies'
import { GENERALS, generalsUsing } from '../data/generals'
import { GLYPHS, qualityName } from '../data/glyphs'
import { LEVELS, LEVEL_ORDER } from '../data/levels'
import { isGeneralUnlocked } from '../data/loadout'
import { UPGRADES } from '../data/upgrades'
import { SHOP, itemLevel } from '../data/shop'
import { TIER_COLOR, TIER_LABEL } from '../render/theme'
import { FX_COLOR } from '../render/fx'
import { COMBOS } from '../sim/skills'
import { MAX_LOADOUT_GENERALS, MAX_LOADOUT_GLYPHS, type MetaProgress } from '../sim/state'
import type { BondDef, GlyphCategory } from '../sim/types'

type CodexTab = 'glyph' | 'general' | 'enemy'

export type ScreenName = 'menu' | 'codex' | 'forge' | 'shop' | 'dev' | 'loadout' | 'achieve' | 'daily' | null

export interface ScreensHost {
  getMeta(): MetaProgress
  /**
   * 成就進度快照（key → 目前計數）。由 app 層算好再交過來，
   * 這樣本檔維持「完全不碰 GameState」的性質。
   */
  achieveProgress(): Record<string, number>
  startLevel(key: string): void
  // ── 每日挑戰與續玩（見 data/daily.ts、sim/persist.ts） ──
  /** 今天的挑戰內容（關卡與種子由日期推導） */
  todayChallenge(): { dateKey: string; levelKey: string; seed: number }
  startDaily(): void
  /** 目前有沒有可續玩的局內存檔；沒有回傳 null */
  savedRun(): { levelName: string; wave: number; maxWave: number; daily: boolean } | null
  resumeRun(): void
  dropRun(): void
  show(screen: ScreenName): void
  buyUpgrade(key: string): void
  buyItem(key: string): void
  // ── 開發密技（見 core/devtools.ts） ──
  devAddRenown(amount: number): void
  devAddFood(amount: number): void
  devFullHeal(): void
  devClearBoard(): void
  devClearEnemies(): void
  devUnlockCodex(): void
  devGiveGlyph(char: string): void
  // ── 編隊（見 data/loadout.ts） ──
  setLoadoutActive(active: boolean): void
  toggleLoadoutGlyph(char: string): void
  toggleLoadoutGeneral(name: string): void
}

const CATEGORY_TITLE: Record<GlyphCategory, string> = {
  weapon: '兵器',
  troop: '兵種',
  strategy: '謀略',
  economy: '經濟',
  surname: '姓氏',
  given: '名字',
}

const CATEGORY_ORDER: GlyphCategory[] = ['weapon', 'troop', 'strategy', 'economy', 'surname', 'given']
/** 稀有度由高到低，圖鑑與編隊的武將分區都用這個順序 */
const TIER_DISPLAY_ORDER = ['mythic', 'legendary', 'epic', 'fine', 'common'] as const
/** 編隊「攜帶的字」只列這些類別——姓氏／名字要透過「攜帶的武將」帶入，見 data/loadout.ts */
const LOADOUT_GLYPH_CATEGORIES: GlyphCategory[] = ['weapon', 'troop', 'strategy', 'economy']

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id)
  if (!e) throw new Error(`缺少 DOM 節點 #${id}`)
  return e as T
}

export class Screens {
  private menu = el('screen-menu')
  private codex = el('screen-codex')
  private forge = el('screen-forge')
  private forgeBody = el('forge-body')
  private forgeRenown = el('forge-renown')
  private shop = el('screen-shop')
  private shopBody = el('shop-body')
  private shopRenown = el('shop-renown')
  private dev = el('screen-dev')
  private devBody = el('dev-body')
  private loadout = el('screen-loadout')
  private loadoutBody = el('loadout-body')
  private daily = el('screen-daily')
  private dailyBody = el('daily-body')
  private dailyDate = el('daily-date')
  private achieve = el('screen-achieve')
  private achieveBody = el('achieve-body')
  private achieveCount = el('achieve-count')
  private renownCount = el('renown-count')
  private levelList = el('level-list')
  private codexBody = el('codex-body')
  private codexCount = el('codex-count')
  private tabGlyph = el('tab-glyph')
  private tabGeneral = el('tab-general')
  private tabEnemy = el('tab-enemy')
  private tab: CodexTab = 'glyph'
  private current: ScreenName = null
  /** 選單標題連點次數，用來偷偷打開開發密技面板 */
  private titleTaps = 0
  private titleTapAt = 0

  constructor(private host: ScreensHost) {
    el('btn-codex').addEventListener('click', () => this.host.show('codex'))
    el('codex-back').addEventListener('click', () => this.host.show('menu'))
    el('btn-forge').addEventListener('click', () => this.host.show('forge'))
    el('forge-back').addEventListener('click', () => this.host.show('menu'))
    el('btn-shop').addEventListener('click', () => this.host.show('shop'))
    el('shop-back').addEventListener('click', () => this.host.show('menu'))
    el('dev-back').addEventListener('click', () => this.host.show('menu'))
    el('btn-loadout').addEventListener('click', () => this.host.show('loadout'))
    el('loadout-back').addEventListener('click', () => this.host.show('menu'))
    el('btn-achieve').addEventListener('click', () => this.host.show('achieve'))
    el('achieve-back').addEventListener('click', () => this.host.show('menu'))
    el('btn-daily').addEventListener('click', () => this.host.show('daily'))
    el('daily-back').addEventListener('click', () => this.host.show('menu'))
    el('menu-title').addEventListener('click', () => this.handleTitleTap())
    this.tabGlyph.addEventListener('click', () => this.setTab('glyph'))
    this.tabGeneral.addEventListener('click', () => this.setTab('general'))
    this.tabEnemy.addEventListener('click', () => this.setTab('enemy'))
  }

  /** 開發密技彩蛋：選單標題在 2.5 秒內連點 7 下開啟面板（Android 開發者選項的老把戲） */
  private handleTitleTap(): void {
    const now = performance.now()
    if (now - this.titleTapAt > 2500) this.titleTaps = 0
    this.titleTapAt = now
    this.titleTaps++
    if (this.titleTaps >= 7) {
      this.titleTaps = 0
      this.host.show('dev')
    }
  }

  show(screen: ScreenName): void {
    this.current = screen
    this.menu.hidden = screen !== 'menu'
    this.codex.hidden = screen !== 'codex'
    this.forge.hidden = screen !== 'forge'
    this.shop.hidden = screen !== 'shop'
    this.dev.hidden = screen !== 'dev'
    this.loadout.hidden = screen !== 'loadout'
    this.achieve.hidden = screen !== 'achieve'
    this.daily.hidden = screen !== 'daily'
    if (screen === 'menu') this.renderMenu()
    if (screen === 'codex') this.renderCodex()
    if (screen === 'forge') this.renderForge()
    if (screen === 'shop') this.renderShop()
    if (screen === 'dev') this.renderDev()
    if (screen === 'loadout') this.renderLoadout()
    if (screen === 'achieve') this.renderAchieve()
    if (screen === 'daily') this.renderDaily()
  }

  /**
   * 成就：依 group 分區列出，每一項都畫進度條。
   * 進度與達成判定共用 def.progress()／def.goal，所以進度條不可能跟解鎖狀態說法不一致。
   */
  renderAchieve(): void {
    const meta = this.host.getMeta()
    const prog = this.host.achieveProgress()
    const done = unlockedCount(meta)
    const earned = ACHIEVEMENTS.filter((a) => isUnlocked(meta, a.key)).reduce((n, a) => n + a.renown, 0)
    this.achieveCount.textContent = `${done}/${ACHIEVEMENTS.length}　聲望 ${earned}/${TOTAL_ACHIEVE_RENOWN}`
    this.achieveBody.innerHTML = ''

    for (const group of GROUP_ORDER) {
      const list = ACHIEVEMENTS.filter((a) => a.group === group)
      if (!list.length) continue
      const head = document.createElement('div')
      head.className = 'codex-section'
      head.textContent = `${GROUP_LABEL[group]}（${list.filter((a) => isUnlocked(meta, a.key)).length}/${list.length}）`
      this.achieveBody.appendChild(head)

      for (const a of list) {
        const got = isUnlocked(meta, a.key)
        // 已解鎖就不必再算一次進度（有些 scope:'run' 的成就在選單裡會算出 0，會看起來像倒退）
        const cur = got ? a.goal : Math.min(a.goal, Math.max(0, Math.floor(prog[a.key] ?? 0)))
        const pctDone = Math.round((cur / a.goal) * 100)
        const row = document.createElement('div')
        row.className = `achieve-row${got ? ' done' : ''}`
        const scopeTag = a.scope === 'run' ? '<span class="ac-scope">單局</span>' : ''
        // 門檻為 1 的是「做到就解鎖」，畫成數字進度條只會看到 0/1，沒有資訊量
        const counter = a.goal > 1 ? `<span class="ac-num">${cur}/${a.goal}</span>` : ''
        row.innerHTML = `<div class="ac-mark">${got ? '✓' : '　'}</div>
          <div class="ac-main">
            <div class="ac-name">${a.name}${scopeTag}<span class="ac-renown">聲望 +${a.renown}</span></div>
            <div class="fg-desc">${a.desc}</div>
            <div class="ac-bar"><span style="width:${pctDone}%"></span></div>
          </div>
          ${counter}`
        this.achieveBody.appendChild(row)
      }
    }

    const note = document.createElement('div')
    note.className = 'codex-detail'
    note.innerHTML =
      '成就達成時<b>立即發放聲望</b>，每項只發一次。<br>' +
      '<span class="muted">標「單局」的只看目前這一局；其餘會跨局累積，回到選單也看得到進度。' +
      '「征途」類的局數與擊殺只計入<b>打完</b>的局（中途離開不算）。</span>'
    this.achieveBody.appendChild(note)
  }

  /**
   * 每日挑戰：關卡與種子都由日期推導，所以同一天全世界玩到同一局。
   * 這一頁的重點是把「為什麼不套用養成」講清楚——否則玩家會以為道具壞掉了。
   */
  private renderDaily(): void {
    const meta = this.host.getMeta()
    const c = this.host.todayChallenge()
    const lv = LEVELS[c.levelKey]
    const best = meta.daily[c.dateKey] ?? 0
    this.dailyDate.textContent = c.dateKey
    this.dailyBody.innerHTML = ''

    const card = document.createElement('button')
    card.className = 'level-card'
    card.innerHTML = `<div>
        <div class="lv-name">${lv.name}</div>
        <div class="lv-sub">${lv.subtitle}</div>
        <div class="lv-tips"><span class="lv-tip-label">建議帶</span>${countersFor(lv.bias)
          .map((x) => `<span class="lv-tip">${COUNTER_LABEL[x]}</span>`)
          .join('')}</div>
      </div>
      <div class="lv-meta">
        ${best ? `<div class="lv-best">今日最佳 ${best} 波</div>` : '<div class="lv-best">尚未挑戰</div>'}
        <div class="lv-wave">${lv.maxWave} 波</div>
      </div>`
    card.addEventListener('click', () => this.host.startDaily())
    this.dailyBody.appendChild(card)

    const note = document.createElement('div')
    note.className = 'codex-detail'
    note.innerHTML =
      '每天換一關與一顆種子，<b>同一天所有人玩到的是完全相同的一局</b>——地圖、字池、出怪順序全都一樣。<br>' +
      '<span class="muted">⚠ 每日挑戰<b>不套用</b>兵書、商城道具與編隊。這不只是公平：手牌格數與精兵符都會' +
      '改變亂數的消耗量，任何一項不同，同一顆種子就會長出不同的一局。</span>'
    this.dailyBody.appendChild(note)

    // 最近幾天的成績，讓玩家看得出自己有沒有進步
    const past = Object.entries(meta.daily)
      .filter(([d]) => d !== c.dateKey)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 7)
    if (past.length) {
      this.dailyBody.appendChild(section('過往成績'))
      const list = document.createElement('div')
      list.className = 'bond-list'
      list.innerHTML = past.map(([d, w]) => `<div class="bond-row">${d}　<b>${w}</b> 波</div>`).join('')
      this.dailyBody.appendChild(list)
    }
  }

  /** 商城：花聲望買被動道具，每種最高 3 級，買一級生效一級 */
  renderShop(): void {
    const meta = this.host.getMeta()
    this.shopRenown.textContent = `聲望 ${meta.renown}`
    this.shopBody.innerHTML = ''
    for (const item of SHOP) {
      const lv = itemLevel(meta, item.key)
      const maxed = lv >= item.max
      const cost = maxed ? 0 : item.cost(lv)
      const detailLines = [`<div class="fg-desc">${item.desc}</div>`]
      if (lv > 0) detailLines.push(`<div class="fg-desc">目前：${item.detail(lv)}</div>`)
      if (!maxed) detailLines.push(`<div class="fg-desc">下一級：${item.detail(lv + 1)}</div>`)
      const row = document.createElement('div')
      row.className = 'forge-row'
      row.innerHTML = `<div>
          <div class="fg-name">${item.name} <span class="muted">Lv.${lv}/${item.max}</span></div>
          ${detailLines.join('')}
        </div>`
      const btn = document.createElement('button')
      btn.textContent = maxed ? '已滿級' : `聲望 ${cost}`
      btn.disabled = maxed || meta.renown < cost
      btn.addEventListener('click', () => this.host.buyItem(item.key))
      row.appendChild(btn)
      this.shopBody.appendChild(row)
    }
    const note = document.createElement('div')
    note.className = 'codex-detail'
    note.innerHTML =
      '每種道具最高 3 級，買一級生效一級，皆為被動效果，<b>下一局開始</b>套用。<br>' +
      '<span class="muted">聲望與兵書共用，於每局結束依抵達波次結算。</span>'
    this.shopBody.appendChild(note)
  }

  /** 開發密技面板：測試用直接竄改 state／meta，不經過 sim/actions.ts 的驗證 */
  private renderDev(): void {
    this.devBody.innerHTML = ''

    const note = document.createElement('div')
    note.className = 'codex-detail'
    note.innerHTML = '僅供測試，效果不計入商城／兵書平衡，正式遊玩請勿使用。'
    this.devBody.appendChild(note)

    const actions: { label: string; run: () => void }[] = [
      { label: '+1000 聲望', run: () => this.host.devAddRenown(1000) },
      { label: '+500 糧', run: () => this.host.devAddFood(500) },
      { label: '生命全滿', run: () => this.host.devFullHeal() },
      { label: '清空棋盤字牌', run: () => this.host.devClearBoard() },
      { label: '清空敵人／跳下一波', run: () => this.host.devClearEnemies() },
      { label: '全圖鑑解鎖', run: () => this.host.devUnlockCodex() },
    ]
    const bar = document.createElement('div')
    bar.className = 'dev-actions'
    for (const a of actions) {
      const btn = document.createElement('button')
      btn.textContent = a.label
      btn.addEventListener('click', a.run)
      bar.appendChild(btn)
    }
    this.devBody.appendChild(bar)

    const label = document.createElement('div')
    label.className = 'codex-section'
    label.textContent = '點一下直接塞進手牌（一階）'
    this.devBody.appendChild(label)

    const grid = document.createElement('div')
    grid.className = 'codex-grid'
    for (const g of GLYPHS) {
      const cell = document.createElement('div')
      cell.className = 'codex-cell'
      cell.innerHTML = `<div class="cx-char">${g.char}</div>`
      cell.addEventListener('click', () => this.host.devGiveGlyph(g.char))
      grid.appendChild(cell)
    }
    this.devBody.appendChild(grid)
  }

  /**
   * 編隊：從已解鎖的字／武將裡挑選字池內容，取代原本每局隨機抽樣。
   * 只列出「已解鎖」的項目可選；還沒解鎖過的字不受影響，會繼續出現讓玩家探索。
   */
  renderLoadout(): void {
    const meta = this.host.getMeta()
    this.loadoutBody.innerHTML = ''

    const toggle = document.createElement('button')
    toggle.className = `loadout-toggle${meta.loadoutActive ? ' active' : ''}`
    toggle.innerHTML = `<span class="switch-track"><span class="switch-knob"></span></span>
      <span class="switch-label">編隊限制</span>
      <span class="switch-state">${meta.loadoutActive ? '已啟用' : '未啟用'}</span>`
    toggle.addEventListener('click', () => this.host.setLoadoutActive(!meta.loadoutActive))
    this.loadoutBody.appendChild(toggle)

    const note = document.createElement('div')
    note.className = 'codex-detail'
    note.innerHTML =
      '啟用後，字池只會出現下面選的字與武將，加上<b>還沒解鎖過</b>的字（讓你能繼續發現新內容）。<br>' +
      '<span class="muted">已解鎖但沒被選進來的字／武將不會出現在字池裡；不必選滿也沒關係。</span>'
    this.loadoutBody.appendChild(note)

    // 攜帶的字：按類別分區；姓氏／名字不列在這裡，只能透過下面的「攜帶的武將」帶入
    const glyphSeen = new Set(meta.seenGlyphs)
    this.loadoutBody.appendChild(section(`攜帶的字　${meta.loadoutGlyphs.length}/${MAX_LOADOUT_GLYPHS}`))
    let anyGlyph = false
    for (const cat of LOADOUT_GLYPH_CATEGORIES) {
      const list = GLYPHS.filter((g) => g.category === cat && glyphSeen.has(g.char))
      if (!list.length) continue
      anyGlyph = true
      this.loadoutBody.appendChild(section(CATEGORY_TITLE[cat]))
      const grid = document.createElement('div')
      grid.className = 'codex-grid'
      for (const g of list) {
        const selected = meta.loadoutGlyphs.includes(g.char)
        const cell = document.createElement('div')
        cell.className = `codex-cell${selected ? ' selected' : ''}`
        const color = g.fx && g.fx !== 'none' ? FX_COLOR[g.fx] : '#2b2b2b'
        cell.innerHTML = `<div class="cx-char" style="color:${color}">${selected ? '★' : ''}${g.char}</div>
          <div class="cx-name">${g.income ? `糧${g.income}` : g.atk > 0 ? `攻${g.atk}` : '輔助'}</div>`
        cell.addEventListener('click', () => this.host.toggleLoadoutGlyph(g.char))
        grid.appendChild(cell)
      }
      this.loadoutBody.appendChild(grid)
    }
    if (!anyGlyph) {
      const empty = document.createElement('div')
      empty.className = 'muted'
      empty.textContent = '還沒解鎖任何可帶的字，先去玩一局吧。'
      this.loadoutBody.appendChild(empty)
    }

    // 攜帶的武將：按稀有度分區；配方的字都已解鎖過就算解鎖，不必真的湊出來過
    this.loadoutBody.appendChild(section(`攜帶的武將　${meta.loadoutGenerals.length}/${MAX_LOADOUT_GENERALS}`))
    let anyGeneral = false
    for (const tier of TIER_DISPLAY_ORDER) {
      const list = GENERALS.filter(
        (g) => g.tier === tier && isGeneralUnlocked(meta.seenGlyphs, meta.seenGenerals, g.name),
      )
      if (!list.length) continue
      anyGeneral = true
      this.loadoutBody.appendChild(section(TIER_LABEL[tier]))
      const grid = document.createElement('div')
      grid.className = 'codex-grid'
      for (const g of list) {
        const selected = meta.loadoutGenerals.includes(g.name)
        const cell = document.createElement('div')
        cell.className = `codex-cell${selected ? ' selected' : ''}`
        cell.innerHTML = `<div class="cx-char" style="font-size:15px;color:${TIER_COLOR[g.tier]}">${selected ? '★' : ''}${g.name}</div>
          <div class="cx-name">${g.recipe.join('＋')}</div>`
        cell.addEventListener('click', () => this.host.toggleLoadoutGeneral(g.name))
        grid.appendChild(cell)
      }
      this.loadoutBody.appendChild(grid)
    }
    if (!anyGeneral) {
      const empty = document.createElement('div')
      empty.className = 'muted'
      empty.textContent = '還沒解鎖任何武將，先去玩一局吧。'
      this.loadoutBody.appendChild(empty)
    }
  }

  /** 兵書：局外養成 */
  renderForge(): void {
    const meta = this.host.getMeta()
    this.forgeRenown.textContent = `聲望 ${meta.renown}`
    this.forgeBody.innerHTML = ''
    for (const up of UPGRADES) {
      const lv = up.level(meta)
      const maxed = lv >= up.max
      const cost = maxed ? 0 : up.cost(lv)
      const row = document.createElement('div')
      row.className = 'forge-row'
      row.innerHTML = `<div>
          <div class="fg-name">${up.name} <span class="muted">${lv}/${up.max}</span></div>
          <div class="fg-desc">${up.desc}</div>
        </div>`
      const btn = document.createElement('button')
      btn.textContent = maxed ? '已滿' : `聲望 ${cost}`
      btn.disabled = maxed || meta.renown < cost
      btn.addEventListener('click', () => this.host.buyUpgrade(up.key))
      row.appendChild(btn)
      this.forgeBody.appendChild(row)
    }
    const note = document.createElement('div')
    note.className = 'codex-detail'
    note.innerHTML =
      '聲望在每局結束時依抵達波次結算（通關另有獎勵），失敗也會拿到。<br>' +
      '<span class="muted">升級立即生效，下一局開始套用。</span>'
    this.forgeBody.appendChild(note)
  }

  get visible(): boolean {
    return this.current !== null
  }

  // ── 選關 ──────────────────────────────────────────
  private renderMenu(): void {
    const meta = this.host.getMeta()
    this.levelList.innerHTML = ''

    // 續玩卡片放在最上面：有沒打完的局時，那幾乎一定是玩家最想做的事
    const run = this.host.savedRun()
    if (run) {
      const card = document.createElement('button')
      card.className = 'resume-card'
      card.innerHTML = `<div>
          <div class="rs-title">繼續上一局</div>
          <div class="rs-sub">${run.daily ? '每日挑戰・' : ''}${run.levelName}　第 ${run.wave} / ${run.maxWave} 波</div>
        </div>
        <div class="rs-go">▶</div>`
      card.addEventListener('click', () => this.host.resumeRun())
      this.levelList.appendChild(card)

      // 明確給一個放棄的出口，否則玩家想重開同一關會不知道怎麼擺脫這張卡
      const drop = document.createElement('button')
      drop.className = 'resume-drop'
      drop.textContent = '放棄這局存檔'
      drop.addEventListener('click', () => this.host.dropRun())
      this.levelList.appendChild(drop)
    }

    LEVEL_ORDER.forEach((key, i) => {
      const level = LEVELS[key]
      const cleared = meta.cleared.includes(key)
      // 第一關永遠開放；其餘要前一關通關才解鎖
      const unlocked = i === 0 || meta.cleared.includes(LEVEL_ORDER[i - 1])
      const best = meta.best[key] ?? 0

      // 推薦手段由關卡的 bias 經 TRAIT_COUNTERS 推導，不是另外手寫的清單
      const counters = countersFor(level.bias)
      const tips = counters.map((c) => `<span class="lv-tip">${COUNTER_LABEL[c]}</span>`).join('')

      const card = document.createElement('button')
      card.className = `level-card${unlocked ? '' : ' locked'}${level.gen ? ' random' : ''}`
      card.disabled = !unlocked
      card.innerHTML = `
        <div>
          <div class="lv-name">${level.name}</div>
          <div class="lv-sub">${unlocked ? level.subtitle : `通關「${LEVELS[LEVEL_ORDER[i - 1]].name}」後解鎖`}</div>
          ${unlocked && tips ? `<div class="lv-tips"><span class="lv-tip-label">建議帶</span>${tips}</div>` : ''}
        </div>
        <div class="lv-meta">
          ${cleared ? '<div class="lv-cleared">已通關</div>' : ''}
          <div>${level.maxWave} 波</div>
          <div>難度 ×${level.hpMul.toFixed(2)}</div>
          ${best ? `<div>最佳 ${best} 波</div>` : ''}
        </div>`
      if (unlocked) card.addEventListener('click', () => this.host.startLevel(key))
      this.levelList.appendChild(card)
    })

    const seen = meta.seenGlyphs.length + meta.seenGenerals.length
    this.codexCount.textContent = `已收集 ${seen} / ${GLYPHS.length + GENERALS.length}`
    this.renownCount.textContent = `聲望 ${meta.renown}`
  }

  // ── 圖鑑 ──────────────────────────────────────────
  private setTab(tab: CodexTab): void {
    this.tab = tab
    this.tabGlyph.classList.toggle('active', tab === 'glyph')
    this.tabGeneral.classList.toggle('active', tab === 'general')
    this.tabEnemy.classList.toggle('active', tab === 'enemy')
    this.renderCodex()
  }

  private renderCodex(): void {
    const meta = this.host.getMeta()
    this.codexBody.innerHTML = ''

    if (this.tab === 'glyph') {
      const seen = new Set(meta.seenGlyphs)
      for (const cat of CATEGORY_ORDER) {
        const list = GLYPHS.filter((g) => g.category === cat)
        if (!list.length) continue
        const got = list.filter((g) => seen.has(g.char)).length
        this.codexBody.appendChild(section(`${CATEGORY_TITLE[cat]}　${got}/${list.length}`))
        const grid = document.createElement('div')
        grid.className = 'codex-grid'
        for (const g of list) {
          const ok = seen.has(g.char)
          const cell = document.createElement('div')
          cell.className = `codex-cell${ok ? '' : ' unseen'}`
          // fx 'none'（光環與經濟字）的特效色是 transparent，字會消失 → 改用墨色
          const color = g.fx && g.fx !== 'none' ? FX_COLOR[g.fx] : '#2b2b2b'
          cell.innerHTML = `<div class="cx-char" ${ok ? `style="color:${color}"` : ''}>${ok ? g.char : '？'}</div>
            <div class="cx-name">${ok ? (g.income ? `糧${g.income}` : g.atk > 0 ? `攻${g.atk}` : '輔助') : '未發現'}</div>`
          if (ok) cell.addEventListener('click', () => this.showGlyphDetail(g.char))
          grid.appendChild(cell)
        }
        this.codexBody.appendChild(grid)
      }
    } else if (this.tab === 'general') {
      const seen = new Set(meta.seenGenerals)
      for (const tier of TIER_DISPLAY_ORDER) {
        const list = GENERALS.filter((g) => g.tier === tier)
        if (!list.length) continue
        const got = list.filter((g) => seen.has(g.name)).length
        this.codexBody.appendChild(section(`${TIER_LABEL[tier]}　${got}/${list.length}`))
        const grid = document.createElement('div')
        grid.className = 'codex-grid'
        for (const g of list) {
          const ok = seen.has(g.name)
          const cell = document.createElement('div')
          cell.className = `codex-cell${ok ? '' : ' unseen'}`
          cell.innerHTML = `<div class="cx-char" style="font-size:15px${ok ? `;color:${TIER_COLOR[tier]}` : ''}">${
            ok ? g.name : '？？'
          }</div>
            <div class="cx-name">${ok ? g.recipe.join('＋') : '未組成'}</div>`
          if (ok) cell.addEventListener('click', () => this.showGeneralDetail(g.name))
          grid.appendChild(cell)
        }
        this.codexBody.appendChild(grid)
      }
    }

    if (this.tab === 'enemy') this.renderEnemyCodex(new Set(meta.seenEnemies))
  }

  /**
   * 敵人圖鑑。分「一般兵」與「BOSS」兩區，各自依 `minWave`（登場順序）排列，
   * 讓玩家看得出「還有什麼在後面等著」。
   * 已遭遇過的才顯示內容——`seenEnemies` 在 `app.ts` 的 `syncProgress` 記錄，
   * 只要在場上出現過就算（不必打死，否則被漏過的敵種永遠登錄不了）。
   */
  private renderEnemyCodex(seen: Set<string>): void {
    for (const [title, list] of [
      ['一般兵', REGULARS],
      ['BOSS', BOSSES],
    ] as const) {
      const sorted = [...list].sort((a, b) => (a.minWave ?? 0) - (b.minWave ?? 0))
      const got = sorted.filter((e) => seen.has(e.key)).length
      this.codexBody.appendChild(section(`${title}　${got}/${sorted.length}`))
      const grid = document.createElement('div')
      grid.className = 'codex-grid'
      for (const e of sorted) {
        const ok = seen.has(e.key)
        const cell = document.createElement('div')
        cell.className = `codex-cell${ok ? '' : ' unseen'}`
        cell.innerHTML = `<div class="cx-char" ${ok ? `style="color:${e.boss ? '#a8321e' : '#2b2b2b'}"` : ''}>${
          ok ? e.char : '？'
        }</div>
          <div class="cx-name">${ok ? (e.minWave ? `${e.minWave} 波起` : '第 1 波') : '未遭遇'}</div>`
        if (ok) cell.addEventListener('click', () => this.showEnemyDetail(e.key))
        grid.appendChild(cell)
      }
      this.codexBody.appendChild(grid)
    }

    const note = document.createElement('div')
    note.className = 'codex-detail'
    note.innerHTML =
      '敵人只要在戰場上<b>出現過</b>就會登錄，不必擊殺。<br>' +
      '<span class="muted">「特徵」決定關卡的敵人偏好與選關畫面的「建議帶」標籤；' +
      '血量倍率是相對於基準雜兵「賊」的倍數。</span>'
    this.codexBody.appendChild(note)
  }

  private showEnemyDetail(key: string): void {
    const e = ENEMY_BY_KEY[key]
    if (!e) return
    const traits = e.traits.map((t) => TRAIT_LABEL[t]).join('・') || '（無特別特徵）'
    // 免疫與特殊機制是玩家最需要知道的事，沒有就整段不出現，避免一堆「無」
    const immune = [
      e.ccImmune ? '定身／擊退' : '',
      e.slowImmune ? '減速' : '',
      e.burnImmune ? '灼燒' : '',
    ].filter(Boolean)
    const hooks = [
      e.flying ? '<b>飛行</b>：只有射程 ≥2 的單位打得到' : '',
      e.healAura ? `<b>回血光環</b>：每秒為半徑 ${e.healAura.radius} 內的敵人回復最大血量的 ${Math.round(e.healAura.hps * 100)}%` : '',
      e.regen ? `<b>自我再生</b>：每秒回復自身最大血量的 ${Math.round(e.regen * 100)}%` : '',
      e.splitInto ? `<b>死亡分裂</b>：死亡時裂成 ${e.splitInto.count} 隻「${ENEMY_BY_KEY[e.splitInto.key]?.char ?? '？'}」` : '',
      e.escort ? `<b>護衛</b>：出場時帶 ${e.escort.count} 隻「${ENEMY_BY_KEY[e.escort.key]?.char ?? '？'}」` : '',
      e.damage > 1 ? `<b>漏過扣 ${e.damage} 點生命</b>（一般敵人只扣 1）` : '',
    ].filter(Boolean)
    // 這一段是「怎麼打」的直接建議，由 traits 推導，與選關畫面同一份真相
    const counters = countersFor(e.traits).map((c) => COUNTER_LABEL[c])
    this.appendDetail(`<b>${e.char}</b>　${e.boss ? 'BOSS' : '一般兵'}　${e.troop} 兵
      <br>血量 ×${e.hpMul}　防禦 ${e.def}　移速 ${e.speed}　賞金 ${e.bounty}
      <br>${e.desc}
      <br>特徵：${traits}${counters.length ? `　→ 建議帶 <b>${counters.join('、')}</b>` : ''}
      ${immune.length ? `<br>免疫：${immune.join('、')}` : ''}
      ${hooks.length ? `<div class="bond-list">${hooks.map((h) => `<div class="bond-row">${h}</div>`).join('')}</div>` : ''}`)
  }

  private showGlyphDetail(char: string): void {
    const g = GLYPHS.find((x) => x.char === char)
    if (!g) return
    this.appendDetail(`<b>${g.char}</b>　${CATEGORY_TITLE[g.category]}　稀有度 ${g.rarity}<br>
      ${g.atk > 0 ? `攻擊 ${g.atk}　攻速 ${g.aps}/s　射程 ${g.range}` : '不攻擊'}
      ${g.income ? `　每波產糧 ${g.income}` : ''}<br>${g.desc}<br>
      <span class="muted">兩個同字同階可疊合升為${qualityName(2)}</span>
      ${this.recipesHtml(char)}`)
  }

  /**
   * 這個字能組成哪些武將。姓名字單獨戰力很低，「留著等隊友」的價值全在這份名單上，
   * 所以圖鑑一定要看得到——否則玩家只會覺得抽到姓氏是廢牌。
   *
   * 已組出過的用該階級的顏色標示，沒組過的壓灰當成待完成清單。
   * 配方欄位把**該字本身**標出來，讓玩家一眼看出還缺哪幾個字。
   */
  private recipesHtml(char: string): string {
    const uses = generalsUsing(char)
    if (!uses.length) return ''
    const seen = new Set(this.host.getMeta().seenGenerals)
    const rows = uses
      .map((g) => {
        const ok = seen.has(g.name)
        const recipe = g.recipe.map((c) => (c === char ? `<b>${c}</b>` : c)).join('＋')
        return `<div class="bond-row"${ok ? '' : ' style="opacity:.62"'}>
          <span style="color:${ok ? TIER_COLOR[g.tier] : 'inherit'}">${g.name}</span>
          <span class="muted">　${TIER_LABEL[g.tier]}　${recipe}</span>
        </div>`
      })
      .join('')
    return `<div class="codex-section" style="margin-top:6px">可組成（${uses.filter((g) => seen.has(g.name)).length}/${uses.length}）</div>
      <div class="bond-list">${rows}</div>`
  }

  private showGeneralDetail(name: string): void {
    const g = GENERALS.find((x) => x.name === name)
    if (!g) return
    this.appendDetail(`<b>${g.name}</b>　<span style="color:${TIER_COLOR[g.tier]}">${TIER_LABEL[g.tier]}</span>
      配方 ${g.recipe.join('＋')}<br>${g.desc}
      ${g.skill ? `<br><b>〈${g.skill.name}〉</b>${g.skill.desc}（冷卻 ${g.skill.cd}s）` : ''}
      ${this.bondsHtml(g)}`)
  }

  /** 這名武將能參與哪些羈絆——名單裡的其他武將、或需要的 tag 門檻，以及效果與組合技 */
  private bondsHtml(g: (typeof GENERALS)[number]): string {
    const bonds = BONDS.filter(
      (b) => b.requireGenerals?.includes(g.name) || (b.requireTag && g.tags.includes(b.requireTag.tag)),
    )
    if (!bonds.length) return ''
    const rows = bonds.map((b) => this.bondRowHtml(b, g.name))
    return `<div class="bond-list"><span class="muted">可組成的羈絆：</span>${rows.join('')}</div>`
  }

  private bondRowHtml(b: BondDef, selfName: string): string {
    const requirement = b.requireGenerals
      ? `與 ${b.requireGenerals.filter((n) => n !== selfName).join('、')} 同時在場`
      : `場上 ${b.requireTag!.count} 名以上帶有「${b.requireTag!.tag}」標籤的武將`
    const effects: string[] = []
    if (b.atkMul) effects.push(`攻擊 ${pctLabel(b.atkMul)}`)
    if (b.apsMul) effects.push(`攻速 ${pctLabel(b.apsMul)}`)
    if (b.cdMul) effects.push(`技能冷卻 ${pctLabel(b.cdMul)}`)
    const combo = b.comboSkill
      ? `　組合技〈${b.comboSkill.name}〉${b.comboSkill.desc}${COMBOS[b.name] ? '' : '（尚未實作）'}`
      : ''
    return `<div class="bond-row"><b>${b.name}</b>　${requirement}：${effects.join('、')}${combo}</div>`
  }

  private appendDetail(html: string): void {
    const old = this.codexBody.querySelector('.codex-detail')
    if (old) old.remove()
    const box = document.createElement('div')
    box.className = 'codex-detail'
    box.innerHTML = html
    this.codexBody.appendChild(box)
    box.scrollIntoView({ block: 'nearest' })
  }
}

function section(title: string): HTMLElement {
  const h = document.createElement('div')
  h.className = 'codex-section'
  h.textContent = title
  return h
}

/** 倍率轉百分比標示：1.3 → "+30%"，0.7 → "−30%" */
function pctLabel(mul: number): string {
  const pct = Math.round((mul - 1) * 100)
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`
}
