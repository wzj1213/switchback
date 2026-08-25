import { describe, expect, it } from "vitest"
import { alignKimiDelta } from "./text-stream.js"

describe("Kimi 流式 offset", () => {
  it("按公开规则去重、裁重叠后缀并报告缺口", () => {
    const cases = [
      {
        name: "旧服务无 offset",
        local: "前",
        offset: undefined,
        chunk: "后",
        want: { append: "后" },
      },
      { name: "恰好续写", local: "前", offset: 1, chunk: "后", want: { append: "后" } },
      { name: "完整重复", local: "前后", offset: 0, chunk: "前后", want: {} },
      { name: "局部重叠", local: "前后", offset: 1, chunk: "后来", want: { append: "来" } },
      {
        name: "向前缺帧",
        local: "前",
        offset: 2,
        chunk: "后",
        want: { gap: { expected: 1, got: 2 } },
      },
      {
        name: "内容分叉",
        local: "前后",
        offset: 1,
        chunk: "错",
        want: { gap: { expected: 2, got: 1 } },
      },
    ] as const

    for (const row of cases) {
      expect(alignKimiDelta(row.local, row.offset, row.chunk), row.name).toEqual(row.want)
    }
  })
})
