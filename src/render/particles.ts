/**
 * 粒子系統。純呈現層：由 app 層把 sim 事件轉成噴發，sim 完全不知道它的存在。
 *
 * 刻意保持極簡：位置／速度／壽命／顏色／大小，沒有物理引擎。
 * 上限 240 顆，超過就不再新增（畫面已經夠亂了，多了也看不出來）。
 */
import { TIER_COLOR } from './theme'
import type { Tier } from '../sim/types'

const MAX = 240

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
  /** 重力（格/秒²）。0 表示不受重力 */
  g: number
}

export class Particles {
  private list: Particle[] = []
  /** 固定種子的偽隨機：不用 Math.random，粒子分布在同機器上可重現 */
  private seed = 987654321

  private rnd(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff
    return this.seed / 0x7fffffff
  }

  private spread(n: number): number {
    return (this.rnd() - 0.5) * n
  }

  get count(): number {
    return this.list.length
  }

  clear(): void {
    this.list.length = 0
  }

  private add(p: Particle): void {
    if (this.list.length >= MAX) return
    this.list.push(p)
  }

  /** 擊殺：往上噴的墨點 */
  kill(x: number, y: number): void {
    for (let i = 0; i < 7; i++) {
      this.add({
        x,
        y,
        vx: this.spread(3),
        vy: -this.rnd() * 2 - 0.5,
        life: 0.45,
        maxLife: 0.45,
        size: 0.05 + this.rnd() * 0.05,
        color: '#3a3a3a',
        g: 6,
      })
    }
  }

  /** 成將：階級色的環狀爆發，階級越高越多 */
  combine(x: number, y: number, tier: Tier): void {
    const color = TIER_COLOR[tier]
    const n = tier === 'common' ? 8 : tier === 'fine' ? 12 : tier === 'epic' ? 16 : 22
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const speed = 2.2 + this.rnd() * 1.4
      this.add({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0.6,
        maxLife: 0.6,
        size: 0.06 + this.rnd() * 0.05,
        color,
        g: 0,
      })
    }
  }

  /** 技能：金色向上飄的火花 */
  skill(x: number, y: number): void {
    for (let i = 0; i < 12; i++) {
      this.add({
        x: x + this.spread(0.6),
        y: y + this.spread(0.6),
        vx: this.spread(1.2),
        vy: -1 - this.rnd() * 1.5,
        life: 0.7,
        maxLife: 0.7,
        size: 0.05 + this.rnd() * 0.04,
        color: '#d9a520',
        g: -1.5,
      })
    }
  }

  /** 組合技：全屏紅金噴發 */
  combo(x: number, y: number): void {
    for (let i = 0; i < 26; i++) {
      const a = this.rnd() * Math.PI * 2
      const speed = 1.5 + this.rnd() * 4
      this.add({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0.9,
        maxLife: 0.9,
        size: 0.06 + this.rnd() * 0.07,
        color: i % 2 === 0 ? '#d9a520' : '#c8402f',
        g: 1.5,
      })
    }
  }

  /** 漏怪：大營附近的紅色潑濺 */
  leak(x: number, y: number): void {
    for (let i = 0; i < 14; i++) {
      this.add({
        x,
        y,
        vx: this.spread(5),
        vy: -this.rnd() * 3,
        life: 0.8,
        maxLife: 0.8,
        size: 0.07 + this.rnd() * 0.06,
        color: '#c8402f',
        g: 8,
      })
    }
  }

  /** 疊合升階：品質色的小圈 */
  merge(x: number, y: number, color: string): void {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      this.add({
        x,
        y,
        vx: Math.cos(a) * 1.6,
        vy: Math.sin(a) * 1.6 - 0.6,
        life: 0.45,
        maxLife: 0.45,
        size: 0.045,
        color,
        g: 2,
      })
    }
  }

  step(dt: number): void {
    if (!this.list.length) return
    const keep: Particle[] = []
    for (const p of this.list) {
      p.life -= dt
      if (p.life <= 0) continue
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += p.g * dt
      keep.push(p)
    }
    this.list = keep
  }

  /** gx/gy 把「格」座標換算成畫布 px；cell 是格子邊長 */
  draw(
    ctx: CanvasRenderingContext2D,
    gx: (x: number) => number,
    gy: (y: number) => number,
    cell: number,
  ): void {
    if (!this.list.length) return
    ctx.save()
    for (const p of this.list) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife)
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(gx(p.x), gy(p.y), Math.max(0.7, p.size * cell), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}
