import './style.css'
import { App } from './app'
import { registerServiceWorker } from './core/pwa'
import { loadMeta } from './core/save'
import * as actions from './sim/actions'
import * as state from './sim/state'

const canvas = document.getElementById('game') as HTMLCanvasElement | null
if (!canvas) throw new Error('找不到 #game canvas')

const app = new App(canvas, loadMeta())
registerServiceWorker()

/**
 * 開發用掛載點（正式版可移除）。
 *   __game.state              檢查目前狀態
 *   __dev.give('張','飛')      塞字進手牌
 *   __dev.put('張',0,1)        直接放到 (col,row)
 * 詳見 docs/llm-wiki/03-change-recipes.md
 */
const dev = {
  app,
  actions,
  state,
  give(...chars: string[]): void {
    for (const ch of chars) {
      const i = app.state.hand.findIndex((h) => h === null)
      if (i >= 0) app.state.hand[i] = { char: ch, level: 1 }
    }
    state.recalcUnits(app.state)
  },
  put(char: string, col: number, row: number, level = 1): void {
    const cell = row * app.state.board.cols + col
    app.state.units.push(state.makeGlyphUnit(app.state, char, level, cell))
    actions.tryCombine(app.state, cell)
    state.recalcUnits(app.state)
  },
}

Object.assign(window, { __game: app, __dev: dev })
