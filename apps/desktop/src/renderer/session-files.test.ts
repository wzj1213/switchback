import { describe, expect, it } from "vitest"
import type { Item } from "@omni/protocol"
import { sessionFilesOf } from "./session-files.js"

const tool = (id: string, at: number, detail: Extract<Item, { kind: "tool_call" }>["detail"]): Item => ({
  id,
  turnId: "turn-1",
  kind: "tool_call",
  tool: "test",
  status: "ok",
  at,
  detail,
})

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
})
