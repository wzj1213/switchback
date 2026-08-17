import type { ConnState } from "../transport.js"

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
  if (conn.kind === "open") return null

  if (conn.kind === "connecting") {
    return (
      <div className="connbar" data-kind="connecting" role="status">
        正在连接…
      </div>
    )
  }

  if (conn.kind === "retrying") {
    return (
      <div className="connbar" data-kind="retrying" role="status">
        <span>
          {conn.reason} · {String(Math.round(conn.inMs / 1000))} 秒后重试
        </span>
        <button className="btn btn--ghost" type="button" onClick={onRetry}>
          立刻重试
        </button>
      </div>
    )
  }

  return (
    <div className="connbar" data-kind="closed" role="status">
      连接已关闭
    </div>
  )
}
