import { describe, expect, it } from "vitest"
import { copyFeedbackLabel, copyFeedbackTitle, resolveCopyFeedback } from "./use-copy-feedback.js"

describe("复制反馈文案", () => {
  const cases = [
    ["idle", "复制", "复制后台命令"],
    ["copied", "已复制", "内容已复制"],
    ["failed", "复制失败", "复制失败，请重试"],
  ] as const
  for (const [feedback, label, title] of cases) {
    it(feedback, () => {
      expect(copyFeedbackLabel(feedback, "zh-CN")).toBe(label)
      expect(copyFeedbackTitle(feedback, "zh-CN", "复制后台命令")).toBe(title)
      if (feedback === "copied") {
        expect(copyFeedbackTitle(feedback, "zh-CN", "复制", "文件改动已复制")).toBe("文件改动已复制")
      }
    })
  }

  it("英文", () => {
    expect(["idle", "copied", "failed"].map((f) => copyFeedbackLabel(f as "idle", "en"))).toEqual(["Copy", "Copied", "Copy failed"])
    expect(copyFeedbackTitle("failed", "en", "Copy code")).toBe("Couldn't copy. Try again.")
  })
})

describe("复制结果只认回执", () => {
  const cases = [
    ["主进程确认", () => Promise.resolve(true), "copied"],
    ["主进程拒绝", () => Promise.resolve(false), "failed"],
    ["通道异常", () => Promise.reject(new Error("ipc failed")), "failed"],
    ["旧同步调用", () => undefined, "copied"],
  ] as const
  for (const [name, copy, expected] of cases) {
    it(name, async () => {
      await expect(resolveCopyFeedback(copy)).resolves.toBe(expected)
    })
  }
})
