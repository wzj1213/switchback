import type { FileChange, Item } from "@omni/protocol"
import type { ReviewFile } from "../shared/review.js"

export interface Changes {
  files: number
  added: number
  removed: number
  list: readonly ChangedFile[]
}

/** 会话里触达过的文件。`review` 有值时，数字与补丁都以 git 当前状态为准。 */
export interface ChangedFile {
  path: string
  added: number
  removed: number
  /** 非 git 工作区的诚实降级：只保留最后一次上报，不把多轮数字相加。 */
  last: FileChange
  review?: ReviewFile
}

function tally(list: readonly ChangedFile[]): Changes {
  return {
    files: list.length,
    added: list.reduce((sum, file) => sum + file.added, 0),
    removed: list.reduce((sum, file) => sum + file.removed, 0),
    list,
  }
}

function absolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path)
}

function rootOf(path: string): { body: string; prefix: string; rooted: boolean } {
  const drive = /^[A-Za-z]:\//.exec(path)?.[0]
  if (drive !== undefined) return { body: path.slice(drive.length), prefix: drive, rooted: true }
  if (path.startsWith("/")) return { body: path, prefix: "/", rooted: true }
  return { body: path, prefix: "", rooted: false }
}

function collapsed(body: string, rooted: boolean): readonly string[] {
  const parts: string[] = []
  for (const part of body.split("/")) {
    if (part === "" || part === ".") continue
    if (part !== "..") {
      parts.push(part)
      continue
    }
    const last = parts.at(-1)
    if (last !== undefined && last !== "..") parts.pop()
    else if (!rooted) parts.push(part)
  }
  return parts
}

function tmpAlias(path: string): string {
  if (path === "/tmp") return "/private/tmp"
  return path.startsWith("/tmp/") ? `/private${path}` : path
}

/** 不碰文件系统的词法归一；renderer 里不能拿 `realpath`，已知的 macOS `/tmp` 别名在此收口。 */
function normalizePath(raw: string): string {
  if (raw === "") return ""
  const path = raw.replace(/\\/g, "/")
  const root = rootOf(path)
  const normalized = `${root.prefix}${collapsed(root.body, root.rooted).join("/")}`
  return tmpAlias(normalized || (root.rooted ? root.prefix : "."))
}

/** 引擎路径统一到会话 cwd；用于归属、去重与和 Git 真实路径对齐。 */
export function canonicalPath(path: string, cwd: string): string {
  const normalized = normalizePath(path)
  if (normalized === "" || absolute(normalized) || cwd === "") return normalized
  return normalizePath(`${normalizePath(cwd)}/${normalized}`)
}

/**
 * 引擎明确报告成功的编辑。
 *
 * 同一文件按 cwd 归一后只占一行、按首次出现排序；后续别名上报只更新最后一次编辑。
 * 真实净变更随后由 `reconcileChanges` 向 git 核实。
 */
export function reportedChangesOf(items: readonly Item[], cwd: string): Changes {
  const files = new Map<string, ChangedFile>()
  for (const item of items) {
    if (item.kind !== "tool_call" || item.detail.kind !== "file_edit" || item.status !== "ok")
      continue
    for (const file of item.detail.files) {
      const path = canonicalPath(file.path, cwd)
      if (path === "") continue
      files.set(path, { path, added: file.added, removed: file.removed, last: file })
    }
  }
  return tally([...files.values()])
}

function renamedPath(file: ReviewFile, root: string): string | undefined {
  return file.from === undefined || root === "" ? undefined : canonicalPath(file.from, root)
}

function segmentSuffix(path: string, suffix: string): boolean {
  return path === suffix || path.endsWith(`/${suffix}`)
}

/** 精确路径优先；只能靠相对路径时必须唯一，绝不拿 Git 清单里的第一个同名文件猜。 */
function reviewOf(
  file: ChangedFile,
  current: readonly ReviewFile[],
  root: string,
): ReviewFile | undefined {
  const exact = current.filter((candidate) => {
    const path = canonicalPath(candidate.path, "")
    return path === file.path || renamedPath(candidate, root) === file.path
  })
  if (exact.length === 1) return exact[0]
  if (exact.length > 1 || absolute(normalizePath(file.last.path))) return undefined
  const relative = normalizePath(file.last.path)
  const matches = current.filter((candidate) => {
    const from = candidate.from === undefined ? undefined : normalizePath(candidate.from)
    return segmentSuffix(normalizePath(candidate.rel), relative) || from === relative
  })
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * 用当前 git 清单校正会话变更。
 *
 * - 数字来自 `git diff HEAD --numstat`，不是多轮工具统计相加；
 * - git 清单里已经没有的会话文件说明净改动为零，整行消失；
 * - 先解析到 Git 文件身份再去重，跨引擎路径别名不会重复计算。
 */
export function reconcileChanges(
  reported: Changes,
  current: readonly ReviewFile[],
  root: string,
): Changes {
  const files = new Map<string, ChangedFile>()
  for (const file of reported.list) {
    const review = reviewOf(file, current, root)
    if (review === undefined) continue
    const path = canonicalPath(review.path, "")
    files.set(path, { ...file, path, added: review.added, removed: review.removed, review })
  }
  return tally([...files.values()])
}
