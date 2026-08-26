import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { FilePreview } from "../../shared/file-preview.js"
import { canReferencePreview, canRevealPreview, FilePreviewView } from "./FilePreviewView.js"

describe("文件预览操作", () => {
  const cases: readonly { name: string; file: FilePreview | undefined; path: string; expected: boolean }[] = [
    { name: "正在读取的有效路径", file: undefined, path: "src/app.ts", expected: true },
    {
      name: "存在但不能预览的二进制",
      file: { kind: "unavailable", path: "logo.bin", name: "logo.bin", reason: "binary", message: "不能预览" },
      path: "logo.bin",
      expected: true,
    },
    {
      name: "已经缺失的文件",
      file: { kind: "unavailable", path: "gone.txt", name: "gone.txt", reason: "missing", message: "已经不存在" },
      path: "gone.txt",
      expected: false,
    },
    { name: "空路径", file: undefined, path: "", expected: false },
  ]

  for (const one of cases) {
    it(one.name, () => {
      expect(canRevealPreview(one.file, one.path)).toBe(one.expected)
      expect(canReferencePreview(one.file, one.path)).toBe(one.expected)
    })
  }

  it("后台读取不阻塞路径引用，只有会话只读或确认缺失才挡", () => {
    const html = renderToStaticMarkup(createElement(FilePreviewView, {
      target: { threadId: "thread", cwd: "/work", path: "src/app.ts" },
      revision: undefined, stamp: "idle:0", onBack: () => undefined,
      onReference: () => undefined, onReveal: () => undefined, onCopy: () => undefined,
    }))
    const button = html.match(/<button[^>]+aria-label="引用到输入框"[^>]*>/)?.[0]
    expect(button).toBeDefined()
    expect(button).not.toContain("disabled")
  })
})
