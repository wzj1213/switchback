import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Lane } from "@omni/protocol"
import { AsideLaneCard } from "./aside-card.js"

const lane = (status: Lane["status"], summary?: string): Lane => ({
  id: "aside-1",
  threadId: "th-1",
  kind: "aside",
  title: "这个函数做什么？",
  status,
  at: 1,
  ...(summary === undefined ? {} : { summary }),
})

describe("侧问旁路卡", () => {
  const cases: readonly [Lane["status"], string | undefined, boolean, readonly string[]][] = [
    ["running", undefined, true, ["回答中", "这个函数做什么？"]],
    ["running", undefined, false, ["状态待确认", "这个函数做什么？"]],
    ["paused", "等待恢复", true, ["已暂停", "等待恢复"]],
    ["done", "读取配置", true, ["已回答", "读取配置"]],
    ["failed", "侧问接口超时", true, ["失败", "侧问接口超时"]],
  ]

  for (const [status, summary, live, text] of cases) {
    it(`${status} 只呈现这一阶段真实拥有的内容`, () => {
      const html = renderToStaticMarkup(createElement(AsideLaneCard, { lane: lane(status, summary), live }))
      for (const part of text) expect(html).toContain(part)
      expect(html).toContain("不进正文")
      if (status === "running") expect(html).not.toContain("asidecard__a")
      expect(html.includes("plan-mark--spin")).toBe(status === "running" && live)
    })
  }
})
