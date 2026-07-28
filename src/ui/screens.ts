/**
 * 全螢幕畫面：選關與圖鑑。
 * 與 hud.ts 一樣只碰 DOM，所有狀態變更都經由 ScreensHost 交回 app 層。
 */
import { GENERAL_BY_NAME, GENERALS } from '../data/generals'
import { GLYPH_BY_CHAR, GLYPHS, qualityName } from '../data/glyphs'
import { LEVELS, LEVEL_ORDER } from '../data/levels'
import { UPGRADES } from '../data/upgrades'
import { SHOP, itemLevel } from '../data/shop'
import { TIER_COLOR, TIER_LABEL } from '../render/theme'
import { FX_COLOR } from '../render/fx'
import { MAX_LOADOUT_GENERALS, MAX_LOADOUT_GLYPHS, type MetaProgress } from '../sim/state'
import type { GlyphCategory } from '../sim/types'

export type ScreenName = 'menu' | 'codex' | 'forge' | 'shop' | 'dev' | 'loadout' | null

export interface ScreensHost {
  getMeta(): MetaProgress
  startLevel(key: string): void
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
  private renownCount = el('renown-count')
  private levelList = el('level-list')
  private codexBody = el('codex-body')
  private codexCount = el('codex-count')
  private tabGlyph = el('tab-glyph')
  private tabGeneral = el('tab-general')
  private tab: 'glyph' | 'general' = 'glyph'
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
    el('menu-title').addEventListener('click', () => this.handleTitleTap())
    this.tabGlyph.addEventListener('click', () => this.setTab('glyph'))
    this.tabGeneral.addEventListener('click', () => this.setTab('general'))
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
    if (screen === 'menu') this.renderMenu()
    if (screen === 'codex') this.renderCodex()
    if (screen === 'forge') this.renderForge()
    if (screen === 'shop') this.renderShop()
    if (screen === 'dev') this.renderDev()
    if (screen === 'loadout') this.renderLoadout()
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

    this.loadoutBody.appendChild(section(`攜帶的字　${meta.loadoutGlyphs.length}/${MAX_LOADOUT_GLYPHS}`))
    const glyphGrid = document.createElement('div')
    glyphGrid.className = 'codex-grid'
    for (const char of meta.seenGlyphs) {
      const g = GLYPH_BY_CHAR[char]
      if (!g) continue
      const selected = meta.loadoutGlyphs.includes(char)
      const cell = document.createElement('div')
      cell.className = `codex-cell${selected ? ' selected' : ''}`
      const color = g.fx && g.fx !== 'none' ? FX_COLOR[g.fx] : '#2b2b2b'
      cell.innerHTML = `<div class="cx-char" style="color:${color}">${selected ? '★' : ''}${g.char}</div>
        <div class="cx-name">${g.income ? `糧${g.income}` : g.atk > 0 ? `攻${g.atk}` : '輔助'}</div>`
      cell.addEventListener('click', () => this.host.toggleLoadoutGlyph(char))
      glyphGrid.appendChild(cell)
    }
    this.loadoutBody.appendChild(glyphGrid)
    if (!meta.seenGlyphs.length) {
      const empty = document.createElement('div')
      empty.className = 'muted'
      empty.textContent = '還沒解鎖任何字，先去玩一局吧。'
      this.loadoutBody.appendChild(empty)
    }

    this.loadoutBody.appendChild(section(`攜帶的武將　${meta.loadoutGenerals.length}/${MAX_LOADOUT_GENERALS}`))
    const genGrid = document.createElement('div')
    genGrid.className = 'codex-grid'
    for (const name of meta.seenGenerals) {
      const g = GENERAL_BY_NAME[name]
      if (!g) continue
      const selected = meta.loadoutGenerals.includes(name)
      const cell = document.createElement('div')
      cell.className = `codex-cell${selected ? ' selected' : ''}`
      cell.innerHTML = `<div class="cx-char" style="font-size:15px;color:${TIER_COLOR[g.tier]}">${selected ? '★' : ''}${g.name}</div>
        <div class="cx-name">${g.recipe.join('＋')}</div>`
      cell.addEventListener('click', () => this.host.toggleLoadoutGeneral(name))
      genGrid.appendChild(cell)
    }
    this.loadoutBody.appendChild(genGrid)
    if (!meta.seenGenerals.length) {
      const empty = document.createElement('div')
      empty.className = 'muted'
      empty.textContent = '還沒組出任何武將，先去玩一局吧。'
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

    LEVEL_ORDER.forEach((key, i) => {
      const level = LEVELS[key]
      const cleared = meta.cleared.includes(key)
      // 第一關永遠開放；其餘要前一關通關才解鎖
      const unlocked = i === 0 || meta.cleared.includes(LEVEL_ORDER[i - 1])
      const best = meta.best[key] ?? 0

      const card = document.createElement('button')
      card.className = `level-card${unlocked ? '' : ' locked'}${level.gen ? ' random' : ''}`
      card.disabled = !unlocked
      card.innerHTML = `
        <div>
          <div class="lv-name">${level.name}</div>
          <div class="lv-sub">${unlocked ? level.subtitle : `通關「${LEVELS[LEVEL_ORDER[i - 1]].name}」後解鎖`}</div>
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
  private setTab(tab: 'glyph' | 'general'): void {
    this.tab = tab
    this.tabGlyph.classList.toggle('active', tab === 'glyph')
    this.tabGeneral.classList.toggle('active', tab === 'general')
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
    } else {
      const seen = new Set(meta.seenGenerals)
      const tiers = ['mythic', 'legendary', 'epic', 'fine', 'common'] as const
      for (const tier of tiers) {
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
  }

  private showGlyphDetail(char: string): void {
    const g = GLYPHS.find((x) => x.char === char)
    if (!g) return
    this.appendDetail(`<b>${g.char}</b>　${CATEGORY_TITLE[g.category]}　稀有度 ${g.rarity}<br>
      ${g.atk > 0 ? `攻擊 ${g.atk}　攻速 ${g.aps}/s　射程 ${g.range}` : '不攻擊'}
      ${g.income ? `　每波產糧 ${g.income}` : ''}<br>${g.desc}<br>
      <span class="muted">兩個同字同階可疊合升為${qualityName(2)}</span>`)
  }

  private showGeneralDetail(name: string): void {
    const g = GENERALS.find((x) => x.name === name)
    if (!g) return
    this.appendDetail(`<b>${g.name}</b>　<span style="color:${TIER_COLOR[g.tier]}">${TIER_LABEL[g.tier]}</span>
      配方 ${g.recipe.join('＋')}<br>${g.desc}
      ${g.skill ? `<br><b>〈${g.skill.name}〉</b>${g.skill.desc}（冷卻 ${g.skill.cd}s）` : ''}`)
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
