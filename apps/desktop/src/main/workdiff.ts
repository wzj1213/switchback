import { execFile } from "node:child_process"
import { readFile, realpath, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"
import {
  isStaged,
  kindOf,
  looksBinary,
  parseNumstat,
  type ReviewFile,
  type ReviewPatch,
  type ReviewScope,
} from "../shared/review.js"
import { codesOf } from "./worksite.js"
import type { WorktreeBaselines } from "./worktree-baseline.js"
import { scopedPatchText, scopedReview } from "./workdiff-scopes.js"
import { spreadReview } from "./workdiff-multi.js"
import { repoForRel } from "./workdiff-multi.js"

const run = promisify(execFile)

/**
 * 审核面板的数据源：**问 git，不是回放引擎报的编辑**。
 *
 * ## 为什么必须问 git
 *
 * 引擎报的那份补丁只覆盖它用编辑工具做的改动。它用 shell 写的文件
 *（`sed -i`、`>` 重定向、跑一个生成脚本）、你自己在编辑器里改的——
 * 一个都不在里面。而审核问的是「**这次对话最终留下了什么**」，只能比较
 * 对话开场工作树与当前工作树；没有 thread 基线的旧入口才退回 HEAD。
 *
 * 顺带解决一个老问题：引擎报 `add`/`delete` 时递的是**文件全文**，不带前缀
 *（见 `renderer/diff.ts`）。git 给的永远是真正的 unified diff，新建文件也带
 * `@@` 头和 `+` 前缀——所以审核面板一律按 `"update"` 解析，不用分情况。
 *
 * ## 补丁是**按需取**的
 *
 * 列表一次问清（两条 git 命令），正文点开哪个取哪个。一个 200 文件的改动
 * 全量取补丁可能是几十 MB，而人一次只看得了一个。
 */

const TIMEOUT = 5000
/** 单份补丁的上限。超了不给正文——浏览器渲染几 MB 的 diff 会当场卡住。 */
const BIG = 400_000
/** 未跟踪文件读多大算数。再大就只报「有这么个新文件」。 */
const READ_CAP = 1_000_000
/** 列表上限。真到这个量级，人要的是别的工具。 */
const MAX_FILES = 500
const LITERAL_PATHS = { ...process.env, GIT_LITERAL_PATHSPECS: "1" }

export interface Review {
  /** 仓库根（真实路径）。 */
  root: string
  /** 会话工作目录（真实路径）；符号链接入口靠它映射回同一个仓库身份。 */
  cwd: string
  files: readonly ReviewFile[]
  /** 被截掉了多少个。**不能不说**——「500 个文件」看起来像是全部。 */
  more?: number
  /** Git ignore 规则让基线无法核实的、由引擎明确报告的相对路径。 */
  ignored?: readonly string[]
  /** 这份差异以对话开场工作树为基线，而不是 HEAD。 */
  baseline?: true
  /**
   * 这张清单是**跨几个仓库并起来的**（工作区自己不是仓库）。
   * 界面据此说清「这几个数各自相对它自己那个仓库的 HEAD」。
   */
  spread?: true
  /** Git 临时读失败；空清单此时绝不等于“没有改动”。 */
  failed?: true
  /** 旧会话没有逐轮快照；不能拿会话开场或 HEAD 冒充“上一轮”。 */
  turnMissing?: true
  scope?: ReviewScope
}

interface Repo {
  root: string
  cwd: string
}

async function repoOf(cwd: string): Promise<Repo | undefined> {
  const top = await run("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: TIMEOUT }).catch(() => undefined)
  if (top === undefined) return undefined
  const raw = top.stdout.trim()
  const [root, actualCwd] = await Promise.all([
    realpath(raw).catch(() => raw),
    realpath(cwd).catch(() => resolve(cwd)),
  ])
  return { root, cwd: actualCwd }
}

function inside(root: string, path: string): string | undefined {
  const rel = relative(root, path)
  return rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)
    ? undefined
    : rel
}

function tmpAlias(path: string): string {
  if (path === "/tmp") return "/private/tmp"
  return path.startsWith("/tmp/") ? `/private${path}` : path
}

function wantedRel(path: string, requestedCwd: string, repo: Repo): string | undefined {
  if (!isAbsolute(path)) return inside(repo.root, resolve(repo.cwd, path))
  const direct = inside(repo.root, tmpAlias(resolve(path)))
  if (direct !== undefined) return direct
  const lexical = inside(tmpAlias(resolve(requestedCwd)), tmpAlias(resolve(path)))
  return lexical === undefined ? undefined : inside(repo.root, resolve(repo.cwd, lexical))
}

function selected<T extends { rel: string; from?: string }>(
  all: readonly T[],
  wanted: ReadonlySet<string>,
): readonly T[] {
  const first = all.slice(0, MAX_FILES)
  const seen = new Set(first.map((entry) => entry.rel))
  return [
    ...first,
    ...all.filter(
      (entry) => !seen.has(entry.rel) &&
        (wanted.has(entry.rel) || (entry.from !== undefined && wanted.has(entry.from))),
    ),
  ]
}

async function baseTree(root: string): Promise<string | undefined> {
  const head = await run("git", ["rev-parse", "--verify", "HEAD^{tree}"], {
    cwd: root,
    timeout: TIMEOUT,
  }).catch(() => undefined)
  if (head !== undefined) return head.stdout.trim()
  const empty = await run("git", ["hash-object", "-t", "tree", "/dev/null"], {
    cwd: root,
    timeout: TIMEOUT,
  }).catch(() => undefined)
  return empty?.stdout.trim()
}

/** 未跟踪文件的增删数：读一遍数行。读不动（太大 / 二进制 / 没权限）就报 0。 */
async function untrackedStat(abs: string): Promise<{ added: number; binary: boolean }> {
  const size = await stat(abs).then((s) => s.size).catch(() => -1)
  if (size < 0 || size > READ_CAP) return { added: 0, binary: false }
  const buf = await readFile(abs).catch(() => undefined)
  if (buf === undefined) return { added: 0, binary: false }
  if (looksBinary(buf)) return { added: 0, binary: true }
  const text = buf.toString("utf8")
  return { added: text === "" ? 0 : text.replace(/\n$/, "").split("\n").length, binary: false }
}

/**
 * `git status` 的一行 → 列表里的一条。
 *
 * 状态码里带着两件界面要用的事：**这个文件发生了什么**（新建/删除/改名/修改），
 * 以及**改动进没进暂存区**。后者不显示的话，审核面板会和 `git diff` 一样
 * 漏掉已暂存的那些，而那正是「马上要提交的东西」。
 */
function entryOf(
  status: { code: string; rel: string; from?: string },
  root: string,
  stats: ReturnType<typeof parseNumstat>,
): ReviewFile {
  const { code, rel, from } = status
  const kind = kindOf(code)
  const n = stats.get(rel)
  return {
    path: join(root, rel),
    rel,
    kind,
    added: n?.added ?? 0,
    removed: n?.removed ?? 0,
    ...(from === undefined ? {} : { from }),
    ...(isStaged(code) ? { staged: true } : {}),
  }
}

export interface ReviewSource {
  baselines?: WorktreeBaselines
  threadId?: string
  wanted?: readonly string[]
  scope?: ReviewScope
}

async function baselineReview(cwd: string, source: ReviewSource, turn = false): Promise<Review | undefined> {
  if (source.baselines === undefined || source.threadId === undefined) return undefined
  return source.baselines.review(source.threadId, cwd, source.wanted, turn)
}

async function reviewForScope(
  cwd: string,
  source: ReviewSource,
): Promise<{ handled: boolean; review?: Review }> {
  const scope = source.scope
  if (scope === undefined || scope === "uncommitted") return { handled: false }
  if (scope !== "last-turn") {
    const review = await scopedReview(cwd, scope)
    return review === undefined ? { handled: true } : { handled: true, review }
  }
  const turn = await baselineReview(cwd, source, true).catch(() => undefined)
  if (turn !== undefined) return { handled: true, review: { ...turn, scope } }
  const repo = await repoOf(cwd)
  return repo === undefined
    ? { handled: true }
    : { handled: true, review: { ...repo, files: [], baseline: true, turnMissing: true } }
}

async function conversationBaseline(
  cwd: string,
  source: ReviewSource,
): Promise<{ handled: boolean; review?: Review }> {
  if (source.scope === "uncommitted") return { handled: false }
  try {
    const review = await baselineReview(cwd, source)
    return review === undefined ? { handled: false } : { handled: true, review }
  } catch {
    const repo = await repoOf(cwd)
    return repo === undefined
      ? { handled: true }
      : { handled: true, review: { ...repo, files: [], baseline: true, failed: true } }
  }
}

export async function workReview(cwd: string, source: ReviewSource = {}): Promise<Review | undefined> {
  const requested = await reviewForScope(cwd, source)
  if (requested.handled) return requested.review
  const baseline = await conversationBaseline(cwd, source)
  if (baseline.handled) return baseline.review
  const repo = await repoOf(cwd)
  // 工作区自己不是仓库，但底下挂着几个——按文件所属的仓库分头问（见 `workdiff-multi.ts`）
  if (repo === undefined) return spreadReview(cwd, source, workReview)
  // `-uall`：不加的话未跟踪的**目录**会折成一条 `sub/`，界面上看起来像一个文件
  const status = await run("git", ["status", "--porcelain", "-z", "-uall"], { cwd: repo.root, timeout: TIMEOUT }).catch(
    () => undefined,
  )
  const base = await baseTree(repo.root)
  if (status === undefined || base === undefined) return { ...repo, files: [], failed: true }
  const num = await run("git", ["diff", base, "--numstat", "-z", "-M"], { cwd: repo.root, timeout: TIMEOUT }).catch(
    () => undefined,
  )
  if (num === undefined) return { ...repo, files: [], failed: true }
  const stats = parseNumstat(num.stdout)
  const all = codesOf(status.stdout)
  const wanted = new Set(
    (source.wanted ?? [])
      .map((path) => wantedRel(path, cwd, repo))
      .filter((rel): rel is string => rel !== undefined),
  )
  const kept = selected(all, wanted)
  const files = await Promise.all(
    kept.map(async (statusEntry) => {
      const entry = entryOf(statusEntry, repo.root, stats)
      if (entry.kind !== "untracked") return entry
      const { added, binary } = await untrackedStat(entry.path)
      return binary ? entry : { ...entry, added }
    }),
  )
  return { ...repo, files, ...(all.length > kept.length ? { more: all.length - kept.length } : {}) }
}

/** 数一份补丁的增删。`+++`/`---` 是文件头，算进去每份补丁都会凭空多一红一绿。 */
function tallyPatch(patch: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue
    if (line.startsWith("+")) added += 1
    else if (line.startsWith("-")) removed += 1
  }
  return { added, removed }
}

function shaped(patch: string): ReviewPatch {
  if (patch.length > BIG) return { patch: "", skip: "large", added: 0, removed: 0 }
  if (patch.includes("GIT binary patch") || /^Binary files .* differ$/m.test(patch)) {
    return { patch: "", skip: "binary", added: 0, removed: 0 }
  }
  return { patch, ...tallyPatch(patch) }
}

const GONE: ReviewPatch = { patch: "", skip: "gone", added: 0, removed: 0 }
const FAILED: ReviewPatch = { patch: "", skip: "failed", added: 0, removed: 0 }

function safeRel(repo: Repo, rel: string): boolean {
  if (rel === "" || isAbsolute(rel)) return false
  const path = relative(repo.root, join(repo.root, rel))
  return path !== ".." && !path.startsWith(`..${sep}`)
}

async function baselinePatch(
  cwd: string,
  rel: string,
  options: { context: number; source: ReviewSource; turn?: boolean },
): Promise<ReviewPatch | undefined> {
  const { context, source, turn = false } = options
  if (source.baselines === undefined || source.threadId === undefined) return undefined
  try {
    const patch = await source.baselines.patch(source.threadId, cwd, rel, { context, turn })
    return patch === undefined ? undefined : shaped(patch)
  } catch {
    return FAILED
  }
}

function renameFrom(raw: string, rel: string): string | undefined {
  const parts = raw.split("\0")
  for (let index = 0; index < parts.length; index += 1) {
    const mark = parts[index] ?? ""
    if (!mark.startsWith("R") && !mark.startsWith("C")) continue
    if (parts[index + 2] === rel) return parts[index + 1]
    index += 2
  }
  return undefined
}

async function legacyPatch(repo: Repo, rel: string, unified: string): Promise<ReviewPatch> {
  const base = await baseTree(repo.root)
  if (base === undefined) return FAILED
  const names = await run("git", ["diff", base, "-M", "--name-status", "-z"], {
    cwd: repo.root,
    timeout: TIMEOUT,
    maxBuffer: BIG * 4,
  }).catch(() => undefined)
  const from = renameFrom(names?.stdout ?? "", rel)
  const paths = from === undefined ? [rel] : [from, rel]
  const tracked = await run("git", ["diff", base, "-M", "--no-color", unified, "--", ...paths], {
    cwd: repo.root,
    env: LITERAL_PATHS,
    timeout: TIMEOUT,
    maxBuffer: BIG * 4,
  }).catch(() => undefined)
  if (tracked !== undefined && tracked.stdout !== "") return shaped(tracked.stdout)
  const known = await run("git", ["ls-files", "--error-unmatch", "--", rel], {
    cwd: repo.root,
    env: LITERAL_PATHS,
    timeout: TIMEOUT,
  }).catch(() => undefined)
  if (known !== undefined) return { patch: "", added: 0, removed: 0 }
  const fresh = await run(
    "git",
    ["diff", "--no-index", "--no-color", unified, "--", "/dev/null", rel],
    { cwd: repo.root, timeout: TIMEOUT, maxBuffer: BIG * 4 },
  ).catch((error: unknown) => error as { stdout?: string })
  return shaped(fresh.stdout ?? "")
}

/**
 * 一个文件的补丁。
 *
 * 有对话基线时直接比较两个 tree；旧入口则让跟踪中的走 `git diff <base>`，
 * 未跟踪的文件在 git 眼里根本不存在，
 * 得用 `--no-index` 拿 `/dev/null` 和它比（它的退出码是 1 表示「有差异」，
 * 不是错误，所以那条 catch 要读 stdout 而不是当失败）。
 *
 * `rel` 是渲染层递过来的，所以先钉死在仓库里：`..` 出去的、绝对路径进来的
 * 一律拒。**不是怕注入**（`execFile` 不过 shell，`--` 也隔开了选项），
 * 是不想让一个界面 bug 变成「把仓库外的任意文件读出来」。
 */
export async function workPatch(
  cwd: string,
  rel: string,
  context = 3,
  source: ReviewSource = {},
): Promise<ReviewPatch> {
  const repo = await repoOf(cwd)
  if (repo === undefined) {
    // 跨仓库那一档：`rel` 是相对总目录的，先找到它自己那个仓库（见 `workdiff-multi.ts`）
    const owner = await repoForRel(cwd, rel)
    return owner === undefined ? GONE : workPatch(owner.root, owner.rel, context, { ...source, wanted: undefined })
  }
  if (!safeRel(repo, rel)) return GONE
  // 上下文行数由界面给：默认 3 行，「展开」时给一个大数——这比自己去读原文件
  // 再拼上下文可靠得多，git 知道每个 hunk 真正的行号
  const unified = `--unified=${String(Math.max(0, Math.min(context, 99_999)))}`
  if (source.scope !== undefined && source.scope !== "last-turn" && source.scope !== "uncommitted") {
    const patch = await scopedPatchText(cwd, rel, context, source.scope)
    return patch === undefined ? FAILED : shaped(patch)
  }
  const fromBaseline = source.scope === "uncommitted"
    ? undefined
    : await baselinePatch(cwd, rel, { context, source, turn: source.scope === "last-turn" })
  if (fromBaseline !== undefined) return fromBaseline
  // **空补丁不等于「未跟踪」。** 一个跟踪中、但此刻和 HEAD 没差别的文件
  //（清单取回来之后你在编辑器里改回去了）走到下面那条会得到一份
  // 「整个文件都是新增的」补丁——那是**看起来完全可信的错误答案**，
  // 比报错糟得多。所以先问一句 git：它到底认不认识这个文件
  return legacyPatch(repo, rel, unified)
}
