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

describe("Markdown 中文粗体", () => {
  const html = (text: string, streaming = false): string =>
    renderToStaticMarkup(createElement(Markdown, { text, streaming }))

  it("「**原因：**这里」收得上——**定稿之后星号不许还印在屏幕上**", () => {
    expect(html("**原因：**这里要清滑窗")).toContain("<strong>原因：</strong>这里要清滑窗")
    expect(html("这是**「重点」**内容")).toContain("<strong>「重点」</strong>")
  })

  it("英文和乘方照旧：插件只放宽紧挨中日韩文字的那一条", () => {
    expect(html("a **b** c")).toContain("<strong>b</strong>")
    expect(html("2 ** 10 ** 3")).not.toContain("<strong>")
  })

  it("流式期间没收尾的粗体先画成粗体；定稿的正文一个字都不补", () => {
    expect(html("先说结论：**换会话时要清", true)).toContain("<strong>换会话时要清</strong>")
    expect(html("先说结论：**换会话时要清")).not.toContain("<strong>")
  })
})
