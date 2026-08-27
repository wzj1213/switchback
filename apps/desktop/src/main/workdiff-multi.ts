import { execFile } from "node:child_process"
import { realpath } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"
import type { ReviewFile } from "../shared/review.js"

const run = promisify(execFile)
const TIMEOUT = 5000

/**
 * **工作区自己不是仓库，但它下面挂着好几个仓库**——这种目录怎么审。
 *
 * ## 为什么非要接这一档
 *
 * 有人（不止一个）习惯开一个总目录（`~/work/repos`）当工作区，底下并排放着
 * 五六个仓库，一条会话里跨仓库地改。总目录自己**不是** git 仓库，于是
 * `git rev-parse --show-toplevel` 在那儿必然失败，整块审核面板只剩一句
 * 「这个工作区不是 git 仓库，没有可比的基线」——**改了什么一个字都看不到**，
 * 而这恰恰是那种会话最需要看的东西（跨了几个仓库，人自己更记不住）。
 *
 * ## 做法：按文件所属的仓库分组，一个仓库问一遍
 *
 * 引擎报过的每条路径，从**它自己所在的目录**往上问一次 `--show-toplevel`；
 * 问出来的根去重之后，每个根各走一遍原来那条单仓库流程（`workReview(root, …)`），
 * 最后把几份清单并起来。
 *
 * 两条边界：
 *
 * - **`rel` 改成相对总目录**，不再相对各自的仓库根。不改的话两个仓库里同名的
 *   `src/index.ts` 在同一张清单里长得一模一样，而人得先猜它是哪个仓库的。
 *   `path` 仍然是绝对真实路径，身份靠它，不受影响。
 * - **只认引擎报过的那些路径所在的仓库**，不去扫目录。总目录下可能有二十个
 *   仓库、还有 `node_modules` 里成千上万个——扫一遍既慢又答非所问：
 *   这条会话没碰过的仓库不该出现在这次审核里。
 *
 * ## 基线会退到 HEAD，这一点得说清楚
 *
 * 对话开场基线是按**会话工作目录**记的（`worktree-baseline.ts`），而这里是拿
 * 各个仓库根去问的，那份基线对不上——于是每个仓库都退回「相对 HEAD」。
 * 面板上那句「不能归因到本次对话」照常显示，不假装它是本次对话的净改动。
 */

/**
 * 一份审核结果里这一层用得到的那几项。**不从 `workdiff.ts` 引类型**——
 * 那边 import 了这个文件，反过来再引就成了环。
 */
export interface Spread {
  root: string
  cwd: string
  files: readonly ReviewFile[]
  more?: number
  ignored?: readonly string[]
  failed?: true
  spread?: true
}

/** 「审一个仓库」的那条路，由调用方递进来（就是 `workReview` 自己）。 */
export type OneRepo = (root: string, source: { wanted?: readonly string[] }) => Promise<Spread | undefined>

/** 一个仓库，以及这次会话在它里面碰过的那几条路径。 */
export interface RepoSlice {
  root: string
  paths: readonly string[]
}

/** 最多认几个仓库。一条会话跨到第九个仓库时，人要的已经是别的工具了。 */
const MAX_REPOS = 8

/** 这条路径归哪个仓库。**按目录缓存**：一个仓库下二十个文件只问一次 git。 */
async function rootOf(path: string, cache: Map<string, string | undefined>): Promise<string | undefined> {
  const dir = dirname(path)
  const known = cache.get(dir)
  if (known !== undefined || cache.has(dir)) return known
  const top = await run("git", ["rev-parse", "--show-toplevel"], { cwd: dir, timeout: TIMEOUT })
    .then((out) => out.stdout.trim())
    .catch(() => undefined)
  const root = top === undefined || top === "" ? undefined : top
  cache.set(dir, root)
  return root
}

/**
 * 总目录的真实路径。**必须 realpath**：macOS 上临时目录是
 * `/var/folders/…`，而 `git rev-parse --show-toplevel` 吐的是
 * `/private/var/folders/…`——不归一的话「这个仓库在不在总目录底下」永远是否，
 * 整条路静默地退回「不是 git 仓库」。
 */
async function baseOf(cwd: string): Promise<string> {
  return realpath(cwd).catch(() => resolve(cwd))
}

function beneath(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== "" && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/**
 * 把引擎报过的路径按所属仓库分组。
 *
 * **只收总目录底下的**：引擎也会读 `/tmp`、读它自己的技能文档，那些不属于
 * 这个工作区，混进来就变成「审核面板里冒出一个你没打开过的仓库」。
 */
export async function repoSlices(cwd: string, wanted: readonly string[]): Promise<readonly RepoSlice[]> {
  const base = await baseOf(cwd)
  const cache = new Map<string, string | undefined>()
  const groups = new Map<string, string[]>()
  for (const raw of wanted) {
    const asked = isAbsolute(raw) ? resolve(raw) : resolve(base, raw)
    const path = await realpath(asked).catch(() => asked)
    if (!beneath(base, path)) continue
    const root = await rootOf(path, cache)
    if (root === undefined || !beneath(base, root)) continue
    const bucket = groups.get(root)
    if (bucket === undefined) {
      if (groups.size >= MAX_REPOS) continue
      groups.set(root, [path])
      continue
    }
    bucket.push(path)
  }
  return [...groups].map(([root, paths]) => ({ root, paths }))
}

/** 一条 rel（相对总目录）落在哪个仓库里，以及它在那个仓库里的相对路径。 */
export async function repoForRel(
  cwd: string,
  rel: string,
): Promise<{ root: string; rel: string } | undefined> {
  const base = await baseOf(cwd)
  const asked = resolve(base, rel)
  if (!beneath(base, asked)) return undefined
  const path = await realpath(asked).catch(() => asked)
  const root = await rootOf(path, new Map())
  if (root === undefined || !beneath(base, root)) return undefined
  return { root, rel: relative(root, path) }
}

/** 把某个仓库的清单并进总目录的口径：`rel` 换成相对总目录，`path` 不动。 */
export function reframe(cwd: string, root: string, files: readonly ReviewFile[]): readonly ReviewFile[] {
  return files.map((file) => ({
    ...file,
    rel: relative(cwd, file.path === "" ? join(root, file.rel) : file.path),
    ...(file.from === undefined ? {} : { from: relative(cwd, join(root, file.from)) }),
  }))
}

/**
 * 总目录不是仓库时的那条路：底下每个被碰过的仓库各审一遍，清单并起来。
 *
 * 递归回调 `workReview`——每个仓库根走的就是原来那条单仓库流程，基线、范围、
 * numstat 全都复用，这里只管分组和合并。**回调而不是直接 import**：
 * 那边已经 import 了这个文件，反过来再 import 就成了环。
 */
export async function spreadReview(
  cwd: string,
  source: { wanted?: readonly string[] },
  one: OneRepo,
): Promise<Spread | undefined> {
  const slices = await repoSlices(cwd, source.wanted ?? [])
  if (slices.length === 0) return undefined
  const parts = await Promise.all(
    slices.map(async (slice) => {
      const part = await one(slice.root, { ...source, wanted: slice.paths })
      return part === undefined ? undefined : { root: slice.root, review: part }
    }),
  )
  const found = parts.filter((part): part is { root: string; review: Spread } => part !== undefined)
  if (found.length === 0) return undefined
  const actualCwd = await baseOf(cwd)
  const files = found.flatMap((part) => reframe(actualCwd, part.root, part.review.files))
  const more = found.reduce((sum, part) => sum + (part.review.more ?? 0), 0)
  const ignored = found.flatMap((part) => part.review.ignored ?? [])
  return {
    root: actualCwd,
    cwd: actualCwd,
    files,
    // **一条都没失败才算没失败**：一个仓库读不出来时整张清单是残的，得说
    ...(found.some((part) => part.review.failed === true) ? { failed: true as const } : {}),
    ...(more > 0 ? { more } : {}),
    ...(ignored.length > 0 ? { ignored } : {}),
    /** 跨仓库这一档**永远退到 HEAD**：对话开场基线是按会话工作目录记的，对不上各个仓库根。 */
    spread: true as const,
  }
}

