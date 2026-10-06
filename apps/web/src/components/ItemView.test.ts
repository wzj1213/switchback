import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { UserMessageItem } from "@switchback/protocol"
import { ItemView } from "./ItemView.js"

describe("移动端消息来源", () => {
  it("原生定时触发使用独立形态并保留原任务", () => {
    const item: UserMessageItem = {
      id: "u1",
      turnId: "t1",
      at: 0,
      kind: "user_message",
      text: "检查部署",
      origin: {
        kind: "scheduled",
        taskId: "job-1",
        schedule: "7 * * * *",
        recurring: true,
        coalescedCount: 1,
        stale: false,
      },
    }
    const html = renderToStaticMarkup(
      createElement(ItemView, {
        item,
        send: () => true,
        offline: false,
      }),
    )

    expect(html).toContain("item--native")
    expect(html).not.toContain("item--user")
    expect(html).toContain("定时触发")
    expect(html).toContain("检查部署")
  })

  it("原生终端命令使用独立来源形态", () => {
    const item: UserMessageItem = {
      id: "shell",
      turnId: "t2",
      at: 0,
      kind: "user_message",
      text: "$ printf ok",
      origin: { kind: "shell" },
    }
    const html = renderToStaticMarkup(
      createElement(ItemView, { item, send: () => true, offline: false }),
    )

    expect(html).toContain("item--native")
    expect(html).not.toContain("item--user")
    expect(html).toContain("终端命令")
  })

  it("长期目标自动续轮只显示原生边界", () => {
    const item: UserMessageItem = {
      id: "goal",
      turnId: "t3",
      at: 0,
      kind: "user_message",
      text: "",
      origin: { kind: "goal_continuation" },
    }
    const html = renderToStaticMarkup(
      createElement(ItemView, { item, send: () => true, offline: false }),
    )

    expect(html).toContain("item--native")
    expect(html).toContain("长期目标续跑")
    expect(html).not.toContain("native__text")
  })
})
