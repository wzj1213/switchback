import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Lane } from "@omni/protocol"
import { LaneCard } from "./LaneCard.js"

const lane: Lane = {
  id: "work", threadId: "th", kind: "activity", title: "后台检查", status: "running", at: 1,
  progress: { nodes: [{ id: "test", label: "跑测试", state: "running" }] },
}

describe("后台旁路卡的实时状态", () => {
  const cases: readonly [string, boolean, string, boolean][] = [
    ["仍连接", true, "跑着", true],
    ["历史记录", false, "状态待确认", false],
  ]

  for (const [name, live, label, spinning] of cases) {
    it(name, () => {
      const html = renderToStaticMarkup(createElement(LaneCard, { lane, live }))
      expect(html).toContain(label)
      expect(html.includes("plan-mark--spin")).toBe(spinning)
    })
  }

  it("暂停态明确停住，不继续转圈", () => {
    const html = renderToStaticMarkup(createElement(LaneCard, { lane: { ...lane, status: "paused" }, live: true }))
    expect(html).toContain("已暂停")
    expect(html).not.toContain("plan-mark--spin")
  })
})
