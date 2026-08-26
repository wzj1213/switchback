import { describe, expect, it } from "vitest"
import { dropNotice, hasFileItems, hoverHint, reviewAttachments } from "./attachment-feedback.js"

describe("附件拖放反馈", () => {
  const cases = [
    { name: "支持的图片可放", files: [{ type: "image/png", size: 10 }], enabled: true,
      tone: "ready", text: "松手添加 1 张图片" },
    { name: "模型不支持时明确拒绝", files: [{ type: "image/png", size: 10 }], enabled: false,
      tone: "blocked", text: "当前引擎或模型不支持图片附件" },
    { name: "源码文件不冒充附件", files: [{ type: "text/typescript", size: 10 }], enabled: true,
      tone: "blocked", text: "这里只能添加图片；工作区文件请用 @ 引用" },
    { name: "不支持图片的模型也先说清源码文件的用法",
      files: [{ type: "text/typescript", size: 10 }], enabled: false,
      tone: "blocked", text: "这里只能添加图片；工作区文件请用 @ 引用" },
    { name: "超大源码仍先按文件类型拒绝",
      files: [{ type: "text/typescript", size: 13 * 1024 * 1024 }], enabled: true,
      tone: "blocked", text: "这里只能添加图片；工作区文件请用 @ 引用" },
    { name: "超大图片当场说明上限", files: [{ type: "image/png", size: 13 * 1024 * 1024 }], enabled: true,
      tone: "blocked", text: "单张图片不能超过 12 MB" },
    { name: "混合拖放保留能收的", files: [
      { type: "image/webp", size: 10 }, { type: "application/zip", size: 10 },
    ], enabled: true, tone: "ready", text: "可添加 1 张；其余文件不会添加" },
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

  it("落下后把未添加数量说清", () => {
    const review = reviewAttachments([
      { type: "image/png", size: 10 }, { type: "image/svg+xml", size: 10 },
    ])
    expect(dropNotice(review, true, 1, 0)).toBe("已添加 1 张；另有 1 个文件未添加。")
  })

  it("落下源码文件后给可行动的正确入口", () => {
    const review = reviewAttachments([{ type: "text/typescript", size: 10 }])
    expect(dropNotice(review, false, 0, 0)).toBe("未添加：这里只接收图片；工作区文件请用 @ 引用。")
  })
})
