import type { Event, ThreadId } from "@omni/protocol"
import type { WireMcpStatus } from "./wire.js"

interface McpStatusContext {
  threadId: ThreadId
  mcpSeen: Map<string, string>
  emit: (event: Event) => void
  now: () => number
}

/** `cancelled` 是可被后续启动顶替的中间态；未知状态仍按失败暴露。 */
const MCP_FINE: ReadonlySet<string> = new Set(["starting", "ready", "cancelled"])

/** 起没起来；是的话给一句能读的原因，没失败给 undefined。 */
function mcpFailure(params: WireMcpStatus): string | undefined {
  const status = params.status ?? ""
  // `cancelled` 常常带着 `failureReason`，所以状态判断要在原因之前
  if (MCP_FINE.has(status)) return undefined
  if (params.failureReason === "reauthenticationRequired") {
    return "授权已失效，需要重新连接这台 MCP 服务器"
  }
  const detail = params.failureReason ?? params.error
  if (detail !== undefined && detail !== null) {
    return typeof detail === "string" ? detail : JSON.stringify(detail)
  }
  return status
}

/** MCP 失败是能力降级而非引擎崩溃；只在状态翻面时提示。 */
export function onMcpStatus(ctx: McpStatusContext, raw: unknown): void {
  const params = (raw ?? {}) as WireMcpStatus
  const name = params.name ?? ""
  if (name === "") return
  const why = mcpFailure(params)
  const key = `${params.status ?? ""}:${why === undefined ? "ok" : "bad"}`
  if (ctx.mcpSeen.get(name) === key) return
  ctx.mcpSeen.set(name, key)
  if (why === undefined) return
  ctx.emit({
    type: "engine.status",
    at: ctx.now(),
    threadId: ctx.threadId,
    status: "degraded",
    detail: `MCP 服务器「${name}」没起来，它提供的工具这一会话都用不了：${why}`,
  })
}
