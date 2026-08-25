import type { Event, ThreadId } from "@omni/protocol"
import type { KimiApi } from "./http.js"
import type { KimiPayload } from "./wire.js"

interface McpOut {
  threadId: ThreadId
  emit: (event: Event) => void
}

interface NativeMcpServer {
  name: string
  status: "pending" | "connected" | "failed" | "needs-auth" | "disconnected" | "removed"
  error?: string
}

interface RestMcpServer {
  id: string
  name: string
  transport: "stdio" | "http" | "sse"
  status: "connected" | "connecting" | "disconnected" | "error"
  tool_count: number
  last_error?: string
}

export interface KimiMcpSnapshot {
  servers: readonly RestMcpServer[]
}

interface SessionPage {
  items: readonly { id: string; created_at?: string | number }[]
  has_more: boolean
}

function record(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
}

function text(raw: unknown): string | undefined {
  return typeof raw === "string" && raw !== "" ? raw : undefined
}

function statusOf(raw: unknown): NativeMcpServer["status"] | undefined {
  if (raw === "pending" || raw === "connecting") return "pending"
  if (raw === "connected") return "connected"
  if (raw === "failed" || raw === "error") return "failed"
  if (raw === "needs-auth") return "needs-auth"
  if (raw === "disabled" || raw === "disconnected") return "disconnected"
  if (raw === "removed") return "removed"
  return undefined
}

function serverOf(raw: unknown): NativeMcpServer | undefined {
  const outer = record(raw)
  const server = record(outer?.["server"]) ?? outer
  const name = text(server?.["name"])
  const status = statusOf(server?.["status"])
  if (name === undefined || status === undefined) return undefined
  const error = text(server?.["error"] ?? server?.["last_error"])
  return { name, status, ...(error === undefined ? {} : { error }) }
}

function failure(server: NativeMcpServer): string | undefined {
  if (server.status === "needs-auth") {
    return `MCP server "${server.name}" needs OAuth — run /mcp-config login ${server.name}`
  }
  if (server.status !== "failed") return undefined
  return `MCP server "${server.name}" failed${server.error === undefined ? "" : `: ${server.error}`}`
}

function createdAt(raw: string | number | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = new Date(raw).getTime()
  return Number.isFinite(value) ? value : undefined
}

function takeNewest(page: SessionPage, current: { id: string; at: number } | undefined): { id: string; at: number } | undefined {
  let newest = current
  for (const row of page.items) {
    const at = createdAt(row.created_at)
    if (at !== undefined && (newest === undefined || at > newest.at)) newest = { id: row.id, at }
  }
  return newest
}

async function newestSession(api: KimiApi): Promise<string | undefined> {
  let newest: { id: string; at: number } | undefined
  let before: string | undefined
  const seen = new Set<string>()
  while (true) {
    const cursor = before === undefined ? "" : `&before_id=${encodeURIComponent(before)}`
    const page = await api.get<SessionPage>(`sessions?page_size=100&include_archive=false${cursor}`)
    newest = takeNewest(page, newest)
    if (!page.has_more) return newest?.id
    const next = page.items.at(-1)?.id
    if (next === undefined || seen.has(next)) throw new Error("Kimi MCP 会话校验的分页游标没有前进")
    seen.add(next)
    before = next
  }
}

/** `/mcp/servers` 没有 session 参数；快照前后都确认它会选中目标，防止并发归档串会话。 */
export async function loadKimiMcpSnapshot(api: KimiApi, sessionId: string): Promise<KimiMcpSnapshot | undefined> {
  if (await newestSession(api) !== sessionId) return undefined
  const snapshot = await api.get<KimiMcpSnapshot>("mcp/servers")
  return await newestSession(api) === sessionId ? snapshot : undefined
}

export class KimiMcpStatus {
  private readonly servers = new Map<string, NativeMcpServer>()
  private readonly seen = new Map<string, string>()

  constructor(private readonly out: McpOut) {}

  private take(server: NativeMcpServer, at: number, emit: boolean): void {
    this.servers.set(server.name, server)
    const why = failure(server)
    const key = `${server.status}:${server.error ?? ""}`
    if (this.seen.get(server.name) === key) return
    this.seen.set(server.name, key)
    if (emit && why !== undefined) {
      this.out.emit({
        type: "engine.status", at, threadId: this.out.threadId, status: "degraded", detail: why,
      })
    }
  }

  seed(snapshot: KimiMcpSnapshot | undefined): void {
    for (const raw of snapshot?.servers ?? []) {
      const server = serverOf(raw)
      if (server !== undefined) this.take(server, 0, false)
    }
  }

  reportHealth(at: number): void {
    const failures = [...this.servers.values()].map(failure).filter((why): why is string => why !== undefined)
    if (failures.length > 0) {
      this.out.emit({
        type: "engine.status", at, threadId: this.out.threadId, status: "degraded", detail: failures.join("；"),
      })
    }
  }

  handle(payload: KimiPayload, at: number): boolean {
    if (payload.type !== "mcp.server.status") return false
    const server = serverOf(payload)
    if (server !== undefined) this.take(server, at, true)
    return true
  }
}
