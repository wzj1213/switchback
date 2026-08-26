import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ReviewDiff } from "./ReviewDiff.js"

describe("审核补丁滚动区", () => {
  const cases = [
    [true, "并排文件改动，可滚动"],
    [false, "文件改动，可滚动"],
  ] as const
  for (const [split, label] of cases) {
    it(`${split ? "并排" : "单栏"}内容可由键盘进入`, () => {
      const html = renderToStaticMarkup(createElement(ReviewDiff, {
        lines: [{ kind: "add", text: "const value = true", new: 1 }],
        split,
        loading: false,
      }))
      expect(html).toContain('class="rvd"')
      expect(html).toContain('role="region"')
      expect(html).toContain(`aria-label="${label}"`)
      expect(html).toContain('tabindex="0"')
    })
  }
})
