import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createItemScope } from "./item-scope.js"

const started = (turnId: string, id = "c1"): Extract<Event, { type: "item.started" }> => ({
  type: "item.started",
  at: 0,
  item: {
    id,
    turnId,
    at: 0,
    kind: "tool_call",
    tool: "edit",
    status: "running",
    detail: { kind: "file_edit", path: "/w/a.ts", files: [], added: 0, removed: 0 },
  },
})

describe("引擎 item id 进入宿主后重新定域", () => {
  it("同一原生 id 在不同引擎会话、不同轮次都不会碰撞", () => {
    const counter = { value: 0 }
    const mint = (): string => `it-${String(++counter.value)}`
    const first = createItemScope(mint).event(started("turn-a"))
    const second = createItemScope(mint).event(started("turn-b"))
    const firstId = first.type === "item.started" ? first.item.id : ""
    const secondId = second.type === "item.started" ? second.item.id : ""
    expect([firstId, secondId]).toEqual(["it-1", "it-2"])
  })

  it("同一调用的 started、updated、delta 与审批引用仍指向同一个宿主 id", () => {
    const scope = createItemScope(() => "it-1")
    const begin = scope.event(started("turn-a"))
    const update = scope.event({ ...started("turn-a"), type: "item.updated" })
    const delta = scope.event({ type: "item.delta", at: 1, itemId: "c1", append: "x" })
    const ask = scope.ask(
      { toolCallId: "c1", tool: "Edit", summary: "改文件", reason: "测试" },
      "turn-a",
    )
    expect([
      begin.type === "item.started" ? begin.item.id : "",
      update.type === "item.updated" ? update.item.id : "",
      delta.type === "item.delta" ? delta.itemId : "",
      ask.toolCallId,
    ]).toEqual(["it-1", "it-1", "it-1", "it-1"])
  })
})
