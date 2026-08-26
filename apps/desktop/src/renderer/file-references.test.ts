import { describe, expect, it } from "vitest"
import { appendFileReferences, fileReference, formatFileReference } from "./file-references.js"

describe("拖入文件引用", () => {
  const relativeCases = [
    ["工作区文件收成相对路径", "/work/omni", "/work/omni/src/a.ts", { path: "src/a.ts", outside: false }],
    ["同名目录不算工作区内", "/work/omni", "/work/omnibus/a.ts", { path: "/work/omnibus/a.ts", outside: true }],
    ["工作区本身用点表示", "/work/omni/", "/work/omni", { path: ".", outside: false }],
    ["根目录工作区不会把所有文件误报为外部", "/", "/tmp/a.ts", { path: "tmp/a.ts", outside: false }],
    ["Windows 路径不区分盘符大小写", "C:\\Work\\Omni", "c:\\work\\omni\\a.ts",
      { path: "a.ts", outside: false }],
    ["Windows 盘符根目录保留分隔符", "C:\\", "c:\\work\\a.ts", { path: "work/a.ts", outside: false }],
  ] as const
  for (const [name, cwd, path, expected] of relativeCases) {
    it(name, () => { expect(fileReference(cwd, path)).toEqual(expected) })
  }

  const formatCases = [
    ["普通路径保留简洁 @", "src/a.ts", "@src/a.ts"],
    ["空格路径带引号", "docs/my note.md", "@\"docs/my note.md\""],
    ["反斜杠路径转义", "C:\\work\\a.ts", "@\"C:\\\\work\\\\a.ts\""],
  ] as const
  for (const [name, path, expected] of formatCases) {
    it(name, () => { expect(formatFileReference(path)).toBe(expected) })
  }

  it("追加引用时保留原文、去重并补发送所需的分隔空格", () => {
    expect(appendFileReferences("检查", ["a.ts", "a.ts", "docs/my note.md"]))
      .toBe("检查 @a.ts @\"docs/my note.md\" ")
  })
})
