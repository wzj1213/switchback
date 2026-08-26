import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Item } from "@omni/protocol"
import { Copyable } from "./Copyable.js"

describe("消息复制反馈", () => {
  it("初始按钮等待系统回执并可宣告结果", () => {
    const item: Item = {
      id: "msg", turnId: "turn", kind: "agent_message", at: 1, text: "检查完成", complete: true,
    }
    const html = renderToStaticMarkup(createElement(Copyable, {
      item,
      onCopy: () => Promise.resolve(true),
      children: createElement("p", null, item.text),
    }))
    expect(html).toContain('data-state="idle"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('title="复制这条内容"')
    expect(html).toContain(">复制</button>")
  })
})
