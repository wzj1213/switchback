import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Lane } from "@omni/protocol"
import { LaneCard } from "./LaneCard.js"

const lane = (patch: Partial<Lane>): Lane => ({
  id: "ln", threadId: "th", kind: "aside", title: "还要多久？", status: "running", at: 1, ...patch,
})

describe("浏览器旁路卡", () => {
  const cases: readonly [string, Lane, boolean, readonly string[]][] = [
    ["侧问等待", lane({}), true, ["回答中", "还要多久？"]],
    ["侧问失败", lane({ status: "failed", summary: "请求超时" }), true, ["失败", "请求超时"]],
    ["断线不冒充仍在跑", lane({}), false, ["状态待确认"]],
    ["后台树", lane({ kind: "activity", title: "检查三处", progress: { nodes: [
      { id: "n", label: "跑测试", state: "done", detail: "2077 例" },
    ] } }), true, ["检查三处", "跑测试", "2077 例"]],
    ["后台暂停", lane({ kind: "activity", title: "等待审批", status: "paused" }), true, ["等待审批", "已暂停"]],
  ]

  for (const [name, value, live, wanted] of cases) {
    it(name, () => {
      const html = renderToStaticMarkup(createElement(LaneCard, { lane: value, live }))
      for (const text of wanted) expect(html).toContain(text)
    })
  }
})
