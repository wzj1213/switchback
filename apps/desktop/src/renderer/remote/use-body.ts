import { useSyncExternalStore } from "react"

const never = (): (() => void) => () => undefined
const zero = (): number => 0

/**
 * 这条会话的正文到了没有、被裁过没有（远程窗口，见 `bodies.ts`）。
 *
 * 本机窗口的桥没有 `bodies`：恒为「到了、没裁」，订阅也是个空操作——
 * 这个 hook 挂在两种窗口共用的转录区上，本机那边一点额外的事都不做。
 */
export function useBody(threadId: string): { pending: boolean; trimmed: boolean } {
  const bodies = typeof window === "undefined" ? undefined : window.switchback?.bodies
  useSyncExternalStore(bodies?.subscribe ?? never, bodies?.version ?? zero)
  return { pending: bodies?.pending(threadId) ?? false, trimmed: bodies?.trimmed(threadId) ?? false }
}
