import { describe, expect, it } from "vitest"
import { reportBody, reportedLines } from "./turn-review.js"
import { reportedChangesOf } from "./changes.js"
import type { FileChange, ToolCallItem } from "@switchback/protocol"

describe("原始编辑补丁", () => {
  const cases: { name: string; change: FileChange; expected: unknown }[] = [
    { name: "新建文件的减号是正文，行号从 1 开始", change: { path: "a.md", kind: "add", added: 2, removed: 0, diff: "-- 标题\n内容\n" },
      expected: [{ kind: "add", text: "-- 标题", new: 1 }, { kind: "add", text: "内容", new: 2 }] },
    { name: "删除文件使用原始内容，不依赖磁盘仍存在", change: { path: "gone.ts", kind: "delete", added: 0, removed: 1, diff: "+counter\n" },
      expected: [{ kind: "del", text: "+counter", old: 1 }] },
    { name: "修改中的三个正负号是代码，不是文件头", change: { path: "a.ts", kind: "update", added: 1, removed: 1,
      diff: "--- a/a.ts\n+++ b/a.ts\n@@ -8 +8 @@\n---count\n+++count\n" },
      expected: [{ kind: "hunk", text: "@@ -8 +8 @@" }, { kind: "del", text: "--count", old: 8 }, { kind: "add", text: "++count", new: 8 }] },
    { name: "无位置的片段不伪造行号", change: { path: "a.ts", kind: "update", added: 1, removed: 1, diff: "-old\n+new\n" },
      expected: [{ kind: "del", text: "old" }, { kind: "add", text: "new" }] },
  ]
  for (const one of cases) it(one.name, () => { expect(reportedLines(one.change)).toEqual(one.expected) })

  it("缺补丁与空补丁分开说明", () => {
    const file: FileChange = { path: "a.ts", kind: "update", added: 0, removed: 0 }
    expect(reportBody(file)).toContain("没有提供补丁")
    expect(reportBody({ ...file, diff: "" })).toContain("没有文本差异")
    expect(reportBody({ ...file, diff: "+x" })).toBeUndefined()
    expect(reportBody({ ...file, diff: "+x\n".repeat(10_001) })).toContain("过大")
  })

  it("同一文件重复编辑保留各次记录，不丢第一份补丁", () => {
    const edit = (diff: string): ToolCallItem => ({ id: diff, turnId: "turn", at: 1, kind: "tool_call", tool: "edit", status: "ok",
      detail: { kind: "file_edit", path: "a.ts", added: 1, removed: 1,
        files: [{ path: "a.ts", kind: "update", diff, added: 1, removed: 1 }] } })
    const result = reportedChangesOf([edit("-a\n+b"), edit("-b\n+c")], "/work", true)
    expect(result.files).toBe(1)
    expect(result.list[0]?.edits?.map((file) => file.diff)).toEqual(["-a\n+b", "-b\n+c"])
    expect(result.list[0]?.last.diff).toBe("-b\n+c")
  })
})
