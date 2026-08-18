import { useCallback, useEffect, useState } from "react"
import type { ThreadId } from "@omni/protocol"
import { forgetToken, tokenOf } from "./auth.js"
import { useRemote } from "./useRemote.js"
import { Pair } from "./screens/Pair.js"
import { Threads } from "./screens/Threads.js"
import { Thread } from "./screens/Thread.js"
import { ConnBar } from "./components/ConnBar.js"

/**
 * 两屏一栏：手机上一次只看一屏（列表 ↔ 正文），桌面浏览器上并排。
 *
 * **没有路由库**。这一端只有三个状态（没配对 / 看列表 / 看某一条），
 * 引一个路由器进来换不到任何东西，却要多背一份 history 的心智模型。
 * 用 `history` 只为了让**返回**能回到列表——手机上那是返回手势，
 * 桌面上那是浏览器的返回键（两栏并排时 `.thread__back` 是隐藏的，
 * 返回键是唯一入口）。
 *
 * ## 两条容易写错的
 *
 * 1. **从列表进正文才 push，正文里换一条要 replace。** 否则点开五条会话
 *    就压了五层，返回键要按满五次才离得开这一页。
 * 2. **`popstate` 必须读 `event.state`**，不能一律当成「回到列表」。
 *    不读的话前进键落回正文那一项时，界面恢复不了。
 */
export function App(): React.JSX.Element {
  const [token, setToken] = useState(tokenOf)
  const [selected, setSelected] = useState<ThreadId | undefined>(undefined)
  const remote = useRemote(token)

  const { watch } = remote

  const open = useCallback(
    (id: ThreadId | undefined) => {
      setSelected((prev) => {
        // 从列表进正文压一层；正文里换一条只替换——否则返回键要按满 N 次
        if (id === undefined) window.history.back()
        else if (prev === undefined) window.history.pushState({ omni: id }, "")
        else window.history.replaceState({ omni: id }, "")
        return id
      })
      watch(id ?? null)
    },
    [watch],
  )

  // 从通知点进来的：`?thread=` 是新开窗口那条路，`postMessage` 是
  // 已经开着一扇窗那条路（service worker 优先找已开的那扇，见 `public/sw.js`）
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("thread")
    if (wanted !== null && wanted !== "") {
      setSelected(wanted)
      watch(wanted)
      window.history.replaceState({ omni: wanted }, "", "/")
    }
    const onMessage = (event: MessageEvent<{ type?: string; threadId?: string }>): void => {
      if (event.data.type !== "open-thread") return
      const id = event.data.threadId
      if (id === undefined || id === "") return
      setSelected(id)
      watch(id)
    }
    navigator.serviceWorker.addEventListener("message", onMessage)
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage)
    }
  }, [watch])

  useEffect(() => {
    // 打好基底：首屏那一项也带上 state，前进/后退才对得起来
    window.history.replaceState({ omni: undefined }, "")
    const onPop = (event: PopStateEvent): void => {
      const id = (event.state as { omni?: ThreadId } | null)?.omni
      setSelected(id)
      watch(id ?? null)
    }
    window.addEventListener("popstate", onPop)
    return () => {
      window.removeEventListener("popstate", onPop)
    }
  }, [watch])

  const paired = useCallback((next: string) => {
    setToken(next)
  }, [])

  const unpair = useCallback(() => {
    forgetToken()
    setToken("")
  }, [])

  if (token === "" || remote.conn.kind === "unauthorized") {
    return <Pair onPaired={paired} expired={token !== ""} />
  }

  const thread = selected === undefined ? undefined : remote.state.threads[selected]

  return (
    <div className="app" data-detail={thread === undefined ? "no" : "yes"}>
      <ConnBar conn={remote.conn} onRetry={remote.retry} />
      {remote.notice === undefined ? null : (
        <div className="notice" role="alert">
          <span className="notice__text">{remote.notice}</span>
          <button className="btn btn--ghost" type="button" onClick={remote.dismissNotice} aria-label="知道了">
            ✕
          </button>
        </div>
      )}
      <div className="app__panes">
        <aside className="pane pane--list">
          <Threads remote={remote} selected={selected} onOpen={open} onUnpair={unpair} token={token} />
        </aside>
        <main className="pane pane--detail">
          {thread === undefined ? (
            <p className="empty">选一条会话，或者在桌面上新建一条。</p>
          ) : (
            <Thread
              remote={remote}
              thread={thread}
              onBack={() => {
                window.history.back()
              }}
            />
          )}
        </main>
      </div>
    </div>
  )
}
