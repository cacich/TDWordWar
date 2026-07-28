/**
 * 水墨紙感配色。全部視覺都由 Canvas 幾何繪製，專案零外部圖片資源。
 */
import type { Tier } from '../sim/types'

export const THEME = {
  paper: '#f2e9d6',
  paperEdge: '#e2d5ba',
  ink: '#2b2b2b',
  inkSoft: '#6b6257',
  plotA: '#fdfaf0',
  plotB: '#dfe9de',
  plotLine: '#c9bfa8',
  path: '#c9ac8b',
  pathDash: '#a8845f',
  block: '#b5a48c',
  camp: '#cf9f6a',
  spawn: '#8d8471',
  enemy: '#3a3a3a',
  enemyHp: '#c8402f',
  enemyHpBg: '#e7d9c2',
  hintGreen: 'rgba(60,160,90,0.55)',
  hintRed: 'rgba(200,60,50,0.45)',
  hintMerge: 'rgba(60,120,220,0.5)',
  hintSwap: 'rgba(150,90,210,0.5)',
  gold: '#d9a520',
} as const

export const TIER_COLOR: Record<Tier, string> = {
  common: '#8b8b8b',
  fine: '#3b6fd4',
  epic: '#8a4fd4',
  legendary: '#d9a520',
  mythic: '#d43b3b',
}

/** 武將本體的底色：組成字牌會鋪上這層淡色，讓整個武將讀起來是「一塊」而不是零散白卡 */
export const TIER_TINT: Record<Tier, string> = {
  common: '#e9e6df',
  fine: '#dfe8fb',
  epic: '#ece2fb',
  legendary: '#f6eccb',
  mythic: '#f7dede',
}

/** 場上提示光暈：可疊合升級＝綠、可湊將＝金 */
export const HINT_COLOR = {
  upgrade: '#3f9f5a',
  combine: '#d9a520',
} as const

/** 字牌品質階級的顏色：一階灰 → 五階金。兩個同階同字可疊成上一階 */
export const QUALITY_COLOR = ['#9a9a9a', '#3f8f4f', '#3b6fd4', '#8a4fd4', '#d9a520'] as const

export function qualityColor(level: number): string {
  return QUALITY_COLOR[Math.min(Math.max(level, 1), QUALITY_COLOR.length) - 1]
}

export const STATUS_COLOR = {
  burn: '#d4622a',
  slow: '#4a8fd4',
  stun: '#d9a520',
  vuln: '#a54fd4',
} as const

export const TIER_LABEL: Record<Tier, string> = {
  common: '普通',
  fine: '精良',
  epic: '史詩',
  legendary: '傳說',
  mythic: '神話',
}

export const FONT_STACK = '"Noto Serif TC","Songti TC","PMingLiU","Microsoft JhengHei",serif'

export function glyphFont(px: number, bold = true): string {
  return `${bold ? '700 ' : ''}${Math.round(px)}px ${FONT_STACK}`
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
