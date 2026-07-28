/**
 * 音效：全部用 Web Audio 即時合成，**專案不放任何音檔**。
 *
 * 三個設計重點：
 *   1. AudioContext 必須在第一次使用者手勢後才建立（瀏覽器自動播放政策）
 *   2. 攻擊音要節流。塔防後期每秒可能有 20 次攻擊，全播會變成噪音牆
 *   3. 音色統一走「短促打擊 + 木魚感」的方向，符合水墨主題；不追求真實樂器
 */

export type SfxName =
  | 'place'
  | 'merge'
  | 'combine'
  | 'combineBig'
  | 'dissolve'
  | 'attackBlade'
  | 'attackArrow'
  | 'attackFire'
  | 'attackBolt'
  | 'attackSoft'
  | 'kill'
  | 'skill'
  | 'combo'
  | 'leak'
  | 'wave'
  | 'win'
  | 'lose'
  | 'ui'
  | 'deny'

interface Tone {
  /** 起始頻率 */
  freq: number
  /** 結束頻率（滑音）；省略等於不滑 */
  to?: number
  dur: number
  type?: OscillatorType
  gain?: number
  /** 加一層噪音（打擊感） */
  noise?: number
  /** 延遲幾秒才發（做出兩三段的和聲或連擊） */
  delay?: number
}

/** 每個音效的合成配方。改音色只要改這張表 */
const RECIPES: Record<SfxName, Tone[]> = {
  place: [{ freq: 320, to: 260, dur: 0.07, type: 'square', gain: 0.16, noise: 0.05 }],
  merge: [
    { freq: 440, dur: 0.06, type: 'triangle', gain: 0.16 },
    { freq: 660, dur: 0.1, type: 'triangle', gain: 0.14, delay: 0.05 },
  ],
  combine: [
    { freq: 392, dur: 0.1, type: 'triangle', gain: 0.16 },
    { freq: 523, dur: 0.1, type: 'triangle', gain: 0.15, delay: 0.07 },
    { freq: 659, dur: 0.16, type: 'triangle', gain: 0.14, delay: 0.14 },
  ],
  // 傳說以上：多一層低音鑼，聽得出「這次不一樣」
  combineBig: [
    { freq: 262, dur: 0.5, type: 'sine', gain: 0.2, noise: 0.06 },
    { freq: 392, dur: 0.16, type: 'triangle', gain: 0.16, delay: 0.06 },
    { freq: 523, dur: 0.16, type: 'triangle', gain: 0.15, delay: 0.13 },
    { freq: 784, dur: 0.3, type: 'triangle', gain: 0.13, delay: 0.2 },
  ],
  dissolve: [{ freq: 300, to: 150, dur: 0.16, type: 'sawtooth', gain: 0.1 }],

  attackBlade: [{ freq: 900, to: 400, dur: 0.05, type: 'square', gain: 0.055, noise: 0.09 }],
  attackArrow: [{ freq: 1500, to: 700, dur: 0.045, type: 'sine', gain: 0.05, noise: 0.05 }],
  attackFire: [{ freq: 180, to: 90, dur: 0.11, type: 'sawtooth', gain: 0.06, noise: 0.13 }],
  attackBolt: [{ freq: 2000, to: 300, dur: 0.06, type: 'square', gain: 0.055, noise: 0.11 }],
  attackSoft: [{ freq: 500, to: 320, dur: 0.05, type: 'triangle', gain: 0.045, noise: 0.04 }],

  kill: [{ freq: 700, to: 1100, dur: 0.06, type: 'triangle', gain: 0.07 }],
  skill: [
    { freq: 523, to: 784, dur: 0.13, type: 'triangle', gain: 0.15 },
    { freq: 1046, dur: 0.1, type: 'sine', gain: 0.1, delay: 0.1 },
  ],
  combo: [
    { freq: 196, dur: 0.55, type: 'sine', gain: 0.22, noise: 0.08 },
    { freq: 587, dur: 0.2, type: 'triangle', gain: 0.16, delay: 0.08 },
    { freq: 880, dur: 0.34, type: 'triangle', gain: 0.14, delay: 0.18 },
  ],
  leak: [{ freq: 220, to: 110, dur: 0.3, type: 'sawtooth', gain: 0.2, noise: 0.1 }],
  wave: [
    { freq: 330, dur: 0.1, type: 'triangle', gain: 0.13 },
    { freq: 494, dur: 0.16, type: 'triangle', gain: 0.12, delay: 0.09 },
  ],
  win: [
    { freq: 523, dur: 0.16, type: 'triangle', gain: 0.18 },
    { freq: 659, dur: 0.16, type: 'triangle', gain: 0.17, delay: 0.14 },
    { freq: 784, dur: 0.2, type: 'triangle', gain: 0.17, delay: 0.28 },
    { freq: 1046, dur: 0.5, type: 'triangle', gain: 0.16, delay: 0.42 },
  ],
  lose: [
    { freq: 300, to: 120, dur: 0.7, type: 'sawtooth', gain: 0.2 },
    { freq: 150, to: 70, dur: 0.9, type: 'sine', gain: 0.18, delay: 0.15 },
  ],
  ui: [{ freq: 600, dur: 0.035, type: 'square', gain: 0.09 }],
  deny: [{ freq: 200, to: 160, dur: 0.12, type: 'square', gain: 0.12 }],
}

/** 同一個音效在這段時間內只播一次（秒）。攻擊類必須節流 */
const THROTTLE: Partial<Record<SfxName, number>> = {
  attackBlade: 0.08,
  attackArrow: 0.08,
  attackFire: 0.12,
  attackBolt: 0.1,
  attackSoft: 0.1,
  kill: 0.05,
  place: 0.04,
}

export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private last = new Map<SfxName, number>()
  private _muted: boolean

  constructor(muted = false) {
    this._muted = muted
  }

  get muted(): boolean {
    return this._muted
  }

  setMuted(m: boolean): void {
    this._muted = m
    if (this.master && this.ctx) this.master.gain.value = m ? 0 : 0.9
  }

  /** 必須由使用者手勢觸發（點擊／觸控），否則瀏覽器會拒絕建立或維持 suspended */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    type WithLegacy = typeof window & { webkitAudioContext?: typeof AudioContext }
    const Ctor = window.AudioContext ?? (window as WithLegacy).webkitAudioContext
    if (!Ctor) return
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = this._muted ? 0 : 0.9
    this.master.connect(this.ctx.destination)

    // 預先做一段白噪音，打擊音靠它增加質感
    const len = Math.floor(this.ctx.sampleRate * 0.3)
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    let seed = 12345
    for (let i = 0; i < len; i++) {
      // 固定種子的偽隨機：不同機器聽起來一樣（也避免用 Math.random）
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      data[i] = (seed / 0x3fffffff - 1) * (1 - i / len)
    }
    this.noiseBuf = buf
  }

  play(name: SfxName, volume = 1): void {
    if (this._muted || !this.ctx || !this.master) return
    const now = this.ctx.currentTime
    const gap = THROTTLE[name]
    if (gap !== undefined && now - (this.last.get(name) ?? -1) < gap) return
    this.last.set(name, now)

    for (const tone of RECIPES[name]) {
      this.playTone(tone, now + (tone.delay ?? 0), volume)
    }
  }

  private playTone(t: Tone, at: number, volume: number): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = t.type ?? 'sine'
    osc.frequency.setValueAtTime(t.freq, at)
    if (t.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(30, t.to), at + t.dur)

    const peak = (t.gain ?? 0.15) * volume
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + t.dur)

    osc.connect(gain).connect(this.master!)
    osc.start(at)
    osc.stop(at + t.dur + 0.02)

    if (t.noise && this.noiseBuf) {
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuf
      const ng = ctx.createGain()
      ng.gain.setValueAtTime(t.noise * volume, at)
      ng.gain.exponentialRampToValueAtTime(0.0001, at + Math.min(t.dur, 0.12))
      src.connect(ng).connect(this.master!)
      src.start(at)
      src.stop(at + Math.min(t.dur, 0.3))
    }
  }
}
