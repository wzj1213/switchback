import { useCallback, useEffect, useRef } from "react"

export interface ComposerFocusState {
  detached: boolean
  initial: boolean
  wasDetached: boolean
  prefillAt: number
  seenPrefillAt: number
}

/** 只响应明确要继续编辑的动作；普通切换旧会话不能把侧栏焦点抢走。 */
export function wantsComposerFocus(state: ComposerFocusState): boolean {
  if (state.detached) return false
  return state.initial || state.wasDetached || state.prefillAt > state.seenPrefillAt
}

export function useComposerFocus(options: {
  detached: boolean
  initial: boolean
  prefillAt: number
}): {
  input: React.RefObject<HTMLTextAreaElement | null>
  focus: () => void
} {
  const input = useRef<HTMLTextAreaElement>(null)
  const wasDetached = useRef(options.detached)
  const seenPrefillAt = useRef(options.prefillAt)
  const focus = useCallback(() => {
    requestAnimationFrame(() => {
      if (input.current?.disabled === false) input.current.focus()
    })
  }, [])
  useEffect(() => {
    const state = {
      ...options,
      wasDetached: wasDetached.current,
      seenPrefillAt: seenPrefillAt.current,
    }
    wasDetached.current = options.detached
    seenPrefillAt.current = options.prefillAt
    if (wantsComposerFocus(state)) focus()
  }, [focus, options.detached, options.initial, options.prefillAt])
  return { input, focus }
}
