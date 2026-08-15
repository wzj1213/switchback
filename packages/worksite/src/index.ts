import { readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import { rank, type Hit } from "./score.js"

export { score, rank } from "./score.js"
export type { Hit } from "./score.js"

/**
 * 永远不进索引的目录。
 *
 * 这不是「优化」——`node_modules` 一个目录就能有几十万个文件，
 * 不排除的话第一次索引就把界面挂在那里，而里面**没有一个**是用户想 `@` 的。
 */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  // electron-builder 的默认输出目录，**omni 自己就用它**。
  // 漏掉的代价实测过：打完包之后在 omni 里打 `@reduce`，九条候选里六条是
  // `release/mac-arm64/omni.app/Contents/Frameworks/…/locale.pak`——
  // 它们能命中纯粹因为那串长路径里恰好散落着 r、e、d、u、c、e
  "release",
  "target",
  "coverage",
  "vendor",
  "Pods",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".DS_Store",
])

/** 索引上限。到顶就停——一个几十万文件的仓库不该让 `@` 变成一次全盘扫描。 */
const MAX_FILES = 20_000
/** 目录深度上限。深到这个份上的路径，用手打比在列表里找还快。 */
const MAX_DEPTH = 12
/** 索引的有效期。文件增删是常事，但每次按键都重扫更不可接受。 */
const TTL_MS = 15_000

export interface Worksite {
  /** 模糊搜索。空查询给最近索引到的前几个，让 `@` 一按就有东西看。 */
  search: (query: string, limit?: number) => Promise<readonly Hit[]>
  /** 丢掉缓存，下次搜索重新索引。 */
  invalidate: () => void
}

async function walk(root: string, dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return
    if (entry.name.startsWith(".") && entry.name !== ".env") continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(root, full, depth + 1, out)
    } else if (entry.isFile()) {
      out.push(relative(root, full))
    }
  }
}

/**
 * 工作区的文件索引。
 *
 * 放在**引擎之外**：`@` 引用文件是工作区的事，不是某一家引擎的事。
 * codex 有 `fuzzyFileSearch`，Claude 没有——真按引擎各做一份，
 * 两家的排序质量就会不一样，用户会觉得「换个内核连搜文件都变了」。
 */
export function createWorksite(root: string): Worksite {
  const cache: { files: readonly string[] | undefined; at: number; pending: Promise<readonly string[]> | undefined } =
    { files: undefined, at: 0, pending: undefined }

  const load = async (): Promise<readonly string[]> => {
    const out: string[] = []
    await walk(root, root, 0, out)
    cache.files = out
    cache.at = Date.now()
    cache.pending = undefined
    return out
  }

  const files = async (): Promise<readonly string[]> => {
    if (cache.files !== undefined && Date.now() - cache.at < TTL_MS) return cache.files
    // 同时来好几次搜索时只扫一遍：不共用的话按键越快扫得越多
    cache.pending ??= load()
    return cache.pending
  }

  return {
    search: async (query, limit = 20) => rank(await files(), query, limit),
    invalidate: () => {
      cache.files = undefined
      cache.pending = undefined
    },
  }
}
