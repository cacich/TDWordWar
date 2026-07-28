/**
 * DOM HUD：頂部狀態列、手牌、操作列、資訊面板、羈絆條。
 * 每幀呼叫 update()，內部只在值有變動時寫 DOM。
 */
import { GLYPH_BY_CHAR, qualityName } from '../data/glyphs'
import { GENERAL_BY_NAME } from '../data/generals'
import { recruitCost, rerollCost } from '../sim/economy'
import { TIER_COLOR, TIER_LABEL, qualityColor } from '../render/theme'
import type { GameState, GlyphCategory, OnHit, Unit } from '../sim/types'

export type Mode = 'normal' | 'shovel' | 'smelt'

export interface HudHost {
  getState(): GameState
  getMode(): Mode
  setMode(m: Mode): void
  /** 選取的格子上的字牌 */
  getSelectedGlyph(): Unit | null
  /** 選取的格子上的武將（0～2 個） */
  getSelectedForms(): Unit[]
  isPaused(): boolean
  getSpeed(): number
  recruit(): void
  reroll(): void
  openMenu(): void
  openWishPanel(): void
  toggleWish(char: string): void
  isMuted(): boolean
  toggleMute(): void
  /** 目前處於「點選待放置」的手牌索引（手機友善的放置方式） */
  getArmedHand(): number | null
  startWave(): void
  togglePause(): void
  cycleSpeed(): void
  restart(): void
  sellSelected(): void
  cycleTargeting(): void
  select(cell: number | null): void
  smeltHand(index: number): void
  beginHandDrag(index: number, ev: PointerEvent): void
}

const CATEGORY_LABEL: Record<GlyphCategory, string> = {
  weapon: '兵器',
  troop: '兵種',
  surname: '姓',
  given: '名',
  strategy: '謀',
  economy: '經',
}

const TARGET_LABEL = { front: '最前', near: '最近', strong: '最強' } as const

/** 把 onHit 翻成玩家看得懂的一行字 */
function onHitText(o: OnHit): string {
  const parts: string[] = []
  if (o.burn) parts.push(`灼燒 ${o.burn.dur}s`)
  if (o.slowDur) parts.push(`減速 ${o.slowDur}s`)
  if (o.stunDur) parts.push(`定身 ${o.stunDur}s`)
  if (o.vulnDur) parts.push(`易傷 ${o.vulnDur}s`)
  if (o.knock) parts.push(`擊退 ${o.knock} 格`)
  if (o.chain) parts.push(`連鎖 ${o.chain} 名`)
  return parts.join('、')
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id)
  if (!e) throw new Error(`缺少 DOM 節點 #${id}`)
  return e as T
}

export class Hud {
  private food = el('stat-food')
  private levelName = el('level-name')
  private lives = el('lives')
  private waveInfo = el('wave-info')
  private hint = el('hint')
  private prep = el('prep')
  private prepText = el('prep-text')
  private toastEl = el('toast')
  private banner = el('banner')
  private bannerTitle = el('banner-title')
  private bannerSub = el('banner-sub')
  private handEl = el('hand')
  private bondsEl = el('bonds')
  private info = el('infopanel')
  private recruitBtn = el<HTMLButtonElement>('btn-recruit')
  private recruitCostEl = el('recruit-cost')
  private smeltBtn = el<HTMLButtonElement>('btn-smelt')
  private smeltLeft = el('smelt-left')
  private rerollBtn = el<HTMLButtonElement>('btn-reroll')
  private rerollCostEl = el('reroll-cost')
  private wishBar = el('wish-bar')
  private muteBtn = el('btn-mute')
  private shovelBtn = el<HTMLButtonElement>('btn-shovel')
  private speedBtn = el('btn-speed')
  private pauseBtn = el('btn-pause')

  private cards: HTMLElement[] = []
  private toastTimer = 0
  private lastSig = ''
  private lastWave = 1

  constructor(private host: HudHost) {
    this.buildHand()
    this.bind()
    this.levelName.textContent = host.getState().levelName
  }

  /** 換關時呼叫：手牌格數與關卡名可能不同 */
  onLevelChanged(): void {
    this.buildHand()
    this.levelName.textContent = this.host.getState().levelName
    this.lastWave = this.host.getState().wave
    this.lastSig = ''
  }

  private buildHand(): void {
    const size = this.host.getState().handSize
    this.handEl.style.setProperty('--slots', String(size))
    this.handEl.innerHTML = ''
    this.cards = []
    for (let i = 0; i < size; i++) {
      const card = document.createElement('div')
      card.className = 'card empty'
      card.dataset.index = String(i)
      card.addEventListener('pointerdown', (ev) => {
        const state = this.host.getState()
        if (!state.hand[i]) return
        if (this.host.getMode() === 'smelt') {
          this.host.smeltHand(i)
          this.host.setMode('normal')
          return
        }
        // 觸控時把指標鎖在這張卡上，之後的 move / up 才一定送得到我們手上
        // （手指離開卡片範圍、或卡片內容被重繪時都不會斷掉）
        try {
          card.setPointerCapture(ev.pointerId)
        } catch {
          /* 某些瀏覽器在滑鼠情境下會拒絕，忽略即可 */
        }
        ev.preventDefault()
        this.host.beginHandDrag(i, ev)
      })
      this.handEl.appendChild(card)
      this.cards.push(card)
    }
  }

  private bind(): void {
    this.recruitBtn.addEventListener('click', () => this.host.recruit())
    this.rerollBtn.addEventListener('click', () => this.host.reroll())
    el('btn-start').addEventListener('click', () => this.host.startWave())
    this.pauseBtn.addEventListener('click', () => this.host.togglePause())
    this.speedBtn.addEventListener('click', () => this.host.cycleSpeed())
    el('btn-restart').addEventListener('click', () => this.host.restart())
    el('btn-tomenu').addEventListener('click', () => this.host.openMenu())
    el('btn-menu').addEventListener('click', () => this.host.openMenu())
    this.wishBar.addEventListener('click', () => this.host.openWishPanel())
    this.muteBtn.addEventListener('click', () => this.host.toggleMute())
    el('info-close').addEventListener('click', () => this.host.select(null))
    el('info-sell').addEventListener('click', () => this.host.sellSelected())
    el('info-target').addEventListener('click', () => this.host.cycleTargeting())
    this.smeltBtn.addEventListener('click', () => {
      this.host.setMode(this.host.getMode() === 'smelt' ? 'normal' : 'smelt')
    })
    this.shovelBtn.addEventListener('click', () => {
      this.host.setMode(this.host.getMode() === 'shovel' ? 'normal' : 'shovel')
    })
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg
    this.toastEl.hidden = false
    this.toastTimer = 1.8
  }

  update(dt: number): void {
    const state = this.host.getState()
    const mode = this.host.getMode()

    this.food.textContent = String(Math.floor(state.food))
    this.lives.textContent = '♥'.repeat(Math.max(0, state.lives))
    this.waveInfo.textContent = `第 ${state.wave} 波 / ${state.maxWave}`

    // 過波時回報收入，讓經濟字的價值看得見
    if (state.wave !== this.lastWave) {
      this.lastWave = state.wave
      const { base, units } = state.lastIncome
      this.toast(units > 0 ? `本波收入 +${base}　產糧 +${units}` : `本波收入 +${base}`)
    }

    const cost = recruitCost(state)
    this.recruitCostEl.textContent = String(cost)
    this.recruitBtn.disabled = state.food < cost || state.hand.every((h) => h !== null)
    const rcost = rerollCost(state)
    this.rerollCostEl.textContent = String(rcost)
    this.rerollBtn.disabled = state.food < rcost || state.hand.every((h) => h === null)
    this.smeltLeft.textContent = state.smeltFreeLeft > 0 ? `免費 ${state.smeltFreeLeft}` : ''
    this.smeltBtn.classList.toggle('active', mode === 'smelt')
    this.shovelBtn.classList.toggle('active', mode === 'shovel')
    this.pauseBtn.textContent = this.host.isPaused() ? '▶' : '❚❚'
    this.speedBtn.textContent = `${this.host.getSpeed()}×`
    this.muteBtn.textContent = this.host.isMuted() ? '♪̸' : '♪'

    // 心願列
    const wishSig = `${state.wishes.join('')}/${state.wishSlots}`
    if (this.wishBar.dataset.sig !== wishSig) {
      this.wishBar.dataset.sig = wishSig
      this.wishBar.classList.toggle('has-wish', state.wishes.length > 0)
      this.wishBar.innerHTML = state.wishes.length
        ? `<span>★ 心願</span>${state.wishes.map((c) => `<span class="wish-chip">${c}</span>`).join('')}` +
          `<span>（${state.wishes.length}/${state.wishSlots}）點此修改</span>`
        : '＋ 設定心願：指定想抽的字，機率大幅提高'
    }

    // 手牌。可互相疊合的同字同階卡片會亮藍框，提示玩家可以升階
    const pairCount = new Map<string, number>()
    for (const h of state.hand) {
      if (h) pairCount.set(`${h.char}:${h.level}`, (pairCount.get(`${h.char}:${h.level}`) ?? 0) + 1)
    }
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i]
      const h = state.hand[i]
      if (!h) {
        if (!card.classList.contains('empty')) {
          card.className = 'card empty'
          card.innerHTML = ''
          // 必須清掉 sig，否則下次抽到同字同階時會被誤判為「沒變動」而不重繪
          delete card.dataset.sig
          delete card.dataset.q
        }
        continue
      }
      const wished = state.wishes.includes(h.char)
      const sig = `${h.char}:${h.level}:${wished ? 'w' : ''}`
      if (card.dataset.sig !== sig) {
        card.dataset.sig = sig
        card.dataset.q = String(h.level)
        card.className = 'card'
        const cat = GLYPH_BY_CHAR[h.char]?.category
        card.innerHTML =
          `<span>${h.char}</span>` +
          (h.level > 1 ? `<span class="lv">${h.level}</span>` : '') +
          (wished ? '<span class="wish-star">★</span>' : '') +
          (cat ? `<span class="cat">${CATEGORY_LABEL[cat]}</span>` : '')
      }
      card.classList.toggle('mergeable', (pairCount.get(`${h.char}:${h.level}`) ?? 0) >= 2)
      card.classList.toggle('armed', this.host.getArmedHand() === i)
    }

    // 提示
    if (state.hints.length) {
      this.hint.hidden = false
      this.hint.textContent = `可組成：${state.hints.join('、')}`
    } else {
      this.hint.hidden = true
    }

    // 佈陣階段
    if (state.phase === 'prep') {
      this.prep.hidden = false
      this.prepText.textContent = `佈陣中 ${Math.ceil(state.prepTimer)}s`
    } else {
      this.prep.hidden = true
    }

    // 羈絆（含組合技冷卻）
    const bondSig = state.activeBonds
      .map((b) => `${b.name}:${b.combo ? Math.ceil(b.combo.cd) : ''}`)
      .join(',')
    if (this.lastSig !== bondSig) {
      this.lastSig = bondSig
      this.bondsEl.innerHTML = state.activeBonds
        .map((b) => {
          const ready = b.combo ? b.combo.cd <= 0 : false
          const cd = b.combo
            ? ready
              ? `<span class="cd">${b.combo.name} 就緒</span>`
              : `<span class="cd">${b.combo.name} ${Math.ceil(b.combo.cd)}s</span>`
            : ''
          return `<span class="bond-chip${ready ? ' ready' : ''}" title="${b.desc}">${b.name}${cd}</span>`
        })
        .join('')
    }

    // 結算
    if (state.phase === 'won' || state.phase === 'lost') {
      this.banner.hidden = false
      this.bannerTitle.textContent = state.phase === 'won' ? '守住了' : '大營陷落'
      this.bannerSub.textContent = `第 ${state.wave} 波 · 擊殺 ${state.stats.kills} · 漏過 ${state.stats.leaks}`
    } else {
      this.banner.hidden = true
    }

    this.updateInfo()

    if (this.toastTimer > 0) {
      this.toastTimer -= dt
      if (this.toastTimer <= 0) this.toastEl.hidden = true
    }
  }

  /**
   * 面板以「格子」為單位：先講這一格的字，再列出它參與的武將（可能兩個）。
   * 這是必要的，因為字牌組成武將後仍然存在，兩者的屬性都要看得到。
   */
  private updateInfo(): void {
    const g = this.host.getSelectedGlyph()
    const forms = this.host.getSelectedForms()
    if (!g && !forms.length) {
      this.info.hidden = true
      return
    }
    this.info.hidden = false

    const head = g ?? forms[0]
    el('info-name').textContent = g ? g.chars[0] : forms[0].defKey
    const tier = el('info-tier')
    tier.hidden = false
    if (g) {
      tier.textContent = qualityName(g.level)
      tier.style.color = qualityColor(g.level)
    } else {
      tier.textContent = TIER_LABEL[forms[0].tier]
      tier.style.color = TIER_COLOR[forms[0].tier]
    }

    // 字牌自己的數據：若已成為武將成員，它不再單獨攻擊，就只顯示品質資訊
    const inForm = g ? g.formIds.length > 0 : false
    el('info-stats').innerHTML = (g && !inForm ? statsOf(g) : g ? [`品質 ${qualityName(g.level)}`] : statsOf(forms[0]))
      .map((s) => `<span>${s}</span>`)
      .join('')

    const gdef = g ? GLYPH_BY_CHAR[g.defKey] : undefined
    let html = gdef?.desc ?? ''
    if (g && !inForm && g.onHit) html += `<br><span class="onhit">附加：${onHitText(g.onHit)}</span>`
    if (inForm) html += '<br><span class="onhit">已組成武將，攻擊由武將代表；繼續疊同一個字可強化它</span>'

    // 這一格參與的武將
    for (const f of forms) {
      const def = GENERAL_BY_NAME[f.defKey]
      const skill = def?.skill
      const cd =
        f.skillCdMax > 0
          ? `（冷卻 ${f.skillCd > 0 ? `${Math.ceil(f.skillCd)}s` : '就緒'} / ${f.skillCdMax.toFixed(0)}s）`
          : ''
      html +=
        `<div class="info-form"><span class="form-name" style="color:${TIER_COLOR[f.tier]}">${f.defKey}</span>` +
        ` <span class="muted">${TIER_LABEL[f.tier]}・等級 ${f.level}</span><br>` +
        `<span class="muted">${statsOf(f).join('　')}</span>` +
        (f.onHit ? `<br><span class="onhit">附加：${onHitText(f.onHit)}</span>` : '') +
        (skill ? `<br><b>〈${skill.name}〉</b>${skill.desc}${cd}` : '') +
        '</div>'
    }

    el('info-desc').innerHTML = html
    el('info-target').textContent = `索敵：${TARGET_LABEL[(forms[0] ?? head).targeting]}`
  }
}

function statsOf(u: Unit): string[] {
  const out = [
    `攻擊 ${u.atk.toFixed(1)}`,
    `攻速 ${u.aps.toFixed(2)}/s`,
    `DPS ${(u.atk * u.aps).toFixed(1)}`,
    `射程 ${u.range.toFixed(1)}`,
    `型態 ${{ single: '單體', pierce: '穿透', splash: '濺射' }[u.shape]}`,
  ]
  if (u.troop !== 'none') out.push(`兵種 ${u.troop}`)
  if (u.income > 0) out.push(`每波產糧 ${u.income}`)
  if (u.aura) out.push(`光環 ${u.aura.radius.toFixed(1)} 格`)
  return u.atk > 0 || u.income > 0 ? out : out.slice(3)
}
