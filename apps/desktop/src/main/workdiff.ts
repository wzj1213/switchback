import { execFile } from "node:child_process"
import { readFile, realpath, stat } from "node:fs/promises"
import { isAbsolute, join, relative } from "node:path"
import { promisify } from "node:util"
import { ipcMain } from "electron"
import {
  isStaged,
  kindOf,
  looksBinary,
  parseNumstat,
  type ReviewFile,
  type ReviewPatch,
} from "../shared/review.js"
import { codesOf } from "./worksite.js"

const run = promisify(execFile)

/**
 * 审核面板的数据源：**问 git，不是回放引擎报的编辑**。
 *
 * ## 为什么必须问 git
 *
 * 引擎报的那份补丁只覆盖它用编辑工具做的改动。它用 shell 写的文件
 *（`sed -i`、`>` 重定向、跑一个生成脚本）、你自己在编辑器里改的、
 * 上一轮留下的——一个都不在里面。而审核这个动作问的是
 *「**我现在要不要提交这些**」，那个「这些」只能是工作区的真实状态。
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

export interface Review {
  /** 仓库根（真实路径）。 */
  root: string
  files: readonly ReviewFile[]
  /** 被截掉了多少个。**不能不说**——「500 个文件」看起来像是全部。 */
  more?: number
}

async function gitRoot(cwd: string): Promise<string | undefined> {
  const top = await run("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: TIMEOUT }).catch(() => undefined)
  if (top === undefined) return undefined
  const raw = top.stdout.trim()
  return realpath(raw).catch(() => raw)
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

export async function workReview(cwd: string): Promise<Review | undefined> {
  const root = await gitRoot(cwd)
  if (root === undefined) return undefined
  // `-uall`：不加的话未跟踪的**目录**会折成一条 `sub/`，界面上看起来像一个文件
  const status = await run("git", ["status", "--porcelain", "-z", "-uall"], { cwd: root, timeout: TIMEOUT }).catch(
    () => undefined,
  )
  if (status === undefined) return { root, files: [] }
  const num = await run("git", ["diff", "HEAD", "--numstat", "-z", "-M"], { cwd: root, timeout: TIMEOUT }).catch(
    () => undefined,
  )
  const stats = parseNumstat(num?.stdout ?? "")
  const all = codesOf(status.stdout)
  const kept = all.slice(0, MAX_FILES)
  const files = await Promise.all(
    kept.map(async (statusEntry) => {
      const entry = entryOf(statusEntry, root, stats)
      if (entry.kind !== "untracked") return entry
      const { added, binary } = await untrackedStat(entry.path)
      return binary ? entry : { ...entry, added }
    }),
  )
  return { root, files, ...(all.length > kept.length ? { more: all.length - kept.length } : {}) }
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

/**
 * 一个文件的补丁。
 *
 * **两条路都试**：跟踪中的走 `git diff HEAD`，未跟踪的 git 眼里根本不存在，
 * 得用 `--no-index` 拿 `/dev/null` 和它比（它的退出码是 1 表示「有差异」，
 * 不是错误，所以那条 catch 要读 stdout 而不是当失败）。
 *
 * `rel` 是渲染层递过来的，所以先钉死在仓库里：`..` 出去的、绝对路径进来的
 * 一律拒。**不是怕注入**（`execFile` 不过 shell，`--` 也隔开了选项），
 * 是不想让一个界面 bug 变成「把仓库外的任意文件读出来」。
 */
export async function workPatch(cwd: string, rel: string, context = 3): Promise<ReviewPatch> {
  const root = await gitRoot(cwd)
  if (root === undefined || rel === "" || isAbsolute(rel)) return { patch: "", skip: "gone", added: 0, removed: 0 }
  const abs = join(root, rel)
  const inside = relative(root, abs)
  if (inside.startsWith("..")) return { patch: "", skip: "gone", added: 0, removed: 0 }
  // 上下文行数由界面给：默认 3 行，「展开」时给一个大数——这比自己去读原文件
  // 再拼上下文可靠得多，git 知道每个 hunk 真正的行号
  const unified = `--unified=${String(Math.max(0, Math.min(context, 99_999)))}`
  const tracked = await run("git", ["diff", "HEAD", "-M", "--no-color", unified, "--", rel], {
    cwd: root,
    timeout: TIMEOUT,
    maxBuffer: BIG * 4,
  }).catch(() => undefined)
  if (tracked !== undefined && tracked.stdout !== "") return shaped(tracked.stdout)
  // **空补丁不等于「未跟踪」。** 一个跟踪中、但此刻和 HEAD 没差别的文件
  //（清单取回来之后你在编辑器里改回去了）走到下面那条会得到一份
  // 「整个文件都是新增的」补丁——那是**看起来完全可信的错误答案**，
  // 比报错糟得多。所以先问一句 git：它到底认不认识这个文件
  const known = await run("git", ["ls-files", "--error-unmatch", "--", rel], { cwd: root, timeout: TIMEOUT }).catch(
    () => undefined,
  )
  if (known !== undefined) return { patch: "", added: 0, removed: 0 }
  const fresh = await run("git", ["diff", "--no-index", "--no-color", unified, "--", "/dev/null", rel], {
    cwd: root,
    timeout: TIMEOUT,
    maxBuffer: BIG * 4,
  }).catch((error: unknown) => error as { stdout?: string })
  return shaped(fresh.stdout ?? "")
}

export function installReviewChannel(): void {
  ipcMain.handle("omni:workReview", async (_e, cwd: string) =>
    typeof cwd === "string" && cwd !== "" ? workReview(cwd) : undefined,
  )
  ipcMain.handle("omni:workPatch", async (_e, req: { cwd: string; rel: string; context?: number }) =>
    typeof req.cwd === "string" && typeof req.rel === "string"
      ? workPatch(req.cwd, req.rel, typeof req.context === "number" ? req.context : 3)
      : { patch: "", skip: "gone" as const, added: 0, removed: 0 },
  )
}
