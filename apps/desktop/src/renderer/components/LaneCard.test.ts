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

  it("后台命令原文画进卡里，输出按等宽画而不是正文段落", () => {
    const command = "export JAVA_HOME=/opt/jdk\ncd order-service && mvn -o -B test"
    const html = renderToStaticMarkup(createElement(LaneCard, {
      lane: { ...lane, status: "done", command, summary: "[INFO] BUILD SUCCESS" },
      live: false,
    }))
    // 多行命令在卡上收成一行，原文仍挂在 title 上
    expect(html).toContain("export JAVA_HOME=/opt/jdk cd order-service &amp;&amp; mvn -o -B test")
    expect(html).toContain("lane-output")
    expect(html).not.toContain("lane__summary")
  })

  it("没有命令的旁路照旧按正文画总结", () => {
    const html = renderToStaticMarkup(createElement(LaneCard, {
      lane: { ...lane, status: "done", summary: "目录为空" }, live: false,
    }))
    expect(html).toContain("lane__summary")
    expect(html).not.toContain("lane-output")
  })

  it("暂停态明确停住，不继续转圈", () => {
    const html = renderToStaticMarkup(createElement(LaneCard, { lane: { ...lane, status: "paused" }, live: true }))
    expect(html).toContain("已暂停")
    expect(html).not.toContain("plan-mark--spin")
  })
})
