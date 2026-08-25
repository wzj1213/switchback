import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { QuestionField } from "./QuestionField.js"

describe("浏览器原生问题外链", () => {
  it("在作答设备新开完整地址并断开 opener", () => {
    const html = renderToStaticMarkup(createElement(QuestionField, {
      question: {
        id: "url", question: "完成授权", options: [],
        external: { url: "https://example.com/connect?q=1" },
      },
      index: 0,
      prefix: "p",
      draft: { optionIds: [], other: false, otherText: "", noteText: "" },
      update: () => undefined,
      disabled: false,
    }))
    expect(html).toContain('href="https://example.com/connect?q=1"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer noopener"')
    expect(html).toContain("example.com")
  })

  it("离线时只显示地址而不保留跳转入口", () => {
    const html = renderToStaticMarkup(createElement(QuestionField, {
      question: {
        id: "url", question: "完成授权", options: [],
        external: { url: "https://example.com/connect?q=1" },
      },
      index: 0,
      prefix: "p",
      draft: { optionIds: [], other: false, otherText: "", noteText: "" },
      update: () => undefined,
      disabled: true,
    }))
    expect(html).not.toContain("href=")
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain("https://example.com/connect?q=1")
  })

  it("异常回放不能把危险协议变成可点击入口", () => {
    const html = renderToStaticMarkup(createElement(QuestionField, {
      question: { id: "url", question: "完成授权", options: [], external: { url: "javascript:alert(1)" } },
      index: 0,
      prefix: "p",
      draft: { optionIds: [], other: false, otherText: "", noteText: "" },
      update: () => undefined,
      disabled: false,
    }))
    expect(html).not.toContain("href=")
    expect(html).not.toContain("javascript:")
  })
})

describe("浏览器原生选项预览", () => {
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
      disabled: false,
    }))
    expect(html).toContain('class="question-option__preview"')
    expect(html).toContain("src/a.ts\n  → src/b.ts")
  })
})
