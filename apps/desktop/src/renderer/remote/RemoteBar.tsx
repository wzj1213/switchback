import { useEffect, useState } from "react"
import { DESK_SLOT, forgetToken, type ConnState } from "@switchback/link"
import type { Connection } from "./connection.js"
import type { Locale } from "@switchback/i18n"
import { useDocumentLocale } from "../i18n.js"
import { REMOTE_BAR } from "./RemoteBar.messages.js"

/**
 * 远程窗口的连接条：**连着且没话说的时候什么都不画**。
 *
 * 只在三种时候出来：还没连上 / 断了在重连（几秒后、为什么、现在就试）、令牌不认了（重新配对）；
 * 另外宿主捎回来的话（命令被拒、被钳、补不上）在这里说一次，人看完可以关掉。
 *
 * 不进 `App` 里：那是本机窗口和远程窗口共用的一棵树，远程才有的状态挂在外面，
 * 本机那棵一行不用改。
 */
function stateText(state: ConnState, m: (typeof REMOTE_BAR)[Locale]): string | undefined {
  switch (state.kind) {
    case "connecting":
      return m.connecting
    case "retrying":
      return m.retrying(state.reason, Math.ceil(state.inMs / 1000))
    case "unauthorized":
      return m.unauthorized
    case "closed":
      return m.closed
    default:
      return undefined
  }
}

export function RemoteBar({ conn }: { conn: Connection }): React.JSX.Element | null {
  const [state, setState] = useState<ConnState>(conn.state)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const m = REMOTE_BAR[useDocumentLocale()]

  useEffect(() => {
    const offState = conn.onState(setState)
    const offNotice = conn.onNotice(setNotice)
    return () => {
      offState()
      offNotice()
    }
  }, [conn])

  const text = stateText(state, m)
  if (text === undefined && notice === undefined) return null
  return (
    <div className="remote-bar" role="status">
      {text === undefined ? null : <span className="remote-bar__state">{text}</span>}
      {state.kind === "unauthorized" ? (
        <button
          type="button"
          className="tbtn"
          onClick={() => {
            forgetToken(DESK_SLOT)
            window.location.reload()
          }}
        >
          {m.repair}
        </button>
      ) : null}
      {notice === undefined ? null : (
        <>
          <span className="remote-bar__notice">{notice}</span>
          <button type="button" className="tbtn" onClick={() => { setNotice(undefined) }}>{m.ok}</button>
        </>
      )}
    </div>
  )
}
