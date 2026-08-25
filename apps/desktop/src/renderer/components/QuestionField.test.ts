import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { QuestionField } from "./QuestionField.js"

describe("桌面原生问题外链", () => {
  it("完整显示地址与风险提示，并只交给外部窗口", () => {
    const html = renderToStaticMarkup(createElement(QuestionField, {
      question: {
        id: "url", question: "完成授权", options: [],
        external: { url: "https://example.com/connect?q=1", warning: "仔细核对" },
      },
      index: 0,
      prefix: "p",
      draft: { optionIds: [], other: false, otherText: "", noteText: "" },
      update: () => undefined,
    }))
    expect(html).toContain('href="https://example.com/connect?q=1"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain("example.com")
    expect(html).toContain("仔细核对")
  })

  it("异常回放不能把危险协议变成可点击入口", () => {
    const html = renderToStaticMarkup(createElement(QuestionField, {
      question: { id: "url", question: "完成授权", options: [], external: { url: "javascript:alert(1)" } },
      index: 0,
      prefix: "p",
      draft: { optionIds: [], other: false, otherText: "", noteText: "" },
      update: () => undefined,
    }))
    expect(html).not.toContain("href=")
    expect(html).not.toContain("javascript:")
  })
})

describe("桌面原生选项预览", () => {
  it("把引擎给出的多行预览留在对应选项内", () => {
    const html = renderToStaticMarkup(createElement(QuestionField, {
      question: {
        id: "preview", question: "选哪条？",
        options: [{ id: "a", label: "方案 A", preview: "src/a.ts\n  → src/b.ts" }],
      },
      index: 0,
      prefix: "p",
      draft: { optionIds: ["a"], other: false, otherText: "", noteText: "" },
      update: () => undefined,
    }))
    expect(html).toContain('class="question-option__preview"')
    expect(html).toContain("src/a.ts\n  → src/b.ts")
  })
})
