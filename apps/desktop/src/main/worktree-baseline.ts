import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path"
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import { isStaged, parseNumstat, type ReviewFile } from "../shared/review.js"
import { ignoredOutsideTree } from "./git-ignore.js"
import { treePatch } from "./worktree-patch.js"
import { stageInfo, type TreeSnapshot } from "./worktree-stage.js"

const exec = promisify(execFile)
const TIMEOUT = 10_000
const MAX_FILES = 500
const LIST_BUFFER = 16_000_000
const META = "baseline.json"

interface RepoInfo {
  root: string
  cwd: string
  objects: string
}

interface BaselineMeta {
  version: 1
  root: string
  cwd: string
  tree: string
}

interface NameEntry {
  mark: string
  rel: string
  from?: string
}

interface BaselineAccess {
  dir: string
  meta: BaselineMeta
  repo: RepoInfo
}

export interface BaselineReview {
  root: string
  cwd: string
  files: readonly ReviewFile[]
  more?: number
  /** 引擎明确报告、但被 Git ignore 规则排除，无法从两棵树核实的相对路径。 */
  ignored?: readonly string[]
  baseline: true
}

export interface WorktreeBaselines {
  ensure: (threadId: string, cwd: string) => Promise<void>
  remove: (threadId: string) => Promise<void>
  review: (threadId: string, cwd: string, wanted?: readonly string[]) => Promise<BaselineReview | undefined>
  patch: (threadId: string, cwd: string, rel: string, context: number) => Promise<string | undefined>
}

function keyOf(threadId: string): string {
  return createHash("sha256").update(threadId).digest("hex")
}

async function git(
  cwd: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
  maxBuffer = 4_000_000,
): Promise<string> {
  const out = await exec("git", [...args], { cwd, env, timeout: TIMEOUT, maxBuffer })
  return out.stdout
}

async function repoOf(cwd: string): Promise<RepoInfo | undefined> {
  const top = await git(cwd, ["rev-parse", "--show-toplevel"]).catch(() => undefined)
  const common = await git(cwd, ["rev-parse", "--git-common-dir"]).catch(() => undefined)
  if (top === undefined || common === undefined) return undefined
  const rootRaw = top.trim()
  const commonRaw = common.trim()
  const root = await realpath(rootRaw).catch(() => rootRaw)
  const actualCwd = await realpath(cwd).catch(() => resolve(cwd))
  const commonDir = isAbsolute(commonRaw) ? commonRaw : resolve(cwd, commonRaw)
  const objectsRaw = join(commonDir, "objects")
  const objects = await realpath(objectsRaw).catch(() => objectsRaw)
  return { root, cwd: actualCwd, objects }
}

function treeEnv(index: string, objects: string, alternates: readonly string[]): NodeJS.ProcessEnv {
  const inherited = process.env["GIT_ALTERNATE_OBJECT_DIRECTORIES"]
  const all = [...alternates, ...(inherited === undefined || inherited === "" ? [] : [inherited])]
  return {
    ...process.env,
    // 文件名本身可以合法地以 `:(glob)` 开头；任何来自清单的路径都只按字面解释。
    GIT_LITERAL_PATHSPECS: "1",
    GIT_INDEX_FILE: index,
    GIT_OBJECT_DIRECTORY: objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: all.join(delimiter),
  }
}

async function snapshot(repo: RepoInfo, dir: string, alternates: readonly string[]): Promise<TreeSnapshot> {
  const objects = join(dir, "objects")
  const index = join(dir, "index")
  await mkdir(objects, { recursive: true })
  const env = treeEnv(index, objects, alternates)
  // 先取真实 index：这样 `git add -f` 放进去的 ignored 文件也算工作树的一部分。
  const indexTree = await git(repo.root, ["write-tree"]).then((tree) => tree.trim()).catch(() => undefined)
  const seeded = await git(repo.root, ["read-tree", indexTree ?? "HEAD"], env).then(() => true).catch(() => false)
  if (!seeded) await git(repo.root, ["read-tree", "--empty"], env)
  await git(repo.root, ["add", "-A", "--", "."], env)
  const tree = (await git(repo.root, ["write-tree"], env)).trim()
  if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new Error("Git 工作区基线没有生成有效 tree")
  return { tree, env, ...(indexTree === undefined ? {} : { indexTree }) }
}

function validMeta(value: unknown): value is BaselineMeta {
  if (typeof value !== "object" || value === null) return false
  const meta = value as Partial<BaselineMeta>
  return meta.version === 1 && typeof meta.root === "string" && typeof meta.cwd === "string" &&
    typeof meta.tree === "string" && /^[0-9a-f]{40,64}$/.test(meta.tree)
}

async function readMeta(dir: string): Promise<BaselineMeta | undefined> {
  const raw = await readFile(join(dir, META), "utf8").catch(() => undefined)
  if (raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return validMeta(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function capture(baseDir: string, target: string, cwd: string): Promise<void> {
  const repo = await repoOf(cwd)
  if (repo === undefined) return
  await mkdir(baseDir, { recursive: true })
  const temp = await mkdtemp(join(baseDir, ".capture-"))
  try {
    const made = await snapshot(repo, temp, [repo.objects])
    const meta: BaselineMeta = { version: 1, root: repo.root, cwd: repo.cwd, tree: made.tree }
    await writeFile(join(temp, META), JSON.stringify(meta), "utf8")
    try {
      await rename(temp, target)
    } catch (error) {
      if ((await readMeta(target)) === undefined) throw error
      await rm(temp, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(temp, { recursive: true, force: true })
    throw error
  }
}

function nameEntries(raw: string): readonly NameEntry[] {
  const parts = raw.split("\0")
  const out: NameEntry[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const mark = parts[index]
    if (mark === undefined || mark === "") continue
    if (mark.startsWith("R") || mark.startsWith("C")) {
      const from = parts[index + 1]
      const rel = parts[index + 2]
      if (from !== undefined && rel !== undefined) out.push({ mark, from, rel })
      index += 2
      continue
    }
    const rel = parts[index + 1]
    if (rel !== undefined) out.push({ mark, rel })
    index += 1
  }
  return out
}

function kindOf(mark: string, currentCode?: string): ReviewFile["kind"] {
  // `??` 只说明它不在 HEAD，不说明它在**对话开场树**里不存在。
  // 开场前已有的 untracked 文件本轮被修改时 mark=M，必须叫“修改”而不是“新增”。
  if (mark.startsWith("A") && currentCode?.startsWith("?") === true) return "untracked"
  if (mark.startsWith("A")) return "add"
  if (mark.startsWith("D")) return "delete"
  if (mark.startsWith("R") || mark.startsWith("C")) return "rename"
  return "update"
}

function within(root: string, path: string): string | undefined {
  const rel = relative(root, path)
  return rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)
    ? undefined
    : rel
}

function tmpAlias(path: string): string {
  if (path === "/tmp") return "/private/tmp"
  return path.startsWith("/tmp/") ? `/private${path}` : path
}

function wantedRel(path: string, requestedCwd: string, meta: BaselineMeta): string | undefined {
  const insideRepo = (rel: string): string | undefined =>
    rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)
      ? undefined
      : rel
  if (!isAbsolute(path)) return insideRepo(join(relative(meta.root, meta.cwd), path))
  const lexical = within(tmpAlias(resolve(requestedCwd)), tmpAlias(resolve(path)))
  if (lexical !== undefined) return insideRepo(join(relative(meta.root, meta.cwd), lexical))
  return within(tmpAlias(meta.root), tmpAlias(resolve(path)))
}

function selected(all: readonly NameEntry[], wanted: ReadonlySet<string>): readonly NameEntry[] {
  const first = all.slice(0, MAX_FILES)
  const seen = new Set(first.map((entry) => entry.rel))
  const extra = all.filter(
    (entry) => !seen.has(entry.rel) && (wanted.has(entry.rel) || (entry.from !== undefined && wanted.has(entry.from))),
  )
  return [...first, ...extra]
}

async function withCurrent<T>(
  baselineDir: string,
  repo: RepoInfo,
  run: (current: TreeSnapshot) => Promise<T>,
): Promise<T> {
  const temp = await mkdtemp(join(tmpdir(), "omni-current-tree-"))
  try {
    const made = await snapshot(repo, temp, [repo.objects, join(baselineDir, "objects")])
    return await run(made)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

async function reviewOf(
  found: BaselineAccess,
  requestedCwd: string,
  wanted: readonly string[],
): Promise<BaselineReview> {
  const { dir, meta, repo } = found
  const wantedSet = new Set(
    wanted
      .map((path) => wantedRel(path, requestedCwd, meta))
      .filter((rel): rel is string => rel !== undefined),
  )
  return withCurrent(dir, repo, async (current) => {
    const args = ["diff-tree", "-r", "--no-commit-id", "-M", "-z", meta.tree, current.tree]
    const [names, nums, stage, ignored] = await Promise.all([
      git(repo.root, [...args.slice(0, -2), "--name-status", ...args.slice(-2)], current.env, LIST_BUFFER),
      git(repo.root, [...args.slice(0, -2), "--numstat", ...args.slice(-2)], current.env, LIST_BUFFER),
      stageInfo({
        current,
        status: () => git(repo.root, ["status", "--porcelain", "-z", "-uall"]),
        treeDiff: (from, to) => git(repo.root, ["diff-tree", "-r", "--no-commit-id", "--name-only", "-z", from, to], current.env, LIST_BUFFER),
      }),
      ignoredOutsideTree({ cwd: repo.root, tree: meta.tree, paths: [...wantedSet], env: current.env }),
    ])
    const all = nameEntries(names)
    const kept = selected(all, wantedSet)
    const stats = parseNumstat(nums)
    const files = kept.map((entry): ReviewFile => {
      const code = stage.codes.get(entry.rel)
      const stat = stats.get(entry.rel)
      return {
        path: join(meta.root, entry.rel),
        rel: entry.rel,
        kind: kindOf(entry.mark, code),
        added: stat?.added ?? 0,
        removed: stat?.removed ?? 0,
        ...(entry.from === undefined ? {} : { from: entry.from }),
        ...(stage.unstaged !== undefined && code !== undefined && isStaged(code) && !stage.unstaged.has(entry.rel)
          ? { staged: true }
          : {}),
      }
    })
    return { root: meta.root, cwd: meta.cwd, files, ...(all.length > kept.length ? { more: all.length - kept.length } : {}),
      ...(ignored.length === 0 ? {} : { ignored }), baseline: true }
  })
}

export function createWorktreeBaselines(baseDir: string): WorktreeBaselines {
  const dirOf = (threadId: string): string => join(baseDir, keyOf(threadId))
  const captures = new Map<string, Promise<void>>()
  const deleted = new Set<string>()
  const available = async (threadId: string, cwd: string): Promise<BaselineAccess | undefined> => {
    const dir = dirOf(threadId)
    const [meta, repo] = await Promise.all([readMeta(dir), repoOf(cwd)])
    if (meta === undefined || repo === undefined || meta.root !== repo.root || meta.cwd !== repo.cwd) {
      return undefined
    }
    return { dir, meta, repo }
  }
  const ensure = async (threadId: string, cwd: string): Promise<void> => {
    const key = keyOf(threadId)
    if (deleted.has(key)) return
    if ((await available(threadId, cwd)) !== undefined) return
    if (deleted.has(key)) return
    const running = captures.get(key)
    if (running !== undefined) return running
    const target = dirOf(threadId)
    const started = rm(target, { recursive: true, force: true })
      .then(() => capture(baseDir, target, cwd))
      .finally(() => {
        captures.delete(key)
      })
    captures.set(key, started)
    return started
  }
  return {
    ensure,
    remove: async (threadId) => {
      // 删除与首次取样撞车时先等取样落定再删；反过来会被迟到的 rename 把目录建回来。
      const key = keyOf(threadId)
      deleted.add(key)
      await captures.get(key)?.catch(() => undefined)
      await rm(dirOf(threadId), { recursive: true, force: true })
    },
    review: async (threadId, cwd, wanted = []) => {
      const found = await available(threadId, cwd)
      return found === undefined ? undefined : reviewOf(found, cwd, wanted)
    },
    patch: async (threadId, cwd, rel, context) => {
      const found = await available(threadId, cwd)
      if (found === undefined) return undefined
      return withCurrent(found.dir, found.repo, (current) => treePatch({
        run: (args, maxBuffer) => git(found.repo.root, args, current.env, maxBuffer),
        baseline: found.meta.tree,
        current: current.tree,
        rel,
        context,
      }))
    },
  }
}
