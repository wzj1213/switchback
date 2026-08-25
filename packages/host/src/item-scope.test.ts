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

  it("同一调用的 started、updated、delta、撤回与审批引用仍指向同一个宿主 id", () => {
    const scope = createItemScope(() => "it-1")
    const begin = scope.event(started("turn-a"))
    const update = scope.event({ ...started("turn-a"), type: "item.updated" })
    const delta = scope.event({ type: "item.delta", at: 1, itemId: "c1", append: "x" })
    const removed = scope.event({ type: "item.removed", at: 2, turnId: "turn-a", itemId: "c1" })
    const ask = scope.ask(
      { toolCallId: "c1", tool: "Edit", summary: "改文件", reason: "测试" },
      "turn-a",
    )
    expect([
      begin.type === "item.started" ? begin.item.id : "",
      update.type === "item.updated" ? update.item.id : "",
      delta.type === "item.delta" ? delta.itemId : "",
      removed.type === "item.removed" ? removed.itemId : "",
      ask.toolCallId,
    ]).toEqual(["it-1", "it-1", "it-1", "it-1", "it-1"])
  })
})

describe("旁路的身份", () => {
  const scope = () => {
    let n = 0
    return createItemScope((prefix) => `${prefix}-${String((n += 1))}`)
  }
  const msg = (id: string, laneId?: string): Event => ({
    type: "item.started", at: 0,
    item: { id, turnId: "tu-1", at: 0, kind: "agent_message", text: "", complete: false,
      ...(laneId === undefined ? {} : { lane: { id: laneId } }) },
  })

  it("**lane id 也要重铸**——两家引擎都报 `t1` 时，后一条会盖掉前一条", () => {
    const s = scope()
    const a = s.event({ type: "lane.updated", at: 0, threadId: "th-1",
      lane: { id: "t1", threadId: "th-1", kind: "activity", title: "x", status: "running", at: 0 } })
    expect(a.type === "lane.updated" ? a.lane.id : "").toBe("ln-1")
  })

  it("同一条 lane 的后续更新拿到同一个 id——**不按轮次分**：workflow 是跨轮的", () => {
    const s = scope()
    const one = s.event({ type: "lane.updated", at: 0, threadId: "th-1",
      lane: { id: "t1", threadId: "th-1", kind: "activity", title: "x", status: "running", at: 0 } })
    const two = s.event({ type: "lane.updated", at: 1, threadId: "th-1",
      lane: { id: "t1", threadId: "th-1", kind: "activity", title: "x", status: "done", at: 1 } })
    const idOf = (e: Event) => (e.type === "lane.updated" ? e.lane.id : "")
    expect(idOf(two)).toBe(idOf(one))
  })

  it("item 上的 lane 归属跟着重铸，否则分流选择器按新 id 找不到旧 item", () => {
    const s = scope()
    const lane = s.event({ type: "lane.updated", at: 0, threadId: "th-1",
      lane: { id: "t1", threadId: "th-1", kind: "activity", title: "x", status: "running", at: 0 } })
    const it1 = s.event(msg("c1", "t1"))
    const laneId = lane.type === "lane.updated" ? lane.lane.id : ""
    expect(it1.type === "item.started" ? it1.item.lane?.id : "").toBe(laneId)
  })

  it("lane 的主线工具锚点也跟着 item identity 重铸", () => {
    const s = scope()
    const origin = s.event(msg("task-native"))
    const child = s.event({
      type: "item.started", at: 1,
      item: { id: "child", turnId: "tu-1", at: 1, kind: "agent_message", text: "x", complete: true,
        lane: { id: "task-id", originItemId: "task-native" } },
    })
    const originId = origin.type === "item.started" ? origin.item.id : ""
    expect(child.type === "item.started" ? child.item.lane?.originItemId : "").toBe(originId)
  })

  it("**审批与错误永远留在主线**——侧栏关着时一张等你点的审批卡不能消失", () => {
    const s = scope()
    const ask = s.event({ type: "item.started", at: 0,
      item: { id: "c1", turnId: "tu-1", at: 0, kind: "approval", toolCallId: "c1", tool: "Bash",
        summary: "git push", reason: "推送不可逆", status: "pending", lane: { id: "t1" } } })
    const bad = s.event({ type: "item.started", at: 0,
      item: { id: "c2", turnId: "tu-1", at: 0, kind: "error", message: "炸了", fatal: true, lane: { id: "t1" } } })
    expect(ask.type === "item.started" ? ask.item.lane : "有").toBeUndefined()
    expect(bad.type === "item.started" ? bad.item.lane : "有").toBeUndefined()
  })
})
