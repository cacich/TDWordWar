/**
 * 固定步長模擬 + 可變渲染。
 * 模擬永遠以 1/60 秒推進，確保不同裝置行為一致（也讓自動平衡模擬可重現）。
 */
export const FIXED_DT = 1 / 60
const MAX_STEPS_PER_FRAME = 8

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
    render(acc / FIXED_DT)
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
    },
    get paused() {
      return paused
    },
    get speed() {
      return speed
    },
  }
}
