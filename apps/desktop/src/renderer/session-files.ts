import type { Item } from "@omni/protocol"
import { canonicalPath } from "../shared/paths.js"

export interface SessionFile {
  path: string
  at: number
  action: "读取" | "编辑" | "删除"
  deleted: boolean
}

export interface SessionFileGroups {
  recentEdited: readonly SessionFile[]
  recentRead: readonly SessionFile[]
  earlier: readonly SessionFile[]
  inherited: readonly SessionFile[]
}

/**
 * 「改过」压得住后来的「读过」。
 *
 * 引擎改完常常再读一遍核对，末次触达是读——按末次记的话，那份文件就从
 * 「改过」栏掉进「读过」栏，而侧栏那两栏正是用来回答「这轮到底动了什么」的。
 * 时间仍按最近一次触达走：排序要的是「刚才在弄哪个」。
 */
function put(
  files: Map<string, SessionFile>,
  cwd: string,
  entry: Pick<SessionFile, "at" | "action"> & { raw: string },
): void {
  const path = canonicalPath(entry.raw, cwd)
  if (path === "") return
  const before = files.get(path)
  const action = entry.action === "读取" && before !== undefined && before.action !== "读取"
    ? before.action
    : entry.action
  files.set(path, {
    path,
    at: Math.max(entry.at, before?.at ?? entry.at),
    action,
    deleted: entry.action === "删除",
  })
}

/** 当前任务里读过或改过的文件；最近触达的排在最前。 */
export function sessionFilesOf(items: readonly Item[], cwd: string): readonly SessionFile[] {
  const files = new Map<string, SessionFile>()
  for (const item of items) {
    if (item.kind !== "tool_call" || item.status !== "ok") continue
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

function latestOwnTurn(items: readonly Item[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item !== undefined && item.inherited !== true && item.lane === undefined) return item.turnId
  }
  return items.findLast((item) => item.inherited !== true)?.turnId
}

function unseen(files: readonly SessionFile[], seen: Set<string>): readonly SessionFile[] {
  return files.filter((file) => !seen.has(file.path))
}

/** 最近一轮、当前会话更早记录与分支继承历史必须分开，不能都冒充“这轮”。 */
export function sessionFileGroupsOf(items: readonly Item[], cwd: string): SessionFileGroups {
  const own = items.filter((item) => item.inherited !== true)
  const turnId = latestOwnTurn(own)
  const recent = turnId === undefined ? [] : sessionFilesOf(own.filter((item) => item.turnId === turnId), cwd)
  const seen = new Set(recent.map((file) => file.path))
  const earlier = unseen(sessionFilesOf(own.filter((item) => item.turnId !== turnId), cwd), seen)
  for (const file of earlier) seen.add(file.path)
  const inherited = unseen(sessionFilesOf(items.filter((item) => item.inherited === true), cwd), seen)
  return {
    recentEdited: recent.filter((file) => file.action !== "读取"),
    recentRead: recent.filter((file) => file.action === "读取"),
    earlier,
    inherited,
  }
}

/** 最近一次碰到这份文件的 item；对象身份变化就是预览需要重读的最窄节拍。 */
export function fileTouchOf(items: readonly Item[], cwd: string, raw: string): Item | undefined {
  const wanted = canonicalPath(raw, cwd)
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind !== "tool_call" || item.status !== "ok") continue
    if (item.detail.kind === "file_read" && canonicalPath(item.detail.path, cwd) === wanted) return item
    if (item.detail.kind !== "file_edit") continue
    const paths = item.detail.files.length === 0
      ? [item.detail.path]
      : item.detail.files.map((file) => file.path)
    if (paths.some((path) => canonicalPath(path, cwd) === wanted)) return item
  }
  return undefined
}
