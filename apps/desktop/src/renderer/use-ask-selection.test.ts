import { describe, expect, it } from "vitest"
import { quoteOf } from "./use-ask-selection.js"

describe("quoteOf", () => {
  it("换行和连续空白压成一个空格——引文要能放进一行输入框", () => {
    expect(quoteOf("worktree-baseline.ts 的\n\n  rebase   分支")).toBe(
      "worktree-baseline.ts 的 rebase 分支",
    )
  })

  it("首尾空白去掉", () => {
    expect(quoteOf("   这一段   ")).toBe("这一段")
  })

  it("整段选中时截断——侧问要的是「哪一句」，不是「哪一屏」", () => {
    const quote = quoteOf("字".repeat(300))
    expect(quote).toHaveLength(121)
    expect(quote.endsWith("…")).toBe(true)
  })

  it("正好到上限不截断，也不多一个省略号", () => {
    expect(quoteOf("字".repeat(120))).toBe("字".repeat(120))
  })

  it("只选到空白时是空串——调用处据此不浮那颗按钮", () => {
    expect(quoteOf(" \n\t ")).toBe("")
  })
})
