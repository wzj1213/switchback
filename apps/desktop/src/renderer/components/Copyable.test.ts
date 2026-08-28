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
      acts: true,
      onCopy: () => Promise.resolve(true),
      children: createElement("p", null, item.text),
    }))
    expect(html).toContain('data-state="idle"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('data-tip="复制"')
    // 纯图标按钮没有文字，报给读屏的那句就是它的名字
    expect(html).toContain('aria-label="复制"')
  })

  it("不是最后那条就连动作栏都不画——它占的那行高度正是间距失真的来源", () => {
    const item: Item = {
      id: "msg", turnId: "turn", kind: "agent_message", at: 1, text: "检查完成", complete: true,
    }
    const html = renderToStaticMarkup(createElement(Copyable, {
      item,
      acts: false,
      onCopy: () => Promise.resolve(true),
      children: createElement("p", null, item.text),
    }))
    expect(html).not.toContain("msgacts")
    expect(html).not.toContain('class="msgact"')
    // 外壳还在：用户消息靠右、行间距都挂在 `.copyable` 上
    expect(html).toContain('class="copyable"')
  })

  it("「改一改再发」独自在场时仍给动作栏，但那一栏里没有复制", () => {
    const item: Item = {
      id: "ask", turnId: "turn", kind: "user_message", at: 1, text: "改",
    }
    const html = renderToStaticMarkup(createElement(Copyable, {
      item,
      acts: false,
      onCopy: () => Promise.resolve(true),
      children: createElement("p", null, item.text),
      extra: createElement("button", { type: "button" }, "改一改再发"),
    }))
    expect(html).toContain("msgacts")
    expect(html).toContain("改一改再发")
    expect(html).not.toContain('class="msgact"')
  })
})
