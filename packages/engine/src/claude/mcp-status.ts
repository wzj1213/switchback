import type { Event, ThreadId } from "@omni/protocol"

interface RawMcpStatus {
  name?: unknown
  status?: unknown
  error?: unknown
}

interface McpOut {
  threadId: ThreadId
  emit: (event: Event) => void
}

interface McpHandle {
  mcpServerStatus: () => Promise<unknown>
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined

function failure(server: RawMcpStatus): string | undefined {
  const name = text(server.name)
  if (name === undefined) return undefined
  if (server.status === "needs-auth") return `MCP 服务器「${name}」需要授权；请在 Claude 中完成登录后重试`
  if (server.status !== "failed") return undefined
  const detail = text(server.error)
  return `MCP 服务器「${name}」没起来，它提供的工具当前不可用${detail === undefined ? "" : `：${detail}`}`
}

/** 初始化快照与控制请求共用去重状态，只在失败翻面时报告能力降级。 */
export class ClaudeMcpStatus {
  private readonly seen = new Map<string, string>()

  constructor(private readonly out: McpOut) {}

  report(raw: unknown, at: number): void {
    if (!Array.isArray(raw)) return
    for (const value of raw) {
      if (typeof value !== "object" || value === null) continue
      const server = value as RawMcpStatus
      const name = text(server.name)
      const status = text(server.status)
      if (name === undefined || status === undefined) continue
      const key = `${status}:${text(server.error) ?? ""}`
      if (this.seen.get(name) === key) continue
      this.seen.set(name, key)
      const detail = failure(server)
      if (detail !== undefined) {
        this.out.emit({ type: "engine.status", at, threadId: this.out.threadId, status: "degraded", detail })
      }
    }
  }
}

export async function reportCurrentMcp(
  handle: McpHandle | undefined,
  status: ClaudeMcpStatus,
  at: number,
): Promise<void> {
  const rows = await handle?.mcpServerStatus().catch(() => undefined)
  if (rows !== undefined) status.report(rows, at)
}
