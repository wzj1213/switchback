import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { ReviewFile } from "../../shared/review.js"
import { ReviewFileHead } from "./review-file-head.js"

describe("审核文件工具栏", () => {
  it("复制按钮等待系统回执并可宣告结果", () => {
    const file: ReviewFile = {
      path: "/workspace/src/app.ts", rel: "src/app.ts", kind: "update", added: 3, removed: 1,
    }
    const html = renderToStaticMarkup(createElement(ReviewFileHead, {
      file,
      copyDisabled: false,
      onReveal: () => undefined,
      onCopy: () => Promise.resolve(true),
    }))
    expect(html).toContain('data-state="idle"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('aria-label="复制这份文件改动"')
  })
})
