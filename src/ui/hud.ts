/**
 * DOM HUD：頂部狀態列、手牌、操作列、資訊面板、羈絆條。
 * 每幀呼叫 update()，內部只在值有變動時寫 DOM。
 */
import { BONDS } from '../data/bonds'
import { GLYPH_BY_CHAR, qualityName } from '../data/glyphs'
import { GENERAL_BY_NAME, generalsUsing } from '../data/generals'
import { recruitCost, rerollCost } from '../sim/economy'
import { TIER_COLOR, TIER_LABEL, qualityColor } from '../render/theme'
import type { ActiveBond, BondDef, GameState, GlyphCategory, OnHit, Unit } from '../sim/types'

export type Mode = 'normal' | 'shovel' | 'smelt'

export interface HudHost {
  getState(): GameState
  getMode(): Mode
  setMode(m: Mode): void
  /** 選取的格子上的字牌 */
  getSelectedGlyph(): Unit | null
  /** 選取的格子上的武將（0 個以上，上限不是 2） */
  getSelectedForms(): Unit[]
  isPaused(): boolean
  getSpeed(): number
  recruit(): void
  reroll(): void
  openMenu(): void
  openWishPanel(): void
  closeWishPanel(): void
  toggleWish(char: string): void
  isMuted(): boolean
  toggleMute(): void
  /** AI 代管是否開啟 */
  isAuto(): boolean
  /** 切換 AI 代管 */
  toggleAuto(): void
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

/**
 * 只在字真的變了才寫 DOM。
 *
 * ⚠ 這不是潔癖而是省電：寫 textContent 會換掉文字節點，瀏覽器一律重排該子樹，
 * 就算內容一模一樣也一樣。這個 HUD 每幀更新十幾個讀數，其中大部分幾秒才變一次。
 */
function setText(node: HTMLElement, s: string): void {
  if (node.textContent !== s) node.textContent = s
}

function setHidden(node: HTMLElement, v: boolean): void {
  if (node.hidden !== v) node.hidden = v
}

export class Hud {
  private food = el('stat-food')
  private statsBar = el('bar-stats')
  private levelName = el('level-name')
  private lives = el('lives')
  private livesCount = el('lives-count')
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
  private bondPanel = el('bondpanel')
  private bondBody = el('bond-body')
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
  private autoBtn = el('btn-auto')

  private cards: HTMLElement[] = []
  private toastTimer = 0
  private lastSig = ''
  private lastWave = 1
  /** fitLevelName() 的節流依據：讀數的位數變了才重新實測 */
  private lastFitKey = ''
  /** 版面變動（resize／換關）後要重新實測一次寬度 */
  private fitDirty = true
  /** 目前打開詳情的羈絆名；null = 面板關著 */
  private openBond: string | null = null
  private bondPanelSig = ''
  /** 詳情面板的內容簽章。面板一開著就每幀重建 innerHTML 太貴，值沒變就不重畫 */
  private infoSig = ''

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
    this.fitDirty = true
    this.infoSig = ''
    this.openBond = null
  }

  /** 視窗／版面尺寸變了：關卡名塞不塞得下要重新實測一次（見 fitLevelName） */
  onResized(): void {
    this.fitDirty = true
  }

  /**
   * 關卡名塞得下才顯示。用**實測溢出**而不是視窗寬度斷點：能不能塞下同時取決於
   * 關卡名長度（2～7 字）、糧的位數與波數的位數，斷點怎麼猜都會在某個組合下失準。
   * 讀數區的三個讀數都設了 flex 不壓縮，所以塞不下時一定會溢出，量得出來。
   *
   * ⚠ `scrollWidth`／`clientWidth` 是**強制排版**的讀取：每幀量一次等於每幀多一次 layout。
   * 所以只在「位數變了」或「版面變了」（onResized）時才量——寬度本身不進 key。
   */
  private fitLevelName(key: string): void {
    if (!this.fitDirty && this.lastFitKey === key) return
    this.fitDirty = false
    this.lastFitKey = key
    this.levelName.hidden = false
    // 先還原再量：不然變寬之後永遠不會把名字放回來
    if (this.statsBar.scrollWidth > this.statsBar.clientWidth) this.levelName.hidden = true
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
    this.autoBtn.addEventListener('click', () => this.host.toggleAuto())
    this.speedBtn.addEventListener('click', () => this.host.cycleSpeed())
    el('btn-restart').addEventListener('click', () => this.host.restart())
    el('btn-tomenu').addEventListener('click', () => this.host.openMenu())
    el('btn-menu').addEventListener('click', () => this.host.openMenu())
    this.wishBar.addEventListener('click', () => this.host.openWishPanel())
    this.muteBtn.addEventListener('click', () => this.host.toggleMute())
    el('info-close').addEventListener('click', () => this.host.select(null))
    el('bond-close').addEventListener('click', () => {
      this.openBond = null
    })
    // 委派在整條羈絆條上：標籤本身每次重繪都會換掉，逐一綁事件會漏
    this.bondsEl.addEventListener('click', (ev) => {
      const chip = (ev.target as HTMLElement).closest<HTMLElement>('.bond-chip')
      const name = chip?.dataset.bond
      if (name) this.showBond(name)
    })
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

  /**
   * 打開羈絆詳情。三個底部浮層（字牌詳情／心願單／羈絆詳情）疊在同一塊空間，
   * 所以開一個就得關掉另外兩個，否則會互相蓋住。
   */
  private showBond(name: string): void {
    this.openBond = this.openBond === name ? null : name
    if (!this.openBond) return
    this.host.select(null)
    this.host.closeWishPanel()
    this.lastSig = '' // 標籤要重畫才會標出「目前打開的是哪一個」
  }

  update(dt: number): void {
    const state = this.host.getState()
    const mode = this.host.getMode()

    setText(this.food, String(Math.floor(state.food)))
    const lives = Math.max(0, state.lives)
    setText(this.livesCount, String(lives))
    this.lives.classList.toggle('low', lives <= 2)
    // 無盡模式的 maxWave 是 Infinity，直接內插會印出 "Infinity"
    setText(this.waveInfo, `${state.wave}/${Number.isFinite(state.maxWave) ? state.maxWave : '∞'}`)
    // 只有「會影響寬度的東西」進 key：位數而不是數值，否則糧每變一點就重量一次
    this.fitLevelName(`${this.food.textContent?.length}:${this.waveInfo.textContent?.length}`)

    // 過波時回報收入，讓經濟字的價值看得見
    if (state.wave !== this.lastWave) {
      this.lastWave = state.wave
      const { base, units } = state.lastIncome
      this.toast(units > 0 ? `本波收入 +${base}　產糧 +${units}` : `本波收入 +${base}`)
    }

    const cost = recruitCost(state)
    setText(this.recruitCostEl, String(cost))
    const handFull = state.hand.every((h) => h !== null)
    const recruitOff = state.food < cost || handFull
    if (this.recruitBtn.disabled !== recruitOff) this.recruitBtn.disabled = recruitOff
    const rcost = rerollCost(state)
    setText(this.rerollCostEl, String(rcost))
    const rerollOff = state.food < rcost || state.hand.every((h) => h === null)
    if (this.rerollBtn.disabled !== rerollOff) this.rerollBtn.disabled = rerollOff
    setText(this.smeltLeft, state.smeltFreeLeft > 0 ? `免費 ${state.smeltFreeLeft}` : '')
    this.smeltBtn.classList.toggle('active', mode === 'smelt')
    this.shovelBtn.classList.toggle('active', mode === 'shovel')
    setText(this.pauseBtn, this.host.isPaused() ? '▶' : '❚❚')
    this.autoBtn.classList.toggle('active', this.host.isAuto())
    setText(this.speedBtn, `${this.host.getSpeed()}×`)
    setText(this.muteBtn, this.host.isMuted() ? '♪̸' : '♪')

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
      setHidden(this.hint, false)
      setText(this.hint, `可組成：${state.hints.join('、')}`)
    } else {
      setHidden(this.hint, true)
    }

    // 佈陣階段
    if (state.phase === 'prep') {
      setHidden(this.prep, false)
      setText(this.prepText, `佈陣中 ${Math.ceil(state.prepTimer)}s`)
    } else {
      setHidden(this.prep, true)
    }

    // 羈絆（含組合技冷卻）。標籤可點，詳情由 updateBondPanel() 畫
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
          const open = this.openBond === b.name ? ' open' : ''
          return (
            `<button class="bond-chip${ready ? ' ready' : ''}${open}" data-bond="${b.name}" title="${b.desc}">` +
            `${b.name}${cd}<span class="chip-i">ⓘ</span></button>`
          )
        })
        .join('')
    }

    // 結算
    if (state.phase === 'won' || state.phase === 'lost') {
      setHidden(this.banner, false)
      setText(this.bannerTitle, state.phase === 'won' ? '守住了' : '大營陷落')
      setText(this.bannerSub, `第 ${state.wave} 波 · 擊殺 ${state.stats.kills} · 漏過 ${state.stats.leaks}`)
    } else {
      setHidden(this.banner, true)
    }

    this.updateInfo()
    this.updateBondPanel()

    if (this.toastTimer > 0) {
      this.toastTimer -= dt
      if (this.toastTimer <= 0) this.toastEl.hidden = true
    }
  }

  /**
   * 羈絆詳情。羈絆條上只看得到名字，玩家沒有任何管道知道「西涼鐵騎」到底加了什麼，
   * 這個面板就是那條管道：條件（還差誰）、加成（翻成 ±%）、組合技（做什麼、還要多久）。
   */
  private updateBondPanel(): void {
    const state = this.host.getState()
    // 字牌詳情優先：玩家點了棋盤就是想看那一格，羈絆面板讓位
    if (!this.info.hidden) this.openBond = null
    const active = this.openBond
      ? state.activeBonds.find((b) => b.name === this.openBond)
      : undefined
    const def = active ? BONDS.find((b) => b.name === active.name) : undefined
    if (!active || !def) {
      // 羈絆被拆掉時面板要跟著收，否則會停在一份已經失效的說明上
      this.openBond = null
      setHidden(this.bondPanel, true)
      this.bondPanelSig = ''
      return
    }
    setHidden(this.bondPanel, false)

    // 場上武將數也要進 sig：tag 型羈絆的「3/2」會隨佈陣變動
    const generals = state.units.filter((u) => u.kind === 'general')
    const sig = `${active.name}:${active.combo ? Math.ceil(active.combo.cd) : ''}:${generals.length}`
    if (this.bondPanelSig === sig) return
    this.bondPanelSig = sig
    el('bond-name').textContent = active.name
    this.bondBody.innerHTML = bondDetailHtml(def, active, generals)
  }

  /**
   * 面板以「格子」為單位：先講這一格的字，再列出它參與的武將（可能兩個）。
   * 這是必要的，因為字牌組成武將後仍然存在，兩者的屬性都要看得到。
   */
  private updateInfo(): void {
    const g = this.host.getSelectedGlyph()
    const forms = this.host.getSelectedForms()
    if (!g && !forms.length) {
      setHidden(this.info, true)
      this.infoSig = ''
      return
    }
    setHidden(this.info, false)

    // 面板全是 innerHTML（含配方建議），一開著就每幀重建會直接吃掉一台手機。
    // 簽章收進所有**顯示出來的**數字：屬性受羈絆／光環影響會變、技能冷卻每秒變一次。
    let sig = g ? `${g.id}:${g.level}:${g.formIds.length}:${g.atk.toFixed(1)}` : '-'
    for (const f of forms) {
      sig += `|${f.id}:${f.level}:${f.atk.toFixed(1)}:${f.aps.toFixed(2)}:${f.range.toFixed(1)}` +
        `:${Math.ceil(f.skillCd)}:${f.skillCdMax.toFixed(0)}:${f.targeting}:${f.income}`
    }
    if (g) sig += `|${g.targeting}:${g.aps.toFixed(2)}:${g.range.toFixed(1)}:${g.income}`
    if (this.infoSig === sig) return
    this.infoSig = sig

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

    // 「這個字還能組成什麼」——只列本局字池湊得出來的，否則會給出做不到的建議
    if (g) html += recipeHints(g.chars[0], this.host.getState().pool, forms)

    el('info-desc').innerHTML = html
    el('info-target').textContent = `索敵：${TARGET_LABEL[(forms[0] ?? head).targeting]}`
  }
}

/**
 * 一份羈絆的完整說明。刻意不直接印 `def.desc` 了事——那句話把條件與加成混在一起，
 * 拆成「條件／加成／組合技」三段，玩家才能一眼比較兩個羈絆誰比較值得湊。
 *
 * @param generals 場上的武將（已由呼叫端過濾好，避免這裡再掃一次 units）
 */
function bondDetailHtml(def: BondDef, active: ActiveBond, generals: Unit[]): string {
  const onField = new Set(generals.map((u) => u.defKey))
  let html = ''

  // 條件。羈絆已經生效了，所以列出來是「誰在撐著這條羈絆」，而不是還缺什麼
  if (def.requireGenerals) {
    const chips = def.requireGenerals
      .map((n) => `<span class="${onField.has(n) ? 'on' : ''}">${n}</span>`)
      .join('')
    html += `<div class="muted">成員（${def.requireGenerals.length} 名齊聚）</div><div class="bond-req">${chips}</div>`
  } else if (def.requireTag) {
    const { tag, count } = def.requireTag
    const holders = generals.filter((u) => u.tags.includes(tag))
    const chips = holders.map((u) => `<span class="on">${u.defKey}</span>`).join('')
    html +=
      `<div class="muted">條件：場上「${tag}」武將 ${holders.length}/${count}</div>` +
      `<div class="bond-req">${chips}</div>`
  }

  // 加成。倍率翻成 ±%，跟兵書／商城的寫法一致
  const effects: string[] = []
  if (def.atkMul && def.atkMul !== 1) effects.push(`全體攻擊 <b>${pct(def.atkMul)}</b>`)
  if (def.apsMul && def.apsMul !== 1) effects.push(`全體攻速 <b>${pct(def.apsMul)}</b>`)
  if (def.cdMul && def.cdMul !== 1) effects.push(`主動技冷卻 <b>${pct(def.cdMul)}</b>`)
  html += `<div class="bond-effect">${effects.length ? effects.join('<br>') : '無數值加成'}</div>`

  // 組合技：自動施放，所以玩家真正需要知道的是「它會做什麼」與「還要多久」
  if (def.comboSkill && active.combo) {
    const c = active.combo
    const ready = c.cd <= 0
    html +=
      `<div class="bond-combo"><b>〈${c.name}〉</b>${def.comboSkill.desc}<br>` +
      `<span class="combo-cd${ready ? ' ready' : ''}">` +
      (ready ? '就緒，下次出手即發動' : `冷卻 ${Math.ceil(c.cd)}s / ${c.cdMax.toFixed(0)}s`) +
      '　（湊齊即自動施放）</span></div>'
  }
  return html
}

/** 倍率轉成玩家看得懂的增減幅：1.3 → +30%、0.7 → −30% */
function pct(mul: number): string {
  const d = Math.round((mul - 1) * 100)
  return d >= 0 ? `+${d}%` : `−${-d}%`
}

/**
 * 這個字能組成哪些武將。**只列本局字池內湊得出來的**——列出池外的配方等於給玩家
 * 一個做不到的目標，比不列更糟。已經在這一格組成的武將會排除掉（上面已經列過了）。
 *
 * 每一列標出還缺哪幾個字（把該字本身與已組成的部分區隔開），
 * 這樣玩家不必自己回頭比對配方。
 */
function recipeHints(char: string, pool: readonly string[], forms: Unit[]): string {
  const formed = new Set(forms.map((f) => f.defKey))
  const list = generalsUsing(char, pool).filter((d) => !formed.has(d.name))
  if (!list.length) return ''
  const rows = list
    .slice(0, 6)
    .map((d) => {
      const recipe = d.recipe.map((c) => (c === char ? `<b>${c}</b>` : c)).join('＋')
      return `<div class="hint-row"><span style="color:${TIER_COLOR[d.tier]}">${d.name}</span>` +
        ` <span class="muted">${recipe}</span></div>`
    })
    .join('')
  const more = list.length > 6 ? `<div class="hint-row muted">…另有 ${list.length - 6} 種</div>` : ''
  return `<div class="info-recipes"><div class="muted">可組成（本局字池）</div>${rows}${more}</div>`
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
