import { useCallback, useEffect, useRef } from "react"

export interface ComposerFocusState {
  initial: boolean
  prefillAt: number
  seenPrefillAt: number
}

/**
 * 只响应明确要继续编辑的动作；普通切换旧会话不能把侧栏焦点抢走。
 *
 * 历史会话不再例外：它的输入框能打字也能发（发话时宿主先接回引擎），
 * 「改一改再发」、接不回来时退回的那句话，都该把焦点交还输入框。
 */
export function wantsComposerFocus(state: ComposerFocusState): boolean {
  return state.initial || state.prefillAt > state.seenPrefillAt
}

export function useComposerFocus(options: {
  initial: boolean
  prefillAt: number
}): {
  input: React.RefObject<HTMLTextAreaElement | null>
  focus: () => void
} {
  const input = useRef<HTMLTextAreaElement>(null)
  const seenPrefillAt = useRef(options.prefillAt)
  const focus = useCallback(() => {
    requestAnimationFrame(() => {
      if (input.current?.disabled === false) input.current.focus()
    })
  }, [])
  useEffect(() => {
    const state = { ...options, seenPrefillAt: seenPrefillAt.current }
    seenPrefillAt.current = options.prefillAt
    if (wantsComposerFocus(state)) focus()
  }, [focus, options.initial, options.prefillAt])
  return { input, focus }
}
