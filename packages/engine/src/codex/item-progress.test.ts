import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { onFilePatch, onMcpProgress, retainProgress } from "./item-progress.js"
import type { WireItem } from "./wire.js"

function setup(item: WireItem) {
  const events: Event[] = []
  const ctx = {
    inflight: new Map([[item.id, item]]), materialized: new Set([item.id]),
    turnId: () => "turn", emit: (event: Event) => events.push(event), now: () => 4,
  }
  return { ctx, events }
}

describe("Codex 工具进度", () => {
  it("补丁快照在 completed 前更新真实文件明细", () => {
    const { ctx, events } = setup({ type: "fileChange", id: "patch", status: "inProgress", changes: [] })
    onFilePatch(ctx, { threadId: "th", turnId: "tn", itemId: "patch", changes: [
      { path: "/w/a.ts", kind: { type: "add" }, diff: "a\nb" },
    ] })
    expect(events[0]).toMatchObject({ item: { detail: { files: [{ path: "/w/a.ts", added: 2 }] } } })
  })

  it("MCP 进度原地更新且有界，完成快照缺结果时不把进度抹掉", () => {
    const { ctx, events } = setup({ type: "mcpToolCall", id: "mcp", server: "x", tool: "run" })
    for (let index = 0; index < 25; index += 1) {
      onMcpProgress(ctx, { threadId: "th", turnId: "tn", itemId: "mcp", message: `step-${String(index)}` })
    }
    const active = ctx.inflight.get("mcp")
    expect(active?.progress).toHaveLength(20)
    expect(events.at(-1)).toMatchObject({ item: { detail: { output: expect.stringContaining("step-24") } } })
    expect(retainProgress({ type: "mcpToolCall", id: "mcp", result: null }, active).progress).toHaveLength(20)
  })
})
