import { execFile } from "node:child_process"
import { readFile, realpath, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { looksBinary, parseNumstat, type ReviewFile, type ReviewScope } from "../shared/review.js"
import type { Review } from "./workdiff.js"

const run = promisify(execFile)
const TIMEOUT = 5000
const MAX_FILES = 500
const READ_CAP = 1_000_000
const ENV = { ...process.env, GIT_LITERAL_PATHSPECS: "1" }

interface Repo { root: string; cwd: string }
interface DiffSpec { args: readonly string[]; untracked: boolean; staged: boolean }
interface NameEntry { mark: string; rel: string; from?: string }

async function repoOf(cwd: string): Promise<Repo | undefined> {
  const top = await run("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: TIMEOUT }).catch(() => undefined)
  if (top === undefined) return undefined
  const root = await realpath(top.stdout.trim()).catch(() => top.stdout.trim())
  const actual = await realpath(cwd).catch(() => resolve(cwd))
  return { root, cwd: actual }
}

async function revision(root: string, ref: string): Promise<string | undefined> {
  const out = await run("git", ["rev-parse", "--verify", ref], { cwd: root, timeout: TIMEOUT }).catch(() => undefined)
  return out?.stdout.trim()
}

async function emptyTree(root: string): Promise<string | undefined> {
  const out = await run("git", ["hash-object", "-t", "tree", "/dev/null"], {
    cwd: root, timeout: TIMEOUT,
  }).catch(() => undefined)
  return out?.stdout.trim()
}

async function branchBase(root: string): Promise<string | undefined> {
  const refs = ["@{upstream}", "refs/remotes/origin/main", "refs/remotes/origin/master", "main", "master"]
  for (const ref of refs) {
    if ((await revision(root, ref)) === undefined) continue
    const out = await run("git", ["merge-base", "HEAD", ref], { cwd: root, timeout: TIMEOUT }).catch(() => undefined)
    if (out !== undefined) return out.stdout.trim()
  }
  return undefined
}

async function specOf(root: string, scope: ReviewScope): Promise<DiffSpec | undefined> {
  if (scope === "unstaged") return { args: [], untracked: true, staged: false }
  if (scope === "staged") return { args: ["--cached"], untracked: false, staged: true }
  if (scope === "last-commit") {
    const head = await revision(root, "HEAD")
    const base = await revision(root, "HEAD^") ?? await emptyTree(root)
    return head === undefined || base === undefined
      ? undefined
      : { args: [base, head], untracked: false, staged: false }
  }
  if (scope === "branch") {
    const base = await branchBase(root)
    return base === undefined ? undefined : { args: [base], untracked: false, staged: false }
  }
  return undefined
}

function namesOf(raw: string): readonly NameEntry[] {
  const parts = raw.split("\0")
  const entries: NameEntry[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const mark = parts[index]
    if (mark === undefined || mark === "") continue
    if (mark.startsWith("R") || mark.startsWith("C")) {
      const from = parts[index + 1], rel = parts[index + 2]
      if (from !== undefined && rel !== undefined) entries.push({ mark, from, rel })
      index += 2
      continue
    }
    const rel = parts[index + 1]
    if (rel !== undefined) entries.push({ mark, rel })
    index += 1
  }
  return entries
}

async function untracked(root: string): Promise<readonly NameEntry[]> {
  const out = await run("git", ["status", "--porcelain", "-z", "-uall"], {
    cwd: root, timeout: TIMEOUT,
  }).catch(() => undefined)
  if (out === undefined) return []
  const parts = out.stdout.split("\0")
  return parts.flatMap((part) => part.startsWith("?? ") ? [{ mark: "?", rel: part.slice(3) }] : [])
}

async function freshLines(path: string): Promise<number> {
  const size = await stat(path).then((out) => out.size).catch(() => -1)
  if (size < 0 || size > READ_CAP) return 0
  const data = await readFile(path).catch(() => undefined)
  if (data === undefined || looksBinary(data)) return 0
  const text = data.toString("utf8")
  return text === "" ? 0 : text.replace(/\n$/, "").split("\n").length
}

function kindOf(mark: string): ReviewFile["kind"] {
  if (mark.startsWith("?")) return "untracked"
  if (mark.startsWith("A")) return "add"
  if (mark.startsWith("D")) return "delete"
  if (mark.startsWith("R") || mark.startsWith("C")) return "rename"
  return "update"
}

export async function scopedReview(cwd: string, scope: ReviewScope): Promise<Review | undefined> {
  const repo = await repoOf(cwd)
  if (repo === undefined) return undefined
  const spec = await specOf(repo.root, scope)
  if (spec === undefined) return { ...repo, files: [], failed: true }
  const base = ["diff", "-M", ...spec.args]
  const [names, nums, fresh] = await Promise.all([
    run("git", [...base, "--name-status", "-z"], { cwd: repo.root, timeout: TIMEOUT }).catch(() => undefined),
    run("git", [...base, "--numstat", "-z"], { cwd: repo.root, timeout: TIMEOUT }).catch(() => undefined),
    spec.untracked ? untracked(repo.root) : Promise.resolve([]),
  ])
  if (names === undefined || nums === undefined) return { ...repo, files: [], failed: true }
  const entries = [...namesOf(names.stdout), ...fresh]
  const kept = entries.slice(0, MAX_FILES)
  const stats = parseNumstat(nums.stdout)
  const files = await Promise.all(kept.map(async (entry): Promise<ReviewFile> => {
    const count = entry.mark === "?" ? await freshLines(join(repo.root, entry.rel)) : 0
    const tally = stats.get(entry.rel)
    return {
      path: join(repo.root, entry.rel), rel: entry.rel, kind: kindOf(entry.mark),
      added: tally?.added ?? count, removed: tally?.removed ?? 0,
      ...(entry.from === undefined ? {} : { from: entry.from }),
      ...(spec.staged ? { staged: true } : {}),
    }
  }))
  return { ...repo, files, scope, ...(entries.length > kept.length ? { more: entries.length - kept.length } : {}) }
}

async function freshPatch(repo: Repo, rel: string, unified: string): Promise<string> {
  const known = await run("git", ["ls-files", "--error-unmatch", "--", rel], {
    cwd: repo.root, env: ENV, timeout: TIMEOUT,
  }).catch(() => undefined)
  if (known !== undefined) return ""
  const added = await run("git", ["diff", "--no-index", "--no-color", unified, "--", "/dev/null", rel], {
    cwd: repo.root, env: ENV, timeout: TIMEOUT, maxBuffer: 1_600_000,
  }).catch((error: unknown) => error as { stdout?: string })
  return added.stdout ?? ""
}

export async function scopedPatchText(
  cwd: string,
  rel: string,
  context: number,
  scope: ReviewScope,
): Promise<string | undefined> {
  const repo = await repoOf(cwd)
  if (repo === undefined || rel === "" || rel.startsWith("../") || rel.startsWith("/")) return undefined
  const spec = await specOf(repo.root, scope)
  if (spec === undefined) return undefined
  const unified = `--unified=${String(Math.max(0, Math.min(context, 99_999)))}`
  const out = await run("git", ["diff", "-M", "--no-color", unified, ...spec.args, "--", rel], {
    cwd: repo.root, env: ENV, timeout: TIMEOUT, maxBuffer: 1_600_000,
  }).catch(() => undefined)
  if (out?.stdout !== "" && out !== undefined) return out.stdout
  if (!spec.untracked) return out?.stdout
  return freshPatch(repo, rel, unified)
}
