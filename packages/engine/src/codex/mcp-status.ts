import type { Event, ThreadId } from "@switchback/protocol"
import type { WireMcpStatus } from "./wire.js"
import { localeOf } from "../locale.js"
import type { Locale } from "@switchback/i18n"
import { CODEX_MCP } from "./mcp-status.messages.js"

interface McpStatusContext {
  threadId: ThreadId
  mcpSeen: Map<string, string>
  emit: (event: Event) => void
  now: () => number
  /** 适配器自己写的话用哪种语言（`StartRequest.locale`）。缺省中文。 */
  locale?: () => Locale
}

/** `cancelled` 是可被后续启动顶替的中间态；未知状态仍按失败暴露。 */
const MCP_FINE: ReadonlySet<string> = new Set(["starting", "ready", "cancelled"])

/** 起没起来；是的话给一句能读的原因，没失败给 undefined。 */
function mcpFailure(params: WireMcpStatus, m: (typeof CODEX_MCP)[Locale]): string | undefined {
  const status = params.status ?? ""
  // `cancelled` 常常带着 `failureReason`，所以状态判断要在原因之前
  if (MCP_FINE.has(status)) return undefined
  if (params.failureReason === "reauthenticationRequired") {
    return m.reauth
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
  const m = CODEX_MCP[localeOf(ctx)]
  const why = mcpFailure(params, m)
  const key = `${params.status ?? ""}:${why === undefined ? "ok" : "bad"}`
  if (ctx.mcpSeen.get(name) === key) return
  ctx.mcpSeen.set(name, key)
  if (why === undefined) return
  ctx.emit({
    type: "engine.status",
    at: ctx.now(),
    threadId: ctx.threadId,
    status: "degraded",
    detail: m.failed(name, why),
  })
}
