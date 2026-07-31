/**
 * 固定步長模擬 + 可變渲染。
 * 模擬永遠以 1/60 秒推進，確保不同裝置行為一致（也讓自動平衡模擬可重現）。
 */
export const FIXED_DT = 1 / 60
const MAX_STEPS_PER_FRAME = 8
/**
 * 繪製的最短間隔（秒）。**省電旋鈕**：模擬本來就是固定 1/60 步長，
 * 但 requestAnimationFrame 在 90／120Hz 的手機上會每秒叫 90～120 次，
 * 於是「畫面」白白多畫了一倍——同一份 state 畫兩次，肉眼看不出差別，電池與溫度卻真的付了。
 * 12ms 的門檻讓 120Hz 隔幀繪製（≈60fps），60Hz 則完全不受影響（間隔 16.7ms 從不觸發）。
 */
const MIN_FRAME = 0.012

export interface LoopHandle {
  stop(): void
  setSpeed(mul: number): void
  setPaused(p: boolean): void
  get paused(): boolean
  get speed(): number
}

export function startLoop(
  step: (dt: number) => void,
  render: (alpha: number) => void,
): LoopHandle {
  let acc = 0
  let last = performance.now()
  let raf = 0
  let speed = 1
  let paused = false
  /** 距離上次繪製累積的時間，用來實作 MIN_FRAME 的節流 */
  let sinceDraw = 0

  const frame = (now: number) => {
    const elapsed = Math.min((now - last) / 1000, 0.25)
    last = now
    if (!paused) {
      acc += elapsed * speed
      let steps = 0
      while (acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        step(FIXED_DT)
        acc -= FIXED_DT
        steps++
      }
      if (steps === MAX_STEPS_PER_FRAME) acc = 0 // 掉幀保護：放棄補算
    }
    // ⚠ 模擬照跑、只跳過繪製：高刷新率螢幕上少畫的那些幀沒有任何資訊量
    sinceDraw += elapsed
    if (sinceDraw >= MIN_FRAME) {
      sinceDraw = 0
      render(acc / FIXED_DT)
    }
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  return {
    stop: () => cancelAnimationFrame(raf),
    setSpeed: (m) => {
      speed = m
    },
    setPaused: (p) => {
      paused = p
      last = performance.now()
      sinceDraw = MIN_FRAME // 暫停／回到遊戲的那一刻要立刻重畫，不要等節流
    },
    get paused() {
      return paused
    },
    get speed() {
      return speed
    },
  }
}
