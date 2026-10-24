import { useCallback, useEffect, useState } from "react"
import { disablePush, enablePush, pushState, type PushFailure, type PushState } from "../push.js"
import type { Locale } from "@switchback/i18n"
import { useMessages } from "../i18n.js"
import { PUSH_TOGGLE } from "./PushToggle.messages.js"

function failureText(failure: PushFailure, m: (typeof PUSH_TOGGLE)[Locale]): string {
  if (failure.kind === "unsupported") return m.why[failure.why]
  if (failure.kind === "refused") return m.refused
  if (failure.kind === "no-key") return m.noKey
  if (failure.kind === "bad-subscription") return m.badSubscription
  return m.notSaved(failure.status)
}

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
  const m = useMessages(PUSH_TOGGLE)

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
          setError(failureText(result.failure, m))
          void pushState().then(setState)
        }
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : m.failed)
        setState({ kind: "off" })
      })
  }, [token, m])

  const turnOff = useCallback(() => {
    setState({ kind: "working" })
    void disablePush(token).finally(() => {
      setState({ kind: "off" })
    })
  }, [token])

  if (state.kind === "unsupported") {
    return <p className="push push--why">{m.why[state.why]}</p>
  }
  if (state.kind === "denied") {
    return <p className="push push--why">{m.denied}</p>
  }
  return (
    <div className="push">
      <button
        className="btn btn--ghost"
        type="button"
        disabled={state.kind === "working"}
        onClick={state.kind === "on" ? turnOff : turnOn}
      >
        {state.kind === "on" ? m.off : state.kind === "working" ? "…" : m.on}
      </button>
      {error === "" ? null : <span className="push__error">{error}</span>}
    </div>
  )
}
