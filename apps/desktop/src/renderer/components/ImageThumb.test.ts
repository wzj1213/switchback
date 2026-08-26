import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ImageLightbox } from "./ImageThumb.js"

describe("图片大图层", () => {
  it("是有名字、可关闭且接管焦点的模态，而不是展示用背景层", () => {
    const html = renderToStaticMarkup(createElement(ImageLightbox, {
      path: "C:\\work\\shots\\screen.png",
      onClose: () => undefined,
    }))
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="图片预览：screen.png"')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('aria-label="关闭图片预览"')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('role="presentation"')
  })
})
