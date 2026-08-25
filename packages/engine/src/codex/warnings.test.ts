import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { emitCodexWarning } from "./warnings.js"

function setup(active = true) {
  const events: Event[] = []
  const materialized = new Set<string>()
  const ctx = {
    threadId: "thread-1",
    turnId: () => active ? "turn-1" : undefined,
    materialized,
    emit: (event: Event) => events.push(event),
    now: () => 100,
  }
  return { ctx, events, materialized }
}

describe("Codex 原生警告", () => {
  it("运行警告留在当前轮，哪怕同一毫秒也不会互相覆盖", () => {
    const { ctx, events, materialized } = setup()
    emitCodexWarning(ctx, { message: "第一条" })
    emitCodexWarning(ctx, { message: "第二条" })
    expect(events).toMatchObject([
      { type: "item.started", item: { kind: "notice", message: "第一条", level: "warning" } },
      { type: "item.started", item: { kind: "notice", message: "第二条", level: "warning" } },
    ])
    expect(materialized.size).toBe(2)
  })

  it("开场配置警告走会话横幅，并保留原始详情与精确位置", () => {
    const { ctx, events } = setup(false)
    emitCodexWarning(ctx, {
      summary: "规则没有生效",
      details: "Parse error",
      path: "/work/.codex/rules/broken.rules",
      range: { start: { line: 2, column: 13 } },
    })
    expect(events).toMatchObject([{
      type: "engine.status",
      status: "degraded",
      detail: "规则没有生效\nParse error\n位置：/work/.codex/rules/broken.rules:2:13",
    }])
  })

  it("没有原文的畸形通知不替 Codex 编一句", () => {
    const { ctx, events } = setup()
    emitCodexWarning(ctx, { summary: "", details: "orphan detail" })
    expect(events).toEqual([])
  })
})
