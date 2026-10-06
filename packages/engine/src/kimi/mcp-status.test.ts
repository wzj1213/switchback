import type { Event } from "@switchback/protocol"
import { describe, expect, it } from "vitest"
import type { KimiApi } from "./http.js"
import { KimiMcpStatus, loadKimiMcpSnapshot } from "./mcp-status.js"

function tracker(): { mcp: KimiMcpStatus; events: Event[] } {
  const events: Event[] = []
  return { mcp: new KimiMcpStatus({ threadId: "thread-1", emit: (event) => events.push(event) }), events }
}

describe("Kimi MCP 状态", () => {
  it("pending 与 connected 保持安静，失败保留原文且同状态去重", () => {
    const out = tracker()
    out.mcp.handle({ type: "mcp.server.status", server: { name: "docs", status: "pending" } }, 1)
    out.mcp.handle({ type: "mcp.server.status", server: { name: "docs", status: "failed", error: "ENOENT" } }, 2)
    out.mcp.handle({ type: "mcp.server.status", server: { name: "docs", status: "failed", error: "ENOENT" } }, 3)
    expect(out.events).toEqual([{
      type: "engine.status", at: 2, threadId: "thread-1", status: "degraded",
      detail: "MCP server \"docs\" failed: ENOENT",
    }])
    out.mcp.handle({ type: "mcp.server.status", server: { name: "docs", status: "connected" } }, 4)
    out.mcp.handle({ type: "mcp.server.status", server: { name: "docs", status: "failed", error: "ENOENT" } }, 5)
    expect(out.events).toHaveLength(2)
  })

  it("needs-auth 沿用原生修复命令", () => {
    const out = tracker()
    out.mcp.handle({ type: "mcp.server.status", server: { name: "vault", status: "needs-auth" } }, 7)
    expect(out.events[0]).toMatchObject({
      status: "degraded",
      detail: "MCP server \"vault\" needs OAuth — run /mcp-config login vault",
    })
  })

  it("REST 初始快照先静默播种，ready 后一次汇总真实故障", () => {
    const events: Event[] = []
    const mcp = new KimiMcpStatus({ threadId: "thread-1", emit: (event) => events.push(event) })
    mcp.seed({ servers: [{
      id: "broken", name: "broken", transport: "stdio", status: "error",
      tool_count: 0, last_error: "spawn failed",
    }] })
    expect(events).toEqual([])
    mcp.reportHealth(9)
    expect(events[0]).toMatchObject({ status: "degraded", detail: "MCP server \"broken\" failed: spawn failed" })
  })

  it("REST 快照只有在公开会话清单证明目标正是最新创建会话时才采用", async () => {
    const paths: string[] = []
    const api: KimiApi = {
      get: <T>(path: string) => {
        paths.push(path)
        if (path === "mcp/servers") return Promise.resolve({ servers: [] } as T)
        return Promise.resolve({ items: [
          { id: "older", created_at: "2026-08-25T00:00:00Z" },
          { id: "target", created_at: "2026-08-25T00:00:01Z" },
        ], has_more: false } as T)
      },
      post: <T>() => Promise.resolve({} as T),
    }
    await expect(loadKimiMcpSnapshot(api, "target")).resolves.toEqual({ servers: [] })
    await expect(loadKimiMcpSnapshot(api, "older")).resolves.toBeUndefined()
    expect(paths).toEqual([
      "sessions?page_size=100&include_archive=false", "mcp/servers",
      "sessions?page_size=100&include_archive=false", "sessions?page_size=100&include_archive=false",
    ])
  })

  it("快照前后会话选择翻面时丢弃结果，不把瞬时选中的别人状态串过来", async () => {
    let reads = 0
    const api: KimiApi = {
      get: <T>(path: string) => {
        if (path === "mcp/servers") return Promise.resolve({ servers: [] } as T)
        reads += 1
        return Promise.resolve({
          items: [{ id: reads === 1 ? "target" : "other", created_at: "2026-08-25T00:00:00Z" }],
          has_more: false,
        } as T)
      },
      post: <T>() => Promise.resolve({} as T),
    }
    await expect(loadKimiMcpSnapshot(api, "target")).resolves.toBeUndefined()
  })

  it("会话校验遍历全部公开分页，不会在前 100 条里猜最新创建时间", async () => {
    const api: KimiApi = {
      get: <T>(path: string) => {
        if (path === "mcp/servers") return Promise.resolve({ servers: [] } as T)
        if (!path.includes("before_id")) {
          return Promise.resolve({
            items: [{ id: "updated-lately", created_at: "2026-08-24T00:00:00Z" }], has_more: true,
          } as T)
        }
        return Promise.resolve({
          items: [{ id: "created-later", created_at: "2026-08-25T00:00:00Z" }], has_more: false,
        } as T)
      },
      post: <T>() => Promise.resolve({} as T),
    }
    await expect(loadKimiMcpSnapshot(api, "updated-lately")).resolves.toBeUndefined()
    await expect(loadKimiMcpSnapshot(api, "created-later")).resolves.toEqual({ servers: [] })
  })
})
