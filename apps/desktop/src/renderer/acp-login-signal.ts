import { useEffect } from "react"
import type { Notice } from "@omni/store"

/**
 * 「某一家刚登录成功」这件事，从设置页那张卡传到横幅那一层。
 *
 * 两处隔着设置面板、外壳、工作区好几层，为一件事一路递回调不划算；
 * 和 `turn-review.ts` 同一个做法，走窗口上的一个自定义事件。
 */
const EVENT = "omni:acp-logged-in"

export function announceLoggedIn(engine: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: engine }))
}

/**
 * 那一家登录成功后，收起说它「需要登录」的横幅——那句话已经不是真的了。
 * **只收那一家的**：别家还没登的，横幅照旧挂着。
 */
export function useAuthNotices(notices: readonly Notice[], dismiss: (id: string) => void): void {
  useEffect(() => {
    const receive = (event: Event): void => {
      const engine = (event as CustomEvent<string | undefined>).detail
      for (const notice of notices) if (notice.kind === "auth" && notice.engine === engine) dismiss(notice.id)
    }
    window.addEventListener(EVENT, receive)
    return () => {
      window.removeEventListener(EVENT, receive)
    }
  }, [notices, dismiss])
}
