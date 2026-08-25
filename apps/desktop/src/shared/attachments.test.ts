import { describe, expect, it } from "vitest"
import { canAttachImage, imageExtension, MAX_IMAGE_BYTES } from "./attachments.js"

describe("桌面图片附件边界", () => {
  it.each([
    ["image/png", ".png"],
    ["image/jpeg", ".jpg"],
    ["image/gif", ".gif"],
    ["image/webp", ".webp"],
  ])("%s 使用稳定扩展名", (mime, extension) => {
    expect(imageExtension(mime)).toBe(extension)
  })

  it("不让 HEIC/SVG 和超大拖拽图片绕过粘贴白名单", () => {
    expect(canAttachImage({ type: "image/heic", size: 10 })).toBe(false)
    expect(canAttachImage({ type: "image/svg+xml", size: 10 })).toBe(false)
    expect(canAttachImage({ type: "image/png", size: 0 })).toBe(false)
    expect(canAttachImage({ type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toBe(false)
    expect(canAttachImage({ type: "image/png", size: MAX_IMAGE_BYTES })).toBe(true)
  })
})
