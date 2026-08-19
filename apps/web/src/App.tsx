import { useCallback, useEffect, useState } from "react"
import type { ThreadId } from "@omni/protocol"
import { projectsOf, threadRowsOf } from "@omni/store"
import { forgetToken, tokenOf } from "./auth.js"
import { useRemote } from "./useRemote.js"
import { Pair } from "./screens/Pair.js"
import { Threads } from "./screens/Threads.js"
import { Thread } from "./screens/Thread.js"
import { NewThread } from "./screens/NewThread.js"
import { ConnBar } from "./components/ConnBar.js"
import { Notices } from "./components/Notices.js"

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
/**
 * 新建那一屏。**单独一个组件**：`App` 已经贴着行数闸门，
 * 而这一屏和「列表 + 正文」那两栏没有任何共用的布局。
 */
function Creating({
  remote,
  onDone,
}: {
  remote: ReturnType<typeof useRemote>
  onDone: () => void
}): React.JSX.Element {
  return (
    <div className="app">
      <ConnBar conn={remote.conn} onRetry={remote.retry} />
      {/* **建失败就发生在这一屏**：引擎没装、登录过期、目录不在了。
          不画的话按钮按下去毫无反应，人只会连按四次 */}
      <Notices notices={remote.state.notices} wire={remote.notice} onDismissWire={remote.dismissNotice} />
      <NewThread
        projects={projectsOf(threadRowsOf(remote.state))}
        engines={remote.state.engines}
        maxTrust={remote.me?.maxTrust ?? "auto-edit"}
        hydrated={remote.hydrated}
        offline={remote.conn.kind !== "open"}
        onCreate={(command) => {
          const sent = remote.send(command)
          // **发不出去就留在这一屏。** 宿主建好会推一条 `thread.started` 进列表；
          // 而断线时 `send` 返回 false，那时候切回列表等于让人以为开成了
          if (sent) onDone()
          return sent
        }}
        onCancel={onDone}
      />
    </div>
  )
}

/**
 * 和浏览器/系统打交道的那几根线：通知点进来的深链、前进后退。
 *
 * **单独一个 hook**：`App` 已经贴着行数闸门，而这两件事和「渲染哪一屏」
 * 是两回事——它们回答的是「外面发生了什么，该选中谁」。
 *
 * 手机上返回键就是「返回列表」——不接的话，人按返回直接退出应用，
 * 而他只是想回到上一屏。
 */
function useHistory(
  setSelected: (id: ThreadId | undefined) => void,
  setCreating: (on: boolean) => void,
  watch: (id: ThreadId | null) => void,
): void {
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
    // **必须判存在。** 非安全上下文（明文 http，而且不是 localhost）里
    // `navigator.serviceWorker` 整个是 undefined——不判的话这里当场抛，
    // React 把整棵树卸掉，**用户看到的是一片白屏**，而这恰好是
    // 「先在局域网上用 IP 试一下」这条最常见的第一步路径
    const worker = navigator.serviceWorker as ServiceWorkerContainer | undefined
    if (worker === undefined) return undefined
    worker.addEventListener("message", onMessage)
    return () => {
      worker.removeEventListener("message", onMessage)
    }
  }, [watch])
  useEffect(() => {
    // 打好基底：首屏那一项也带上 state，前进/后退才对得起来
    window.history.replaceState({ omni: undefined }, "")
    const onPop = (event: PopStateEvent): void => {
      const at = event.state as { omni?: ThreadId; creating?: boolean } | null
      // **新建屏也是一层。** 不压进历史的话，人在那一屏上做返回手势
      // 会直接退出整个应用——而他只是想回列表
      setCreating(at?.creating === true)
      const id = at?.omni
      setSelected(id)
      watch(id ?? null)
    }
    window.addEventListener("popstate", onPop)
    return () => {
      window.removeEventListener("popstate", onPop)
    }
  }, [watch])
}

export function App(): React.JSX.Element {
  const [token, setToken] = useState(tokenOf)
  const [selected, setSelected] = useState<ThreadId | undefined>(undefined)
  const [creating, setCreating] = useState(false)
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
  useHistory(setSelected, setCreating, watch)

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

  if (creating) {
    return (
      <Creating
        remote={remote}
        onDone={() => {
          // 走 `back()` 而不是直接 setState：这样返回键和界面上的「‹」
          // 走的是同一条路，历史里也不会留下一层回不去的
          window.history.back()
        }}
      />
    )
  }

  return (
    <div className="app" data-detail={thread === undefined ? "no" : "yes"}>
      <ConnBar conn={remote.conn} onRetry={remote.retry} />
      <Notices notices={remote.state.notices} wire={remote.notice} onDismissWire={remote.dismissNotice} />
      <div className="app__panes">
        <aside className="pane pane--list">
          <Threads
            remote={remote}
            selected={selected}
            onOpen={open}
            onUnpair={unpair}
            token={token}
            onNew={() => {
              window.history.pushState({ creating: true }, "")
              setCreating(true)
            }}
          />
        </aside>
        <main className="pane pane--detail">
          {thread === undefined ? (
            <p className="empty">选一条会话，或者点右上角开一条新的。</p>
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
