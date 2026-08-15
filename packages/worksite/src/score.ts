/**
 * 子序列模糊匹配与打分。**纯函数**——排序质量能被穷举测试。
 *
 * 不用现成的 fuzzy 库：它们大多为「短列表 + 单词」调优，
 * 而这里排的是**路径**。路径有它自己的规律，最重要的一条是
 * **文件名比目录名重要得多**——搜 `host` 时 `src/host.ts` 必须排在
 * `src/host/util.ts` 前面，更要排在 `packages/host-x/deep/thing.ts` 前面。
 */

/** 连续命中的加分。分散命中远不如连成一片，这是可读性最强的信号。 */
const RUN_BONUS = 6
/** 命中落在词首（路径分隔符、`-`、`_`、`.` 之后）的加分。 */
const BOUNDARY_BONUS = 8
/** 命中落在文件名部分（最后一个 `/` 之后）的加分。 */
const BASENAME_BONUS = 10
/** 每个跳过的字符扣分，压制「字母散落在长路径各处」的伪匹配。 */
const GAP_PENALTY = 1

export interface Hit {
  path: string
  score: number
}

/**
 * 逐字符贪心匹配。
 *
 * 贪心不是最优解（最优要动态规划），但**路径这个场景下差别极小**，
 * 而候选集有几万条时线性一趟和 O(n·m) 的差别是能感觉到的。
 */
const BOUNDARIES: ReadonlySet<string> = new Set(["/", "-", "_", "."])

interface Step {
  haystack: string
  /** 这个字符落在哪 */
  found: number
  /** 上一个命中之后的位置 */
  at: number
  /** 已经连续命中了几个 */
  run: number
  /** 文件名部分从哪开始 */
  baseAt: number
}

/** 一次命中值多少分。抽出来纯粹是为了让 `score` 的分支数不撞闸门。 */
function hitValue({ haystack, found, at, run, baseAt }: Step): number {
  const prev = found === 0 ? "/" : (haystack[found - 1] ?? "")
  return (
    run * RUN_BONUS +
    (BOUNDARIES.has(prev) ? BOUNDARY_BONUS : 0) +
    (found >= baseAt ? BASENAME_BONUS : 0) -
    Math.min(found - at, 10) * GAP_PENALTY
  )
}

/** 在一段文本上贪心走一遍。`baseAt` 之后的命中算「落在文件名里」。 */
function walk(haystack: string, needle: string, baseAt: number): number | undefined {
  let total = 0
  let at = 0
  let run = 0
  for (const ch of needle) {
    const found = haystack.indexOf(ch, at)
    if (found === -1) return undefined
    run = found === at && at > 0 ? run + 1 : 0
    total += hitValue({ haystack, found, at, run, baseAt })
    at = found + 1
  }
  return total
}

/**
 * 全路径与「只看文件名」各走一遍，取高的那个。
 *
 * **贪心会咬住第一个匹配，再也回不了头。** 实测：搜 `host` 时
 * `packages/host/README.md` 排在 `packages/host/src/host.ts` 前面——
 * 两者都在目录段 `host/` 上匹配完了，于是只剩路径长度在比，
 * 而 README 更短。文件名里的那个 `host` 根本没被看见。
 *
 * 补一趟只针对 basename 的匹配就够了：这是「打文件名找文件」这个
 * 压倒性主流的用法，值得单独照顾一次。真正的最优子序列要动态规划，
 * 对这个场景不划算。
 */
export function score(path: string, query: string): number | undefined {
  if (query === "") return 0
  const haystack = path.toLowerCase()
  const needle = query.toLowerCase()
  const baseAt = haystack.lastIndexOf("/") + 1
  const basename = haystack.slice(baseAt)
  const full = walk(haystack, needle, baseAt)
  // 文件名里多出来的字符要扣分：搜 `host` 时 `host.ts` 该排在 `host.test.ts` 前面。
  // 不扣的话两者基础分一模一样，只剩路径长度在比，而那和「谁更像你要找的」无关。
  const base = walk(basename, needle, 0)
  const scored = base === undefined ? undefined : base - Math.max(0, basename.length - needle.length)
  if (full === undefined && scored === undefined) return undefined
  const best = Math.max(full ?? Number.NEGATIVE_INFINITY, scored ?? Number.NEGATIVE_INFINITY)
  // 短路径优先：同样匹配上，`src/host.ts` 比 `a/b/c/d/host.ts` 更可能是想找的
  return best - Math.floor(path.length / 12)
}

export function rank(paths: readonly string[], query: string, limit: number): readonly Hit[] {
  const hits: Hit[] = []
  for (const path of paths) {
    const value = score(path, query)
    if (value !== undefined) hits.push({ path, score: value })
  }
  // 分数相同按路径字典序，保证结果稳定——同一次查询两次结果不该不一样
  hits.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
  return hits.slice(0, limit)
}
