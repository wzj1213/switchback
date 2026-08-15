import { describe, expect, it } from "vitest"
import { parseDiff, splitPath, tally } from "./diff.js"

describe("parseDiff", () => {
  it("unified diff 分出增/删/上下文，并剥掉前缀", () => {
    expect(parseDiff("@@ -1,2 +1,2 @@\n 保持\n-旧\n+新\n", "update")).toEqual([
      { kind: "hunk", text: "@@ -1,2 +1,2 @@" },
      { kind: "ctx", text: "保持" },
      { kind: "del", text: "旧" },
      { kind: "add", text: "新" },
    ])
  })

  it("`+++` / `---` 是文件头不是增删行——按增删渲染每个补丁都会凭空多一红一绿", () => {
    expect(parseDiff("--- a/x.ts\n+++ b/x.ts\n+真正的新增\n", "update")).toEqual([
      { kind: "meta", text: "--- a/x.ts" },
      { kind: "meta", text: "+++ b/x.ts" },
      { kind: "add", text: "真正的新增" },
    ])
  })

  it("新建文件给的是**文件内容本身**，整体算新增，不能按 diff 解析", () => {
    // 一个以 `-- 说明` 开头的 Markdown 新文件，照 diff 解析会被读成"删除了一行"
    expect(parseDiff("-- 说明\n正文\n", "add")).toEqual([
      { kind: "add", text: "-- 说明" },
      { kind: "add", text: "正文" },
    ])
  })

  it("删除文件整体算删除", () => {
    expect(parseDiff("一\n二\n", "delete")).toEqual([
      { kind: "del", text: "一" },
      { kind: "del", text: "二" },
    ])
  })

  it("末尾换行不算一行内容——否则每个文件底部都多一条空行", () => {
    expect(parseDiff("只有一行\n", "add")).toHaveLength(1)
  })

  it("空 diff 给空数组，不是一条空行", () => {
    expect(parseDiff("", "update")).toEqual([])
  })

  it("上下文行只剥一个空格，缩进保留", () => {
    const [line] = parseDiff("     缩进四格", "update")
    expect(line).toEqual({ kind: "ctx", text: "    缩进四格" })
  })
})

describe("splitPath", () => {
  it("目录与文件名分开", () => {
    expect(splitPath("/a/b/c.ts")).toEqual({ dir: "/a/b/", name: "c.ts" })
  })

  it("没有目录时 dir 为空", () => {
    expect(splitPath("c.ts")).toEqual({ dir: "", name: "c.ts" })
  })
})

describe("tally", () => {
  it("逐文件累加", () => {
    expect(
      tally([
        { path: "a", kind: "add", added: 3, removed: 0 },
        { path: "b", kind: "update", added: 1, removed: 4 },
      ]),
    ).toEqual({ added: 4, removed: 4 })
  })
})
