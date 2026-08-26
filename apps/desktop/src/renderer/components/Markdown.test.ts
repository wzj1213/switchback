import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Markdown } from "./Markdown.js"

describe("Markdown 横向滚动区", () => {
  it("代码块与宽表格都能从键盘进入", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      text: "```ts\nconst veryLongLine = true\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |",
    }))
    expect(html).toContain('<pre tabindex="0">')
    expect(html).toContain('class="md__scroll" tabindex="0" aria-label="可横向滚动的表格"')
  })
})
