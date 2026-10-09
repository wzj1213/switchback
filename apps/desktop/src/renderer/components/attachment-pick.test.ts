import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { AttachmentPick } from "./attachment-pick.js"

describe("系统文件选择入口", () => {
  it("入口始终表示文件或图片，不再依赖当前模型的图片能力，历史会话也照样能点", () => {
    const html = renderToStaticMarkup(createElement(AttachmentPick, { onPick: () => undefined }))
    expect(html).toContain('aria-label="添加文件或图片"')
    expect(html).toContain("也可拖入或粘贴")
    expect(html).not.toContain("disabled")
  })
})
