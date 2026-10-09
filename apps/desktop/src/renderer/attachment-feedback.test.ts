import { describe, expect, it } from "vitest"
import { dropNotice, failedDropHint, hasFileItems, hoverHint,
  reviewAttachments } from "./attachment-feedback.js"

describe("附件拖放反馈", () => {
  const cases = [
    { name: "支持的图片可放", files: [{ type: "image/png", size: 10 }], enabled: true,
      tone: "ready", text: "松手添加 1 张图片" },
    { name: "模型不支持图片时改成可见文件引用", files: [{ type: "image/png", size: 10 }], enabled: false,
      tone: "ready", text: "松手引用 1 个文件" },
    { name: "源码文件可直接拖入引用", files: [{ type: "text/typescript", size: 10 }], enabled: true,
      tone: "ready", text: "松手引用 1 个文件" },
    { name: "不支持图片的模型仍可引用源码文件",
      files: [{ type: "text/typescript", size: 10 }], enabled: false,
      tone: "ready", text: "松手引用 1 个文件" },
    { name: "超大源码不经附件通道而是引用路径",
      files: [{ type: "text/typescript", size: 13 * 1024 * 1024 }], enabled: true,
      tone: "ready", text: "松手引用 1 个文件" },
    { name: "超大图片绕开图片附件但仍可引用路径", files: [
      { type: "image/png", size: 13 * 1024 * 1024 },
    ], enabled: true, tone: "ready", text: "松手引用 1 个文件" },
    { name: "混合拖放分别说明附件与引用", files: [
      { type: "image/webp", size: 10 }, { type: "application/zip", size: 10 },
    ], enabled: true, tone: "ready", text: "松手添加 1 张图片并引用 1 个文件" },
  ] as const

  for (const row of cases) {
    it(row.name, () => {
      expect(hoverHint(reviewAttachments(row.files), row.enabled)).toEqual({ tone: row.tone, text: row.text })
    })
  }

  it("粘贴板只要含文件项就同步截住，不能再落成路径文本", () => {
    expect(hasFileItems({ 0: { kind: "string" }, 1: { kind: "file" }, length: 2 })).toBe(true)
    expect(hasFileItems({ 0: { kind: "string" }, length: 1 })).toBe(false)
  })

  it("落下后失败收成非阻塞通知，不继续覆盖整个任务表面", () => {
    expect(failedDropHint({ text: "未能读取", tone: "warn" })).toEqual({
      text: "未能读取", tone: "blocked", compact: true,
    })
  })

  it("落下后把附件、引用、失败和工作区外路径都说清", () => {
    expect(dropNotice({ images: 1, references: 2, failed: 1, outside: 1 })).toBe(
      "已添加 1 张图片，并引用 2 个文件；另有 1 个文件未能读取。其中 1 个在当前工作区外，已保留绝对路径；能否读取由引擎权限决定。",
    )
  })

  it("没有一个路径能读取时不把失败句写成成功语气", () => {
    expect(dropNotice({ images: 0, references: 0, failed: 2, outside: 0 }))
      .toBe("未添加：2 个文件未能读取。")
  })

  it("重复项既不计入成功数量，也明确说明没有再次添加", () => {
    expect(dropNotice({ images: 0, references: 0, failed: 0, outside: 0, duplicates: 2 }))
      .toBe("没有重复添加：2 个文件已经在待发送内容中。")
  })
})
