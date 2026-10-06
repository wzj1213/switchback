import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { UserMessageItem } from "@switchback/protocol"
import { ItemView } from "./ItemView.js"

const scheduled: UserMessageItem = {
  id: "u1",
  turnId: "t1",
  at: 0,
  kind: "user_message",
  text: "检查部署",
  origin: {
    kind: "scheduled",
    taskId: "job-1",
    schedule: "7 * * * *",
    recurring: false,
    coalescedCount: 2,
    stale: true,
  },
}

describe("桌面消息来源", () => {
  it("原生定时触发留在左侧并显示计划语义，不冒充用户气泡", () => {
    const html = renderToStaticMarkup(
      createElement(ItemView, {
        item: scheduled,
        onResolve: () => undefined,
      }),
    )

    expect(html).toContain('class="msg--native"')
    expect(html).not.toContain('class="msg--user"')
    expect(html).toContain("定时触发")
    expect(html).toContain("7 * * * *")
    expect(html).toContain("合并 2 次")
    expect(html).toContain("最后一次")
  })

  it("原生终端命令留在左侧，不冒充聊天气泡", () => {
    const html = renderToStaticMarkup(
      createElement(ItemView, {
        item: { ...scheduled, id: "shell", text: "$ printf ok", origin: { kind: "shell" } },
        onResolve: () => undefined,
      }),
    )

    expect(html).toContain('class="msg--native"')
    expect(html).not.toContain('class="msg--user"')
    expect(html).toContain("终端命令")
    expect(html).toContain("$ printf ok")
  })

  it("长期目标自动续轮只显示原生边界，不伪造用户正文", () => {
    const html = renderToStaticMarkup(
      createElement(ItemView, {
        item: { ...scheduled, id: "goal", text: "", origin: { kind: "goal_continuation" } },
        onResolve: () => undefined,
      }),
    )

    expect(html).toContain('class="msg--native"')
    expect(html).toContain("长期目标续跑")
    expect(html).not.toContain("msg__native-text")
  })
})
