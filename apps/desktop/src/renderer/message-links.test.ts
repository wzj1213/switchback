import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { inlineTarget, messageTarget, resolveMessagePath } from "./message-links.js"
import { Markdown } from "./components/Markdown.js"
import { FileLinkScope } from "./components/message-link.js"

describe("回答链接分流", () => {
  const cases = [
    ["https://example.com/path#L8", { kind: "external", href: "https://example.com/path#L8" }],
    ["http://127.0.0.1:8766", { kind: "external", href: "http://127.0.0.1:8766/" }],
    ["mailto:me@example.com", { kind: "external", href: "mailto:me@example.com" }],
    ["//example.com/docs", { kind: "external", href: "https://example.com/docs" }],
    ["/work/任务/manager.py:42:3", { kind: "file", path: "/work/任务/manager.py", line: 42, column: 3 }],
    ["manager.py:42", { kind: "file", path: "manager.py", line: 42 }],
    ["src/app.ts#L10-L20", { kind: "file", path: "src/app.ts", line: 10 }],
    ["src/app.ts#L10C4", { kind: "file", path: "src/app.ts", line: 10, column: 4 }],
    ["docs/a%20b.md#设计", { kind: "file", path: "docs/a b.md", fragment: "设计" }],
    ["file:///work/a%20b.py#L3", { kind: "file", path: "/work/a b.py", line: 3 }],
    ["file:///C:/work/app.ts:2", { kind: "file", path: "C:/work/app.ts", line: 2 }],
    ["C:\\work\\app.ts:2", { kind: "file", path: "C:\\work\\app.ts", line: 2 }],
    ["#功能说明", { kind: "fragment", fragment: "功能说明" }],
    ["javascript:alert(1)", { kind: "unsupported" }],
    ["data:text/html,hi", { kind: "unsupported" }],
    ["file://remote/share/secret.txt", { kind: "unsupported" }],
    ["https://", { kind: "unsupported" }],
    ["java\nscript:alert(1)", { kind: "unsupported" }],
    ["", { kind: "unsupported" }],
  ] as const
  for (const [href, expected] of cases) it(href || "空链接", () => { expect(messageTarget(href)).toEqual(expected) })

  it("文档内相对链接以文档目录为基准，回答链接以工作区为基准", () => {
    expect(resolveMessagePath("src/app.ts", "/work")).toBe("/work/src/app.ts")
    expect(resolveMessagePath("../src/app.ts", "/work", "/work/docs/design.md")).toBe("/work/src/app.ts")
    expect(resolveMessagePath("/other/app.ts", "/work", "/work/docs/design.md")).toBe("/other/app.ts")
  })
})

describe("Markdown 链接渲染", () => {
  const render = (text: string): string => renderToStaticMarkup(createElement(FileLinkScope, {
    threadId: "t", cwd: "/work", children: createElement(Markdown, { text }),
  }))
  it("文件有预览入口，行内 URL 仍可打开，代码块保持原文", () => {
    const html = render("[manager.py](/work/任务/manager.py:42) `http://127.0.0.1:8766`\n\n```\nhttp://127.0.0.1:8766\n```")
    expect(html).toContain('class="outlink outlink--file"')
    expect(html).toContain("预览文件 · /work/任务/manager.py:42")
    expect(html.match(/target="_blank"/g)).toHaveLength(1)
    expect(html.match(/<a /g)).toHaveLength(2)
  })
  it("文件名包在代码里的 Markdown 链接不生成嵌套链接", () => {
    const html = render("[`manager.py`](/work/manager.py:42)")
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain("<code>manager.py</code>")
  })
  it("不支持的协议不留可执行入口，原始 HTML 不执行", () => {
    const html = render('[坏链接](javascript:alert) <script>alert(1)</script>')
    expect(html).not.toContain("<a ")
    expect(html).not.toContain("<script>")
  })
  it("行内命令保持可复制的原文，含空格文件仍能通过显式链接打开", () => {
    const html = render('`./run.sh --help` `/usr/bin/python app.py` `http://localhost:8766 --help` [脚本](</work/My Script.sh>)')
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain('<code>./run.sh --help</code>')
    expect(html).toContain('预览文件 · /work/My Script.sh')
  })
  const inline = [["src/app.ts:8", true], ["manager.py", true], ["v1.2", false],
    ["./run.sh --help", false], ["/usr/bin/python app.py", false], ["./run.sh|cat", false], ["./run.sh|cat.txt", false],
    ["http://localhost:8766 --help", false], ["./中文文件.py", true],
    ["pnpm test", false], ["git diff --stat", false], ["foo()", false], ["http://x.test\n", false]] as const
  for (const [text, expected] of inline) it(`行内代码 ${text}`, () => { expect(inlineTarget(text)).toBe(expected) })
})
