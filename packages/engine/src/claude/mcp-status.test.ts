import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { ClaudeMcpStatus } from "./mcp-status.js"

describe("Claude MCP 启动状态", () => {
  it("失败与待授权明确报告，同一状态不刷屏，恢复后再失败会再报", () => {
    const events: Event[] = []
    const status = new ClaudeMcpStatus({ threadId: "thread-1", emit: (event) => events.push(event) })
    status.report([{ name: "docs", status: "failed", error: "ENOENT" }], 1)
    status.report([{ name: "docs", status: "failed", error: "ENOENT" }], 2)
    status.report([{ name: "docs", status: "connected" }], 3)
    status.report([{ name: "docs", status: "failed", error: "ENOENT" }], 4)
    status.report([{ name: "vault", status: "needs-auth" }], 5)
    expect(events).toHaveLength(3)
    expect(events[0]).toMatchObject({ status: "degraded", detail: expect.stringContaining("ENOENT") })
    expect(events[2]).toMatchObject({ status: "degraded", detail: expect.stringContaining("需要授权") })
  })

  it("正常、未知和畸形状态不冒充故障", () => {
    const events: Event[] = []
    const status = new ClaudeMcpStatus({ threadId: "thread-1", emit: (event) => events.push(event) })
    status.report([{ name: "ok", status: "pending" }, { name: "new", status: "future" }, null], 1)
    expect(events).toEqual([])
  })
})
