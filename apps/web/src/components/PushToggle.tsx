import { useCallback, useEffect, useState } from "react"
import { disablePush, enablePush, pushState, type PushState } from "../push.js"

/**
 * 「跑完了叫我一声」的开关。
 *
 * 摆在会话列表的底部而不是某个设置页里：**它只需要点一次**，
 * 而点它的那一刻正是你第一次意识到「我得走开一会儿」的那一刻。
 *
 * 权限请求必须在这颗按钮的 click 里发出——页面加载时自动问会被浏览器直接拒，
 * 而且**没有第二次机会**（见 `push.ts` 的文件头）。
 */
export function PushToggle({ token }: { token: string }): React.JSX.Element | null {
  const [state, setState] = useState<PushState>({ kind: "working" })
  const [error, setError] = useState("")

  useEffect(() => {
    void pushState().then(setState)
  }, [])

  const turnOn = useCallback(() => {
    setState({ kind: "working" })
    setError("")
    void enablePush(token)
      .then((result) => {
        if (result.ok) setState({ kind: "on" })
        else {
          setError(result.reason)
          void pushState().then(setState)
        }
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "开不起来")
        setState({ kind: "off" })
      })
  }, [token])

  const turnOff = useCallback(() => {
    setState({ kind: "working" })
    void disablePush(token).finally(() => {
      setState({ kind: "off" })
    })
  }, [token])

  if (state.kind === "unsupported") {
    return <p className="push push--why">{state.why}</p>
  }
  if (state.kind === "denied") {
    return <p className="push push--why">通知权限被拒过了，浏览器不会再问——要开得去系统设置里改。</p>
  }
  return (
    <div className="push">
      <button
        className="btn btn--ghost"
        type="button"
        disabled={state.kind === "working"}
        onClick={state.kind === "on" ? turnOff : turnOn}
      >
        {state.kind === "on" ? "关掉通知" : state.kind === "working" ? "…" : "跑完了叫我一声"}
      </button>
      {error === "" ? null : <span className="push__error">{error}</span>}
    </div>
  )
}
