/**
 * 攻擊特效的畫法。sim 只給語義（FxKind + 攻擊者的字），顏色與形狀全部在這裡決定。
 *
 * 設計目標：**一眼看出是誰打的**。三個同時生效的線索——
 *   1. 形狀：刀是弧、箭是細線、火是火球、雷是鋸齒…
 *   2. 顏色：每種 fx 一個固定色
 *   3. 標籤：命中點會浮現攻擊者的字（武將顯示名字）
 * 再加上 renderer 會讓攻擊者本身閃一下同色外框（atkFlash）。
 */
import type { Effect, FxKind, Tier } from '../sim/types'
import { FONT_STACK } from './theme'

export const FX_COLOR: Record<FxKind, string> = {
  blade: '#33302c', // 墨黑：刀劍斧戟
  arrow: '#2f6b3f', // 墨綠：弓弩
  thrust: '#4a3f8f', // 靛藍：矛槍
  fire: '#d4622a', // 橘紅：火
  bolt: '#7a4fd4', // 紫：雷
  venom: '#3f8f4f', // 草綠：毒
  gale: '#3f8fc8', // 天藍：風
  plan: '#2f5f9f', // 藍：計
  charge: '#8a5a3b', // 土褐：騎步車盾
  none: 'transparent',
}

const TIER_WIDTH: Record<Tier, number> = {
  common: 1,
  fine: 1.15,
  epic: 1.3,
  legendary: 1.5,
  mythic: 1.7,
}

export interface FxGeom {
  x1: number
  y1: number
  x2: number
  y2: number
  cell: number
}

/** 畫一次攻擊。t 由 1 遞減到 0 */
export function drawAttack(ctx: CanvasRenderingContext2D, e: Effect, g: FxGeom, t: number): void {
  const fx = e.fx ?? 'blade'
  if (fx === 'none') return
  const color = FX_COLOR[fx]
  const w = TIER_WIDTH[e.tier ?? 'common']
  const { x1, y1, x2, y2, cell } = g

  ctx.save()
  ctx.globalAlpha = Math.min(1, t * 1.3)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'

  switch (fx) {
    case 'blade':
      drawCrescent(ctx, x2, y2, cell * 0.55, cell * 0.13 * w, 1 - t)
      break

    case 'arrow': {
      ctx.lineWidth = cell * 0.045 * w
      const head = travel(x1, y1, x2, y2, 1)
      const tail = travel(x1, y1, x2, y2, Math.max(0, 1 - 0.35 - t * 0.3))
      ctx.beginPath()
      ctx.moveTo(tail.x, tail.y)
      ctx.lineTo(head.x, head.y)
      ctx.stroke()
      dot(ctx, head.x, head.y, cell * 0.055 * w)
      break
    }

    case 'thrust': {
      ctx.lineWidth = cell * 0.11 * w
      const from = travel(x1, y1, x2, y2, 0.25)
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      diamond(ctx, x2, y2, cell * 0.13 * w)
      break
    }

    case 'fire': {
      const r = cell * (0.2 + (1 - t) * 0.22) * w
      ctx.globalAlpha = t * 0.85
      dot(ctx, x2, y2, r)
      ctx.globalAlpha = t
      ctx.lineWidth = cell * 0.05
      ctx.beginPath()
      ctx.arc(x2, y2, r * 1.7, 0, Math.PI * 2)
      ctx.stroke()
      // 火星拖尾
      for (let i = 1; i <= 2; i++) {
        const p = travel(x1, y1, x2, y2, 1 - i * 0.18)
        dot(ctx, p.x, p.y, cell * 0.05)
      }
      break
    }

    case 'bolt': {
      ctx.lineWidth = cell * 0.055 * w
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      const seg = 4
      for (let i = 1; i <= seg; i++) {
        const p = travel(x1, y1, x2, y2, i / seg)
        // 鋸齒：垂直方向左右擺動，擺幅隨段數收斂
        const nx = -(y2 - y1)
        const ny = x2 - x1
        const len = Math.hypot(nx, ny) || 1
        const swing = (i % 2 === 0 ? 1 : -1) * cell * 0.16 * (1 - i / seg)
        ctx.lineTo(p.x + (nx / len) * swing, p.y + (ny / len) * swing)
      }
      ctx.stroke()
      break
    }

    case 'venom': {
      ctx.lineWidth = cell * 0.05
      ctx.setLineDash([cell * 0.1, cell * 0.09])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.setLineDash([])
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + (1 - t) * 2
        dot(ctx, x2 + Math.cos(a) * cell * 0.22, y2 + Math.sin(a) * cell * 0.22, cell * 0.055)
      }
      break
    }

    case 'gale': {
      ctx.lineWidth = cell * 0.06 * w
      for (let i = 0; i < 2; i++) {
        const r = cell * (0.28 + i * 0.16 + (1 - t) * 0.2)
        const rot = (1 - t) * 1.5 + i
        ctx.beginPath()
        ctx.arc(x2, y2, r, rot, rot + Math.PI * 0.9)
        ctx.stroke()
      }
      break
    }

    case 'plan': {
      // 「計」的特效就是把字丟出去
      const p = travel(x1, y1, x2, y2, 1 - t * 0.7)
      ctx.font = `700 ${Math.round(cell * 0.42)}px ${FONT_STACK}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(e.glyph?.[0] ?? '計', p.x, p.y)
      break
    }

    case 'charge': {
      ctx.lineWidth = cell * 0.075 * w
      for (let i = 0; i < 3; i++) {
        const r = cell * (0.16 + i * 0.12 + (1 - t) * 0.18)
        ctx.globalAlpha = t * (0.7 - i * 0.18)
        ctx.beginPath()
        ctx.arc(x2, y2, r, Math.PI * 0.15, Math.PI * 0.85)
        ctx.stroke()
      }
      break
    }
  }

  ctx.restore()

  // 命中點標籤：直接告訴玩家是誰打的
  if (e.glyph && fx !== 'plan') {
    ctx.save()
    ctx.globalAlpha = t * 0.9
    ctx.fillStyle = color
    const size = Math.round(cell * (e.glyph.length > 1 ? 0.24 : 0.3))
    ctx.font = `700 ${size}px ${FONT_STACK}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(e.glyph, x2, y2 - cell * (0.42 + (1 - t) * 0.25))
    ctx.restore()
  }
}

/** 濺射的擴散圈也跟著 fx 換色 */
export function splashColor(fx: FxKind | undefined): string {
  return FX_COLOR[fx ?? 'blade']
}

// ── 小工具 ────────────────────────────────────────────
function travel(x1: number, y1: number, x2: number, y2: number, f: number): { x: number; y: number } {
  return { x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f }
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r * 0.6, y)
  ctx.lineTo(x, y + r)
  ctx.lineTo(x - r * 0.6, y)
  ctx.closePath()
  ctx.fill()
}

/** 弧形斬擊：以命中點為圓心的一段圓弧，隨時間掃過 */
function drawCrescent(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  width: number,
  progress: number,
): void {
  const start = -Math.PI * 0.75 + progress * Math.PI * 0.6
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.arc(x, y, r, start, start + Math.PI * 0.75)
  ctx.stroke()
}
