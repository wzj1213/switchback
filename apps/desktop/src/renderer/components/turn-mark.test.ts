import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TurnMarkText } from "./turn-mark.js"

describe("分界线上那句话", () => {
  const html = (pace?: { firstMs: number; tps?: number; tokens: number; exact: boolean }): string =>
    renderToStaticMarkup(createElement(TurnMarkText, { ms: 131_000, pace }))

  it("有节奏就接在时长后面：已处理 · 首字 · tok/s", () => {
    const text = html({ firstMs: 800, tps: 34, tokens: 900, exact: true }).replace(/<[^>]+>/g, "")
    expect(text).toBe("已处理 2 分 11 秒 · 首字 0.8 秒 · 34 tok/s")
  })

  it("量不到就只说时长，不留一个空的分隔点", () => {
    expect(html().replace(/<[^>]+>/g, "")).toBe("已处理 2 分 11 秒")
  })
})
