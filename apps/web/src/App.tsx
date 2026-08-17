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
 * 用 `history.pushState` 只为了让**手机上的返回手势**能回到列表——
 * 那是这块屏幕上最常用的一个动作，缺了它整个界面就像个坏掉的网页。
 */
export function App(): React.JSX.Element {
  const [token, setToken] = useState(tokenOf)
  const [selected, setSelected] = useState<ThreadId | undefined>(undefined)
  const remote = useRemote(token)

  const open = useCallback(
    (id: ThreadId | undefined) => {
      setSelected(id)
      remote.watch(id ?? null)
      // 进正文时压一个历史项，返回手势就回得到列表
      if (id !== undefined) window.history.pushState({ omni: id }, "")
    },
    [remote],
  )

  useEffect(() => {
    const back = (): void => {
      setSelected(undefined)
      remote.watch(null)
    }
    window.addEventListener("popstate", back)
    return () => {
      window.removeEventListener("popstate", back)
    }
  }, [remote])

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
      <div className="app__panes">
        <aside className="pane pane--list">
          <Threads remote={remote} selected={selected} onOpen={open} onUnpair={unpair} />
        </aside>
        <main className="pane pane--detail">
          {thread === undefined ? (
            <p className="empty">选一条会话，或者在桌面上新建一条。</p>
          ) : (
            <Thread remote={remote} thread={thread} onBack={() => { window.history.back() }} />
          )}
        </main>
      </div>
    </div>
  )
}
