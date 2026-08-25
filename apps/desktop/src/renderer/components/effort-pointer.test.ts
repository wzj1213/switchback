import { describe, expect, it } from "vitest"
import type { PointerEvent as ReactPointerEvent } from "react"
import { grip } from "./effort-pointer.js"

function pointer(x: number, pointerId = 7): ReactPointerEvent<HTMLSpanElement> {
  return {
    isPrimary: true,
    pointerType: "mouse",
    button: 0,
    pointerId,
    clientX: x,
    preventDefault: () => undefined,
    currentTarget: { setPointerCapture: () => undefined },
  } as unknown as ReactPointerEvent<HTMLSpanElement>
}

describe("effort 指针生命周期", () => {
  it("按下后的第一段移动不等重绘，取消后也不会继续拖或误提交", () => {
    const active = { current: undefined as number | undefined }
    const dragged: (number | undefined)[] = []
    const committed: number[] = []
    const handlers = grip({
      active,
      pick: (event) => event.clientX,
      onDrag: (index) => dragged.push(index),
      onCommit: (index) => committed.push(index),
    })

    handlers.onPointerDown?.(pointer(2))
    handlers.onPointerMove?.(pointer(99, 8))
    handlers.onPointerMove?.(pointer(3))
    handlers.onPointerCancel?.(pointer(3))
    handlers.onPointerMove?.(pointer(4))

    expect(dragged).toEqual([2, 3, undefined])
    expect(committed).toEqual([])
    expect(active.current).toBeUndefined()

    handlers.onPointerDown?.(pointer(5))
    handlers.onPointerUp?.(pointer(6))
    expect(dragged).toEqual([2, 3, undefined, 5, undefined])
    expect(committed).toEqual([6])
  })
})
