import type { ConnState } from "@switchback/link"
import { useMessages } from "../i18n.js"
import { CONN_BAR } from "./ConnBar.messages.js"

/**
 * 连接状态条。
 *
 * **只在不正常时出现。** 连着的时候画一条「已连接」的绿条是纯噪声——
 * 它占着一行屏幕，却只说了「一切照旧」。
 *
 * 重连倒计时要说秒数：一个只写「正在重连…」的条，和一个卡死的界面
 * 在用户眼里是同一个东西。
 */
export function ConnBar({ conn, onRetry }: { conn: ConnState; onRetry: () => void }): React.JSX.Element | null {
  const m = useMessages(CONN_BAR)
  if (conn.kind === "open") return null

  if (conn.kind === "connecting") {
    return (
      <div className="connbar" data-kind="connecting" role="status">
        {m.connecting}
      </div>
    )
  }

  if (conn.kind === "retrying") {
    return (
      <div className="connbar" data-kind="retrying" role="status">
        <span>
          {conn.reason} · {m.retryIn(Math.round(conn.inMs / 1000))}
        </span>
        <button className="btn btn--ghost" type="button" onClick={onRetry}>
          {m.retryNow}
        </button>
      </div>
    )
  }

  return (
    <div className="connbar" data-kind="closed" role="status">
      {m.closed}
    </div>
  )
}
