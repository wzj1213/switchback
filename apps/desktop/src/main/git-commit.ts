import { execFile } from "node:child_process"
import { realpath } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import type { CommitResult, GitState } from "../shared/git.js"

/**
 * 审查页底下那条「提交」：暂存、取消暂存、提交。**只做这三件本地、可撤回的事**。
 *
 * ## 为什么是 omni 自己做，而不是让引擎去提交
 *
 * 提交是人对自己仓库的动作，和哪家引擎无关——审核面板本来就是 omni 的（见 `workdiff.ts`），
 * 看完改动顺手提交是这块面板缺的最后一步。让引擎代提交要往它上下文里塞话，那条路不走。
 *
 * ## 刻意不做的
 *
 * - **不推送、不拉取。** 那要联网、要凭证（git 会去问钥匙串），也会动到别人看得见的东西；
 *   人要推的时候，终端里那一行比 omni 再造一个按钮可靠。
 * - **不丢弃改动。** `git restore` 丢掉的东西找不回来，而一颗手滑的按钮就够了。
 * - **不跳过钩子。** `pre-commit` 是仓库自己的规矩，照常跑；跑挂了原文摆出来。
 */

const STATUS_MS = 8000
const ADD_MS = 60_000
/** 提交可能要等 pre-commit 钩子（lint、测试）。给足，但得有个头。 */
const COMMIT_MS = 180_000
const OUTPUT_KEEP = 4000

export type GitRun = (args: readonly string[], cwd: string, timeoutMs: number) => Promise<{ ok: boolean; stdout: string; stderr: string }>

/**
 * 真跑 git。**路径一律按字面**（`GIT_LITERAL_PATHSPECS`）：文件名里的 `*`、`:(top)` 不能被当成通配。
 * 编辑器与终端询问一律关掉——这里没有终端，等一个永远不会来的输入就是卡死。
 */
export const runGit: GitRun = (args, cwd, timeoutMs) =>
  new Promise((done) => {
    execFile("git", [...args], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 8_000_000,
      encoding: "utf8",
      env: { ...process.env, GIT_LITERAL_PATHSPECS: "1", GIT_EDITOR: "true", GIT_TERMINAL_PROMPT: "0" },
    }, (error, stdout, stderr) => {
      done({ ok: error === null, stdout, stderr: stderr === "" && error !== null ? error.message : stderr })
    })
  })

type Counts = Pick<GitState, "staged" | "unstaged" | "untracked" | "conflicted">

function countEntry(counts: Counts, entry: string): void {
  if (entry.startsWith("? ")) counts.untracked += 1
  else if (entry.startsWith("u ")) counts.conflicted += 1
  else if (entry.startsWith("1 ") || entry.startsWith("2 ")) {
    const xy = entry.slice(2, 4)
    if (xy[0] !== ".") counts.staged += 1
    if (xy[1] !== ".") counts.unstaged += 1
  }
}

function branchLine(state: Partial<GitState>, line: string): void {
  const [, key, ...rest] = line.split(" ")
  const value = rest.join(" ")
  if (key === "branch.head") {
    if (value === "(detached)") state.detached = true
    else state.branch = value
  } else if (key === "branch.upstream") state.upstream = value
  else if (key === "branch.ab") {
    const match = /^\+(\d+) -(\d+)$/u.exec(value)
    if (match !== null) {
      state.ahead = Number(match[1])
      state.behind = Number(match[2])
    }
  }
}

/**
 * `git status --porcelain=v2 --branch -z` → 分支与各类计数。
 *
 * 改名那一类（`2 …`）在 `-z` 下把旧名作为**单独一段**跟在后面，不跳过就会被当成一条认不出的记录——
 * 这里靠「上一段是 2 开头」跳过它。一个文件可以同时有已暂存与未暂存的改动（`MM`），两边各算一次。
 */
export function parseStatus(raw: string): Omit<GitState, "repo" | "root"> {
  const state: Partial<GitState> = {}
  const counts: Counts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }
  const parts = raw.split("\0")
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index] ?? ""
    if (entry.startsWith("# ")) branchLine(state, entry)
    else countEntry(counts, entry)
    if (entry.startsWith("2 ")) index += 1
  }
  return { ...state, ...counts }
}

async function rootOf(cwd: string, run: GitRun): Promise<string | undefined> {
  const top = await run(["rev-parse", "--show-toplevel"], cwd, STATUS_MS)
  if (!top.ok) return undefined
  const raw = top.stdout.trim()
  return realpath(raw).catch(() => raw)
}

export async function gitState(cwd: string, run: GitRun = runGit): Promise<GitState> {
  const root = await rootOf(cwd, run)
  const empty = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }
  if (root === undefined) return { repo: false, ...empty }
  const status = await run(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], root, STATUS_MS)
  if (!status.ok) return { repo: true, root, failed: true, ...empty }
  return { repo: true, root, ...parseStatus(status.stdout) }
}

function tail(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}\n${result.stderr}`.trim().slice(-OUTPUT_KEEP)
}

/**
 * 提交。`all` 是「连同没暂存的、新文件一起」（`git add -A`，范围是整个仓库——
 * 和审核面板「未提交」那一档看到的是同一份）。
 */
export async function gitCommit(
  cwd: string,
  req: { message: string; all: boolean },
  run: GitRun = runGit,
): Promise<CommitResult> {
  const message = req.message.trim()
  if (message === "") return { ok: false, error: "提交说明是空的。" }
  const root = await rootOf(cwd, run)
  if (root === undefined) return { ok: false, error: "这个工作区不在 Git 仓库里。" }
  if (req.all) {
    const added = await run(["add", "-A"], root, ADD_MS)
    if (!added.ok) return { ok: false, error: "git add 没成功。", output: tail(added) }
  }
  // `diff --cached --quiet`：有已暂存的改动时退出码是 1
  const pending = await run(["diff", "--cached", "--quiet"], root, STATUS_MS)
  if (pending.ok) return { ok: false, error: req.all ? "没有可提交的改动。" : "暂存区是空的：先暂存要提交的文件，或者选「全部提交」。" }
  const committed = await run(["commit", "-m", message], root, COMMIT_MS)
  if (!committed.ok) return { ok: false, error: "git commit 没成功（钩子或签名的原文在下面）。", output: tail(committed) }
  const head = await run(["rev-parse", "HEAD"], root, STATUS_MS)
  const full = head.stdout.trim()
  return { ok: true, sha: full.slice(0, 7), full, subject: message.split("\n")[0] ?? message }
}

/**
 * 撤销刚才那次提交：`reset --soft`，改动原样回到暂存区，工作区一个字节不动。
 *
 * **只撤「HEAD 仍是它」的那一次**：之后引擎或人又提交过、切过分支，HEAD 就不是它了，
 * 那时去 reset 会连别人的提交一起退掉。已经出现在任何远程分支里的（被推过了）也不撤——
 * 本地退回去只会和远程分叉。仓库的第一个提交没有父提交，改用删掉分支引用（暂存区照旧保留）。
 */
export async function gitUndo(cwd: string, req: { full: string }, run: GitRun = runGit): Promise<CommitResult> {
  const root = await rootOf(cwd, run)
  if (root === undefined) return { ok: false, error: "这个工作区不在 Git 仓库里。" }
  const head = await run(["rev-parse", "HEAD"], root, STATUS_MS)
  if (!head.ok || head.stdout.trim() !== req.full) {
    return { ok: false, error: "HEAD 已经不是那次提交了（之后又提交过或切过分支），没法安全撤销。" }
  }
  const remote = await run(["branch", "-r", "--contains", req.full], root, STATUS_MS)
  if (remote.ok && remote.stdout.trim() !== "") return { ok: false, error: `这次提交已经在 ${remote.stdout.trim().split("\n")[0]?.trim() ?? "远程"} 里了，本地撤销会和远程分叉。` }
  const parent = (await run(["rev-parse", "--verify", "-q", "HEAD~1"], root, STATUS_MS)).ok
  const undo = parent ? await run(["reset", "--soft", "HEAD~1"], root, ADD_MS) : await run(["update-ref", "-d", "HEAD"], root, ADD_MS)
  return undo.ok ? { ok: true, undone: true } : { ok: false, error: "撤销没成功。", output: tail(undo) }
}

/** 相对仓库根、而且确实在仓库里面的路径才收。 */
function relIn(root: string, rel: string): string | undefined {
  if (rel === "" || isAbsolute(rel)) return undefined
  const back = relative(root, resolve(root, rel))
  return back === "" || back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back) ? undefined : back
}

/**
 * 暂存 / 取消暂存一个文件。取消暂存在还没有任何提交的仓库里没有 HEAD 可退，
 * 那时改用 `rm --cached`（只动暂存区，工作区里的文件一字不动）。
 */
export async function gitStage(
  cwd: string,
  req: { rel: string; stage: boolean },
  run: GitRun = runGit,
): Promise<CommitResult> {
  const root = await rootOf(cwd, run)
  if (root === undefined) return { ok: false, error: "这个工作区不在 Git 仓库里。" }
  const rel = relIn(root, req.rel)
  if (rel === undefined) return { ok: false, error: "这个路径不在仓库里。" }
  if (req.stage) {
    const added = await run(["add", "-A", "--", rel], root, ADD_MS)
    return added.ok ? { ok: true } : { ok: false, error: "git add 没成功。", output: tail(added) }
  }
  const hasHead = (await run(["rev-parse", "--verify", "-q", "HEAD"], root, STATUS_MS)).ok
  const args = hasHead ? ["restore", "--staged", "--", rel] : ["rm", "--cached", "-q", "--", rel]
  const undone = await run(args, root, ADD_MS)
  return undone.ok ? { ok: true } : { ok: false, error: "取消暂存没成功。", output: tail(undone) }
}
