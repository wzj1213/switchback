import { describe, expect, it } from "vitest"
import { fileChangesOf } from "./diff.js"
import { synthDiff } from "../synth.js"

describe("synthDiff", () => {
  it("掐掉首尾相同的行，只把真正变了的那段标出来", () => {
    const { diff, added, removed } = synthDiff("一\n旧\n三\n", "一\n新\n三\n")
    expect(diff).toBe(" 一\n-旧\n+新\n 三")
    expect({ added, removed }).toEqual({ added: 1, removed: 1 })
  })

  it("纯新增：旧的为空时全是加号", () => {
    expect(synthDiff("", "甲\n乙\n")).toEqual({ diff: "+甲\n+乙", added: 2, removed: 0 })
  })

  it("纯删除", () => {
    expect(synthDiff("甲\n乙\n", "")).toEqual({ diff: "-甲\n-乙", added: 0, removed: 2 })
  })

  it("完全没变时不产生任何增删行", () => {
    expect(synthDiff("同\n样\n", "同\n样\n")).toMatchObject({ added: 0, removed: 0 })
  })

  it("上下文最多各留两行，别把整个文件当上下文贴出来", () => {
    const old = ["1", "2", "3", "4", "5", "旧"].join("\n")
    const next = ["1", "2", "3", "4", "5", "新"].join("\n")
    expect(synthDiff(old, next).diff).toBe(" 4\n 5\n-旧\n+新")
  })

  it("前后缀不重叠——同一行不能既算前缀上下文又算后缀上下文", () => {
    // 旧只有一行、新有两行，且第一行相同：前缀吃掉它之后后缀必须为 0
    const { added, removed } = synthDiff("同\n", "同\n多\n")
    expect({ added, removed }).toEqual({ added: 1, removed: 0 })
  })

  it("末尾换行不算一行", () => {
    expect(synthDiff("", "只有一行\n")).toMatchObject({ added: 1 })
  })
})

describe("fileChangesOf", () => {
  it("Edit 合成一条改动", () => {
    const [file] = fileChangesOf("Edit", { file_path: "/w/a.ts", old_string: "旧", new_string: "新" })
    expect(file).toEqual({ path: "/w/a.ts", kind: "update", diff: "-旧\n+新", added: 1, removed: 1 })
  })

  it("Write 把整份内容当新增", () => {
    const [file] = fileChangesOf("Write", { file_path: "/w/a.ts", content: "甲\n乙\n" })
    expect(file).toMatchObject({ added: 2, removed: 0, diff: "+甲\n+乙" })
  })

  it("kind 一律 update——Claude 不告诉我们这文件此前存不存在，标 add 会在覆盖时说假话", () => {
    const [file] = fileChangesOf("Write", { file_path: "/w/a.ts", content: "x" })
    expect(file?.kind).toBe("update")
  })

  it("MultiEdit 合成一条，多处改动用 hunk 头分段", () => {
    const [file] = fileChangesOf("MultiEdit", {
      file_path: "/w/a.ts",
      edits: [
        { old_string: "甲", new_string: "甲2" },
        { old_string: "乙", new_string: "乙2" },
      ],
    })
    expect(file?.diff).toBe("@@ 第 1 处 @@\n-甲\n+甲2\n@@ 第 2 处 @@\n-乙\n+乙2")
    expect(file).toMatchObject({ added: 2, removed: 2 })
  })

  it("没有 file_path 就不产生改动，宁可不显示也不显示一条无主的 diff", () => {
    expect(fileChangesOf("Edit", { old_string: "a", new_string: "b" })).toEqual([])
  })

  it("什么都没变时不产生改动条目", () => {
    expect(fileChangesOf("Edit", { file_path: "/w/a.ts", old_string: "同", new_string: "同" })).toEqual([])
  })
})
