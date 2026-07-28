/**
 * 全螢幕畫面：選關與圖鑑。
 * 與 hud.ts 一樣只碰 DOM，所有狀態變更都經由 ScreensHost 交回 app 層。
 */
import { GENERALS } from '../data/generals'
import { GLYPHS, qualityName } from '../data/glyphs'
import { LEVELS, LEVEL_ORDER } from '../data/levels'
import { UPGRADES } from '../data/upgrades'
import { SHOP } from '../data/shop'
import { TIER_COLOR, TIER_LABEL } from '../render/theme'
import { FX_COLOR } from '../render/fx'
import type { MetaProgress } from '../sim/state'
import type { GlyphCategory } from '../sim/types'

export type ScreenName = 'menu' | 'codex' | 'forge' | 'shop' | null

export interface ScreensHost {
  getMeta(): MetaProgress
  startLevel(key: string): void
  show(screen: ScreenName): void
  buyUpgrade(key: string): void
  buyItem(key: string): void
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
  private renownCount = el('renown-count')
  private levelList = el('level-list')
  private codexBody = el('codex-body')
  private codexCount = el('codex-count')
  private tabGlyph = el('tab-glyph')
  private tabGeneral = el('tab-general')
  private tab: 'glyph' | 'general' = 'glyph'
  private current: ScreenName = null

  constructor(private host: ScreensHost) {
    el('btn-codex').addEventListener('click', () => this.host.show('codex'))
    el('codex-back').addEventListener('click', () => this.host.show('menu'))
    el('btn-forge').addEventListener('click', () => this.host.show('forge'))
    el('forge-back').addEventListener('click', () => this.host.show('menu'))
    el('btn-shop').addEventListener('click', () => this.host.show('shop'))
    el('shop-back').addEventListener('click', () => this.host.show('menu'))
    this.tabGlyph.addEventListener('click', () => this.setTab('glyph'))
    this.tabGeneral.addEventListener('click', () => this.setTab('general'))
  }

  show(screen: ScreenName): void {
    this.current = screen
    this.menu.hidden = screen !== 'menu'
    this.codex.hidden = screen !== 'codex'
    this.forge.hidden = screen !== 'forge'
    this.shop.hidden = screen !== 'shop'
    if (screen === 'menu') this.renderMenu()
    if (screen === 'codex') this.renderCodex()
    if (screen === 'forge') this.renderForge()
    if (screen === 'shop') this.renderShop()
  }

  /** 商城：花聲望買被動道具（一次性擁有） */
  renderShop(): void {
    const meta = this.host.getMeta()
    this.shopRenown.textContent = `聲望 ${meta.renown}`
    this.shopBody.innerHTML = ''
    for (const item of SHOP) {
      const owned = meta.items.includes(item.key)
      const row = document.createElement('div')
      row.className = 'forge-row'
      row.innerHTML = `<div>
          <div class="fg-name">${item.name}${owned ? ' <span class="muted">已擁有</span>' : ''}</div>
          <div class="fg-desc">${item.desc}</div>
        </div>`
      const btn = document.createElement('button')
      btn.textContent = owned ? '已購買' : `聲望 ${item.cost}`
      btn.disabled = owned || meta.renown < item.cost
      btn.addEventListener('click', () => this.host.buyItem(item.key))
      row.appendChild(btn)
      this.shopBody.appendChild(row)
    }
    const note = document.createElement('div')
    note.className = 'codex-detail'
    note.innerHTML =
      '道具皆為被動效果，購買後永久擁有，<b>下一局開始</b>套用。<br>' +
      '<span class="muted">聲望與兵書共用，於每局結束依抵達波次結算。</span>'
    this.shopBody.appendChild(note)
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
