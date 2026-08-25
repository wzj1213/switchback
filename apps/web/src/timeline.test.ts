import { describe, expect, it } from "vitest"
import type { Aside, Item, Lane } from "@omni/protocol"
import { timelineOf } from "./timeline.js"

const item = (id: string, at: number): Item => ({
  id, turnId: "tu", at, kind: "agent_message", text: id, complete: true,
})
const aside = (question: string, at: number): Aside => ({ at, question, answer: `答：${question}` })
const lane = (id: string, at: number): Lane => ({
  id, threadId: "th", kind: "aside", title: id, status: "running", at,
})

describe("浏览器端时间线", () => {
  it("侧问与旁路按出生位置插回正文，正文自己的顺序不被时间戳重排", () => {
    const rows = timelineOf(
      [item("晚报但在前", 30), item("早时间但在后", 10)],
      [aside("旧侧问", 20)],
      [lane("新旁路", 25)],
    )
    expect(rows.map((row) => row.kind === "item" ? row.item.id : row.kind === "aside" ? row.aside.question : row.lane.id))
      .toEqual(["旧侧问", "新旁路", "晚报但在前", "早时间但在后"])
  })

  it("lane 更新保持稳定 key，React 不会每帧重建整张卡", () => {
    const running = timelineOf([], [], [lane("a", 1)])[0]
    const done = timelineOf([], [], [{ ...lane("a", 99), status: "done" }])[0]
    expect(running?.key).toBe("lane-a")
    expect(done?.key).toBe("lane-a")
  })

  it("没有旁路时沿用正文，不凭空造内容", () => {
    expect(timelineOf([item("i", 1)], [], []).map((row) => row.key)).toEqual(["i"])
  })
})
