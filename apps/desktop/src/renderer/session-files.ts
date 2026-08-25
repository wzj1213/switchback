import type { Item } from "@omni/protocol"
import { canonicalPath } from "./changes.js"

export interface SessionFile {
  path: string
  at: number
  action: "读取" | "编辑" | "删除"
  deleted: boolean
}

function put(
  files: Map<string, SessionFile>,
  cwd: string,
  entry: Pick<SessionFile, "at" | "action"> & { raw: string },
): void {
  const path = canonicalPath(entry.raw, cwd)
  if (path === "") return
  files.set(path, {
    path,
    at: entry.at,
    action: entry.action,
    deleted: entry.action === "删除",
  })
}

/** 当前任务里读过或改过的文件；最近触达的排在最前。 */
export function sessionFilesOf(items: readonly Item[], cwd: string): readonly SessionFile[] {
  const files = new Map<string, SessionFile>()
  for (const item of items) {
    if (item.kind !== "tool_call") continue
    if (item.detail.kind === "file_read") {
      put(files, cwd, { raw: item.detail.path, at: item.at, action: "读取" })
      continue
    }
    if (item.detail.kind !== "file_edit") continue
    if (item.detail.files.length === 0) {
      put(files, cwd, { raw: item.detail.path, at: item.at, action: "编辑" })
    }
    for (const file of item.detail.files) {
      put(files, cwd, {
        raw: file.path,
        at: item.at,
        action: file.kind === "delete" ? "删除" : "编辑",
      })
    }
  }
  return [...files.values()].sort((a, b) => b.at - a.at)
}
