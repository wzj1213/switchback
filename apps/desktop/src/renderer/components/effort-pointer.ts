import type React from "react"

interface GripOptions {
  active: { current: number | undefined }
  pick: (event: React.PointerEvent<HTMLSpanElement>) => number
  onDrag: (index: number | undefined) => void
  onCommit: (index: number) => void
}

type GripHandlers = Pick<
  React.HTMLAttributes<HTMLSpanElement>,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture"
>

/**
 * 滑块的整段 pointer capture 生命周期。
 *
 * 活跃位放 ref，不放 React state：按下后的第一条 pointermove 完全可能早于那次
 * state 重绘；拿 state 当门闩就会吞掉第一段拖动。取消与 capture 丢失共用收尾，
 * 避免窗口切换后留下一枚永远“按住”的拇指。
 */
export function grip(options: GripOptions): GripHandlers {
  const cancel = (event: React.PointerEvent<HTMLSpanElement>): void => {
    if (options.active.current !== event.pointerId) return
    options.active.current = undefined
    options.onDrag(undefined)
  }
  return {
    onPointerDown: (event) => {
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return
      event.preventDefault()
      options.active.current = event.pointerId
      event.currentTarget.setPointerCapture(event.pointerId)
      options.onDrag(options.pick(event))
    },
    onPointerMove: (event) => {
      if (options.active.current === event.pointerId) options.onDrag(options.pick(event))
    },
    onPointerUp: (event) => {
      if (options.active.current !== event.pointerId) return
      const index = options.pick(event)
      options.active.current = undefined
      options.onDrag(undefined)
      options.onCommit(index)
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  }
}
