import { describe, expect, it } from "vitest"
import type { Item, ToolStatus } from "@switchback/protocol"
import { fileTouchOf, sessionFileGroupsOf, sessionFilesOf } from "./session-files.js"

const tool = (
  id: string,
  at: number,
  detail: Extract<Item, { kind: "tool_call" }>["detail"],
  options: { status?: ToolStatus; turnId?: string; inherited?: boolean } = {},
): Item => {
  const { status = "ok", turnId = "turn-1", inherited = false } = options
  return {
    id, turnId, kind: "tool_call", tool: "test", status, at, detail,
    ...(inherited ? { inherited: true as const } : {}),
  }
}

describe("任务文件清单", () => {
  it("归一相对路径、去重并把最近触达的放前面", () => {
    const items: readonly Item[] = [
      tool("r", 1, { kind: "file_read", path: "src/a.ts" }),
      tool("e", 2, {
        kind: "file_edit",
        path: "src/a.ts",
        files: [{ path: "./src/a.ts", kind: "update", added: 1, removed: 0 }],
        added: 1,
        removed: 0,
      }),
      tool("d", 3, {
        kind: "file_edit",
        path: "old.ts",
        files: [{ path: "old.ts", kind: "delete", added: 0, removed: 4 }],
        added: 0,
        removed: 4,
      }),
    ]

    expect(sessionFilesOf(items, "/work")).toEqual([
      { path: "/work/old.ts", at: 3, action: "删除", deleted: true },
      { path: "/work/src/a.ts", at: 2, action: "编辑", deleted: false },
    ])
  })

  it("改完再读一遍，那份文件仍然算改过", () => {
    const items: readonly Item[] = [
      tool("e", 1, {
        kind: "file_edit",
        path: "src/a.ts",
        files: [{ path: "src/a.ts", kind: "update", added: 2, removed: 1 }],
        added: 2,
        removed: 1,
      }),
      tool("r", 5, { kind: "file_read", path: "src/a.ts" }),
    ]

    expect(sessionFilesOf(items, "/work")).toEqual([
      { path: "/work/src/a.ts", at: 5, action: "编辑", deleted: false },
    ])
  })

  it("失败与未完成的路径不进清单；删除后成功读到会恢复入口", () => {
    const deleted = tool("d", 1, {
      kind: "file_edit", path: "back.txt",
      files: [{ path: "back.txt", kind: "delete", added: 0, removed: 1 }],
      added: 0, removed: 1,
    })
    const restored = tool("r", 5, { kind: "file_read", path: "back.txt" })
    const failed = tool("f", 6, { kind: "file_read", path: "secret.txt" }, { status: "failed" })
    const running = tool("p", 7, { kind: "file_read", path: "pending.txt" }, { status: "running" })

    expect(sessionFilesOf([deleted, restored, failed, running], "/work")).toEqual([
      { path: "/work/back.txt", at: 5, action: "删除", deleted: false },
    ])
    expect(fileTouchOf([restored, failed], "/work", "secret.txt")).toBeUndefined()
  })

  it("预览刷新只跟当前文件最近一次触达的对象走", () => {
    const first = tool("a1", 1, {
      kind: "file_edit", path: "src/a.ts", files: [], added: 1, removed: 0,
    })
    const other = tool("b", 2, { kind: "file_read", path: "src/b.ts" })
    const latest = tool("a2", 3, { kind: "file_read", path: "./src/a.ts" })
    const failed = tool("a3", 4, { kind: "file_read", path: "src/a.ts" }, { status: "failed" })
    expect(fileTouchOf([first, latest, failed], "/work", "/work/src/a.ts")).toBe(latest)
    expect(fileTouchOf([first, other, latest], "/work", "/work/src/a.ts")).toBe(latest)
    expect(fileTouchOf([first, other], "/work", "/work/src/a.ts")).toBe(first)
    expect(fileTouchOf([other], "/work", "/work/src/a.ts")).toBeUndefined()
  })

  it("最近一轮、此前记录与继承历史分开，同一路径只留最新归属", () => {
    const earlier = tool("old", 1, { kind: "file_read", path: "old.ts" }, { turnId: "turn-0" })
    const replaced = tool("shared-old", 2, {
      kind: "file_edit", path: "shared.ts", files: [], added: 1, removed: 0,
    }, { turnId: "turn-0" })
    const inherited = tool("parent", 3, { kind: "file_read", path: "parent.ts" }, {
      turnId: "parent", inherited: true,
    })
    const currentRead = tool("shared-now", 4, { kind: "file_read", path: "shared.ts" })
    const currentEdit = tool("now", 5, {
      kind: "file_edit", path: "now.ts", files: [], added: 1, removed: 0,
    })
    expect(sessionFileGroupsOf([earlier, replaced, inherited, currentRead, currentEdit], "/work")).toEqual({
      recentEdited: [{ path: "/work/now.ts", at: 5, action: "编辑", deleted: false }],
      recentRead: [{ path: "/work/shared.ts", at: 4, action: "读取", deleted: false }],
      earlier: [{ path: "/work/old.ts", at: 1, action: "读取", deleted: false }],
      inherited: [{ path: "/work/parent.ts", at: 3, action: "读取", deleted: false }],
    })
  })

  it("新一轮尚未碰文件时，旧文件只出现在此前记录", () => {
    const old = tool("old", 1, { kind: "file_read", path: "old.ts" }, { turnId: "turn-0" })
    const message: Item = { id: "user", turnId: "turn-1", kind: "user_message", text: "继续", at: 2 }
    expect(sessionFileGroupsOf([old, message], "/work")).toEqual({
      recentEdited: [], recentRead: [],
      earlier: [{ path: "/work/old.ts", at: 1, action: "读取", deleted: false }],
      inherited: [],
    })
  })
})
