import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react"

/**
 * 滑块收起的唯一生命周期。
 *
 * pointerdown、blur 与 Escape 可能在同一击里先后到达；只允许第一条计时器落地，
 * 但后来的 Escape 仍可把“收完还焦点”并进这一轮。卸载时连补焦点的 rAF 一起撤。
 */
export function useEffortClose(input: {
  reduced: boolean
  trigger: React.RefObject<HTMLButtonElement | null>
  setOpen: Dispatch<SetStateAction<boolean>>
  setClosing: Dispatch<SetStateAction<boolean>>
}): (refocus: boolean) => void {
  const timer = useRef(0)
  const focusFrame = useRef(0)
  const refocusAfterClose = useRef(false)

  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      cancelAnimationFrame(focusFrame.current)
    },
    [],
  )

  return useCallback(
    (refocus: boolean): void => {
      refocusAfterClose.current ||= refocus
      if (timer.current !== 0) return
      const finish = (): void => {
        timer.current = 0
        input.setOpen(false)
        input.setClosing(false)
        if (!refocusAfterClose.current) return
        refocusAfterClose.current = false
        focusFrame.current = requestAnimationFrame(() => {
          focusFrame.current = 0
          input.trigger.current?.focus()
        })
      }
      input.setClosing(true)
      if (input.reduced) finish()
      else timer.current = window.setTimeout(finish, 190)
    },
    [input.reduced, input.setClosing, input.setOpen, input.trigger],
  )
}
