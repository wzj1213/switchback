import { describe, expect, it } from "vitest"
import { canAttachImage, canAttachImagePath, imageExtension, MAX_IMAGE_BYTES, pickedFile } from "./attachments.js"

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

  it("系统选择器回来的路径按同一组格式与大小核对", () => {
    expect(canAttachImagePath("/tmp/a.JPEG", 10)).toBe(true)
    expect(canAttachImagePath("/tmp/a.webp", MAX_IMAGE_BYTES)).toBe(true)
    expect(canAttachImagePath("/tmp/a.svg", 10)).toBe(false)
    expect(canAttachImagePath("/tmp/a.png", 0)).toBe(false)
    expect(canAttachImagePath("/tmp/a.png", MAX_IMAGE_BYTES + 1)).toBe(false)
  })

  it("系统选择器保留所有真实文件，只标记能走原生附件的图片", () => {
    expect(pickedFile("/tmp/a.png", 10, true)).toEqual({ path: "/tmp/a.png", image: true })
    expect(pickedFile("/tmp/a.pdf", 10, true)).toEqual({ path: "/tmp/a.pdf", image: false })
    expect(pickedFile("/tmp/huge.png", MAX_IMAGE_BYTES + 1, true))
      .toEqual({ path: "/tmp/huge.png", image: false })
    expect(pickedFile("/tmp/gone.txt", 0, false)).toBeUndefined()
  })
})
