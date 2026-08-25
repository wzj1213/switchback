/**
 * Canvas 特效的两档时钟：动时跟屏幕刷新，静时慢拍；窗口不可见时彻底停。
 *
 * 句柄在回调入口先清零。否则一个已经触发过的 timeout 仍像“活着”，
 * ResizeObserver 再来唤醒时就会额外开一条 rAF，之后两条循环会各自续命。
 */

export interface FxLoopHost {
  hidden: () => boolean
  now: () => number
  requestFrame: (run: (at: number) => void) => number
  cancelFrame: (id: number) => void
  setIdle: (run: () => void, ms: number) => number
  clearIdle: (id: number) => void
}

export interface FxLoop {
  /** 第一次启动，或尺寸/主题变化后要求下一帧立刻重画。 */
  wake: () => void
  /** 页面转入后台：取消两档时钟，但保留世界。 */
  pause: () => void
  /** 组件卸载：此后不再接受唤醒。 */
  stop: () => void
}

export function createFxLoop(
  host: FxLoopHost,
  step: (at: number) => boolean,
  idleMs: number,
): FxLoop {
  // rAF id 理论上会溢出到 0；undefined 才是可靠的“没有句柄”。
  const handles: { frame?: number; idle?: number } = {}
  const state = { stopped: false }

  const pause = (): void => {
    if (handles.frame !== undefined) host.cancelFrame(handles.frame)
    if (handles.idle !== undefined) host.clearIdle(handles.idle)
    handles.frame = undefined
    handles.idle = undefined
  }
  const queueFrame = (): void => {
    if (state.stopped || host.hidden() || handles.frame !== undefined) return
    handles.frame = host.requestFrame(onFrame)
  }
  const queueIdle = (): void => {
    if (state.stopped || host.hidden() || handles.idle !== undefined) return
    handles.idle = host.setIdle(onIdle, idleMs)
  }
  const tick = (at: number): void => {
    if (state.stopped || host.hidden()) return
    if (step(at)) queueFrame()
    else queueIdle()
  }
  function onFrame(at: number): void {
    handles.frame = undefined
    tick(at)
  }
  function onIdle(): void {
    handles.idle = undefined
    tick(host.now())
  }
  const wake = (): void => {
    if (state.stopped || host.hidden() || handles.frame !== undefined) return
    if (handles.idle !== undefined) {
      host.clearIdle(handles.idle)
      handles.idle = undefined
    }
    queueFrame()
  }
  const stop = (): void => {
    state.stopped = true
    pause()
  }
  return { wake, pause, stop }
}
