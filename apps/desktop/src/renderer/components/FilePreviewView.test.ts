import { describe, expect, it } from "vitest"
import type { FilePreview } from "../../shared/file-preview.js"
import { canRevealPreview } from "./FilePreviewView.js"

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
    })
  }
})
