import { useEffect, useState } from "react"
import { DESK_SLOT, forgetToken, type ConnState } from "@switchback/link"
import type { Connection } from "./connection.js"

/**
 * 远程窗口的连接条：**连着且没话说的时候什么都不画**。
 *
 * 只在三种时候出来：还没连上 / 断了在重连（几秒后、为什么、现在就试）、令牌不认了（重新配对）；
 * 另外宿主捎回来的话（命令被拒、被钳、补不上）在这里说一次，人看完可以关掉。
 *
 * 不进 `App` 里：那是本机窗口和远程窗口共用的一棵树，远程才有的状态挂在外面，
 * 本机那棵一行不用改。
 */
function stateText(state: ConnState): string | undefined {
  switch (state.kind) {
    case "connecting":
      return "正在连那台机器…"
    case "retrying":
      return `断了（${state.reason}），${String(Math.ceil(state.inMs / 1000))} 秒后重连`
    case "unauthorized":
      return "这台电脑的授权不在了（被吊销，或者那台换了机器）"
    case "closed":
      return "连接已关闭"
    default:
      return undefined
  }
}

export function RemoteBar({ conn }: { conn: Connection }): React.JSX.Element | null {
  const [state, setState] = useState<ConnState>(conn.state)
  const [notice, setNotice] = useState<string | undefined>(undefined)

  useEffect(() => {
    const offState = conn.onState(setState)
    const offNotice = conn.onNotice(setNotice)
    return () => {
      offState()
      offNotice()
    }
  }, [conn])

  const text = stateText(state)
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
          重新配对
        </button>
      ) : null}
      {notice === undefined ? null : (
        <>
          <span className="remote-bar__notice">{notice}</span>
          <button type="button" className="tbtn" onClick={() => { setNotice(undefined) }}>知道了</button>
        </>
      )}
    </div>
  )
}
