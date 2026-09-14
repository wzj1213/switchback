import type { FileChange, Item } from "@omni/protocol"
import type { ReviewFile } from "../shared/review.js"
import { absolute, canonicalPath, isScratch, normalizePath } from "../shared/paths.js"

export interface Changes {
  files: number
  added: number
  removed: number
  list: readonly ChangedFile[]
}

export type ChangeEvidence = "baseline" | "head" | "reported"

/**
 * 变更卡当前能依据什么下结论。
 *
 * 旧会话没有开场树，但一次成功的 Git 查询仍能回答「上报路径现在相对 HEAD 脏不脏」；
 * 它不能归因到本次对话，却足以让已经恢复干净的旧记录消失。
 */
export function changeEvidenceOf(state: {
  baseline: boolean
  failed: boolean
  noRepo: boolean
  settled: boolean
}): ChangeEvidence {
  if (state.failed || state.noRepo || !state.settled) return "reported"
  return state.baseline ? "baseline" : "head"
}

/** 会话里触达过的文件。`review` 有值时，数字与补丁都以 git 当前状态为准。 */
export interface ChangedFile {
  path: string
  added: number
  removed: number
  /** 非 git 工作区的诚实降级：只保留最后一次上报，不把多轮数字相加。 */
  last: FileChange
  /** 同一轮同一文件的原始编辑序列，只在重复编辑时保存。 */
  edits?: readonly FileChange[]
  review?: ReviewFile
  /** Git ignore 规则让开场树无法覆盖这条路径，只能保留引擎最后一次上报。 */
  unverified?: true
}

function tally(list: readonly ChangedFile[]): Changes {
  return {
    files: list.length,
    added: list.reduce((sum, file) => sum + file.added, 0),
    removed: list.reduce((sum, file) => sum + file.removed, 0),
    list,
  }
}

function editHistory(previous: ChangedFile | undefined, file: FileChange): Pick<ChangedFile, "edits"> {
  return previous === undefined ? {} : { edits: [...(previous.edits ?? [previous.last]), file] }
}

/**
 * 引擎明确报告成功的编辑。
 *
 * 同一文件按 cwd 归一后只占一行、按首次出现排序；后续别名上报只更新最后一次编辑。
 * 真实净变更随后由 `reconcileChanges` 向 git 核实。
 */
export function reportedChangesOf(items: readonly Item[], cwd: string, keepEdits = false): Changes {
  const files = new Map<string, ChangedFile>()
  for (const item of items) {
    if (item.inherited === true || item.kind !== "tool_call" || item.detail.kind !== "file_edit" || item.status !== "ok")
      continue
    for (const file of item.detail.files) {
      const path = canonicalPath(file.path, cwd)
      // 系统临时目录里的草稿不算「这一轮改了什么」——它们没进你的项目，
      // 下次重启就没了（见 `shared/paths.ts` 的 `isScratch`）。侧栏那张
      // 「这条会话碰过的文件」照旧列它们：那一问问的是「它读写过什么」
      if (path === "" || isScratch(path, cwd)) continue
      // 完整会话的路径清单不复制整段历史；只有按轮读取的改动卡需要逐次记录。
      const previous = keepEdits ? files.get(path) : undefined
      files.set(path, { path, added: file.added, removed: file.removed, last: file,
        ...editHistory(previous, file),
      })
    }
  }
  return tally([...files.values()])
}

function renamedPath(file: ReviewFile, root: string): string | undefined {
  return file.from === undefined || root === "" ? undefined : canonicalPath(file.from, root)
}

function beneath(parent: string, child: string): string | undefined {
  const root = canonicalPath(parent, "").replace(/\/$/, "")
  const path = canonicalPath(child, "")
  if (path === root) return ""
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : undefined
}

/** 把符号链接入口下的上报路径，映射到主进程给出的真实 cwd。 */
function aliasesOf(file: ChangedFile, reportedCwd: string, realCwd: string): ReadonlySet<string> {
  const aliases = new Set([canonicalPath(file.path, "")])
  const raw = normalizePath(file.last.path)
  if (!absolute(raw)) aliases.add(canonicalPath(raw, realCwd))
  else {
    const rel = beneath(reportedCwd, raw)
    if (rel !== undefined) aliases.add(canonicalPath(rel, realCwd))
  }
  return aliases
}

/** 只认精确文件身份（含 cwd 的符号链接映射）；不再用路径后缀猜同名文件。 */
function reviewOf(
  file: ChangedFile,
  current: readonly ReviewFile[],
  paths: { root: string; reportedCwd: string; realCwd: string },
): ReviewFile | undefined {
  const aliases = aliasesOf(file, paths.reportedCwd, paths.realCwd)
  const exact = current.filter((candidate) => {
    const path = canonicalPath(candidate.path, "")
    const from = renamedPath(candidate, paths.root)
    return aliases.has(path) || (from !== undefined && aliases.has(from))
  })
  return exact.length === 1 ? exact[0] : undefined
}

function unverifiedChange(
  file: ChangedFile,
  current: readonly ReviewFile[],
  paths: { root: string; reportedCwd: string; realCwd: string },
  ignored: ReadonlySet<string>,
): ChangedFile | undefined {
  const aliases = aliasesOf(file, paths.reportedCwd, paths.realCwd)
  if (![...aliases].some((path) => ignored.has(path))) return undefined
  const currentFile = reviewOf(file, current, paths)
  const path = canonicalPath(currentFile?.path ?? file.path, "")
  return { ...file, path, unverified: true }
}

/**
 * 用当前 git 清单校正会话变更。
 *
 * - 数字来自“对话开场树 → 当前树”的 Git 差异，不是多轮工具统计相加；
 * - git 清单里已经没有的会话文件说明净改动为零，整行消失；
 * - 先解析到 Git 文件身份再去重，跨引擎路径别名不会重复计算。
 */
export function reconcileChanges(
  reported: Changes,
  current: readonly ReviewFile[],
  root: string,
  cwd?: { reported: string; real: string; ignored?: readonly string[] },
): Changes {
  const paths = { root, reportedCwd: cwd?.reported ?? root, realCwd: cwd?.real ?? cwd?.reported ?? root }
  const ignored = new Set((cwd?.ignored ?? []).map((rel) => canonicalPath(rel, root)))
  const files = new Map<string, ChangedFile>()
  for (const file of reported.list) {
    const blind = unverifiedChange(file, current, paths, ignored)
    if (blind !== undefined) {
      files.set(blind.path, blind)
      continue
    }
    const review = reviewOf(file, current, paths)
    if (review === undefined) continue
    const path = canonicalPath(review.path, "")
    files.set(path, { ...file, path, added: review.added, removed: review.removed, review })
  }
  return tally([...files.values()])
}
