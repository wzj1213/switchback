import { describe, expect, it } from "vitest"
import {
  composeDraft,
  fileChip,
  hasFile,
  pasteChip,
  worthFolding,
  type DraftBlock,
} from "./composer-blocks.js"

const file = (id: string, path: string): DraftBlock => ({ id, kind: "file", path })
const paste = (id: string, text: string): DraftBlock => ({ id, kind: "paste", text })

describe("多大算大", () => {
  const cases: readonly [name: string, text: string, want: boolean][] = [
    ["三行不折", "a\nb\nc", false],
    ["十行折起来——输入框正是从这里开始变成滚动窗口", "x\n".repeat(9) + "x", true],
    ["一行两千字也折：它只有一行，但照样把输入框撑成一团", "x".repeat(2000), true],
    ["空文本不折", "", false],
  ]
  for (const [name, text, want] of cases) {
    it(name, () => { expect(worthFolding(text)).toBe(want) })
  }
})

describe("芯片上写什么", () => {
  it("文件名醒目、上一级目录压暗", () => {
    expect(fileChip("/Users/w/Downloads/report.pdf")).toEqual({ parent: "Downloads/", name: "report.pdf" })
    expect(fileChip("src/a.ts")).toEqual({ parent: "src/", name: "a.ts" })
    expect(fileChip("README.md")).toEqual({ parent: "", name: "README.md" })
  })
  it("粘贴块报行数，够大才补字节", () => {
    expect(pasteChip("a\nb\nc", "zh-CN")).toBe("粘贴文本 · 3 行")
    expect(pasteChip("x".repeat(2048), "zh-CN")).toBe("粘贴文本 · 1 行 · 2.0 KB")
  })
})

describe("发送时展开", () => {
  it("你打的字在前，附上的东西在后；文件走和手打 @ 同一条路", () => {
    expect(composeDraft("看看", [file("1", "src/a.ts")])).toBe("看看 @src/a.ts ")
  })

  it("粘贴块空一行隔开，顺序按芯片顺序", () => {
    expect(composeDraft("看看这个报错", [paste("1", "line1\nline2"), paste("2", "second")]))
      .toBe("看看这个报错\n\nline1\nline2\n\nsecond")
  })

  it("一个字没打也能发：芯片本身就是要发的东西", () => {
    expect(composeDraft("", [paste("1", "只有日志")])).toBe("只有日志")
  })

  it("正文里已经手打过同一条引用就不再追加", () => {
    expect(composeDraft("看 @src/a.ts", [file("1", "src/a.ts")])).toBe("看 @src/a.ts")
  })

  it("同一个文件不重复挂芯片", () => {
    expect(hasFile([file("1", "src/a.ts")], "src/a.ts")).toBe(true)
    expect(hasFile([file("1", "src/a.ts")], "src/b.ts")).toBe(false)
  })
})
