import { useCallback, useEffect, useState } from "react"
import type { ReviewFile } from "../shared/review.js"
import type { NumberedLine } from "./review-lines.js"

export { numbered, trimMeta, type NumberedLine } from "./review-lines.js"
export { reviewCopyText, usePatch, type PatchData } from "./review-patch.js"

/**
 * 审核面板的数据与几个纯变换。
 *
 * ## 为什么行号必须自己算
 *
 * git 的补丁里只有 hunk 头（`@@ -12,7 +12,9 @@`）带行号，正文一行都没有。
 * 而审核这个动作**离不开行号**：看到一处可疑的改动，下一步就是去编辑器里打开
 * 那一行。没有行号的 diff 只能整段读，读完还得自己去文件里找。
 *
 * ## 为什么并排视图是从 unified 拼出来的，不另外要一份数据
 *
 * git 不产出并排格式（`--side-by-side` 是 `diff` 的选项，不是 `git diff` 的）。
 * 拼的规则很简单：一段连续的删+一段连续的增就是「左右对照」的一屏，
 * 逐行配对，多出来的那几行另一侧留空。**这是个纯函数**，所以它有测试钉着——
 * 配错了不会报错，只会让人对着两列错位的代码看半天。
 */

export interface SplitRow {
  left?: NumberedLine
  right?: NumberedLine
  /** hunk 头和文件头横跨两列。 */
  full?: NumberedLine
}

/**
 * unified → 并排。
 *
 * 一段连续的删接一段连续的增，就是同一处改动的两面：逐行配对，
 * 长的那侧多出来的行对着空白。上下文行两侧都放同一行。
 */
export function splitRows(lines: readonly NumberedLine[]): readonly SplitRow[] {
  const rows: SplitRow[] = []
  const dels: NumberedLine[] = []
  const adds: NumberedLine[] = []
  const drain = (): void => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i += 1) {
      const left = dels[i]
      const right = adds[i]
      rows.push({
        ...(left === undefined ? {} : { left }),
        ...(right === undefined ? {} : { right }),
      })
    }
    dels.length = 0
    adds.length = 0
  }
  for (const line of lines) {
    if (line.kind === "del") {
      dels.push(line)
      continue
    }
    if (line.kind === "add") {
      adds.push(line)
      continue
    }
    drain()
    if (line.kind === "ctx") rows.push({ left: line, right: line })
    else rows.push({ full: line })
  }
  drain()
  return rows
}

/**
 * 文件清单的过滤。**匹配整条相对路径**，不只是文件名——
 * 输入 `src/main` 要能筛出一个目录下的全部改动，那是审核时最常做的动作。
 */
export function filterFiles(
  files: readonly ReviewFile[],
  query: string,
  untracked = true,
): readonly ReviewFile[] {
  const q = query.trim().toLowerCase()
  const kept = untracked ? files : files.filter((f) => f.kind !== "untracked")
  if (q === "") return kept
  return kept.filter((f) => f.rel.toLowerCase().includes(q))
}

/**
 * 未跟踪的有几个。
 *
 * **单独给一个数**，因为它常常是这份清单里最不需要看的那一大坨：
 * 生成出来的图、导出的产物、还没进 .gitignore 的中间文件——它们确实是
 * 「工作区里变了的东西」，但和「我这次要不要提交」基本无关。
 * 而它们又不能默认藏起来：agent 新建的源文件也是未跟踪的，那正是最该看的。
 * 所以给一个能关的开关，而不是替他决定。
 */
export function untrackedCount(files: readonly ReviewFile[]): number {
  return files.filter((f) => f.kind === "untracked").length
}

export function tallyReview(files: readonly ReviewFile[]): { added: number; removed: number } {
  return files.reduce(
    (acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }),
    { added: 0, removed: 0 },
  )
}

const bridgeOf = (): typeof window.omni | undefined =>
  typeof window === "undefined" ? undefined : window.omni

export interface ReviewData {
  root: string
  cwd: string
  files: readonly ReviewFile[]
  more?: number
  ignored?: readonly string[]
  baseline: boolean
  failed: boolean
  /** 不是 git 仓库。和「没有改动」是两件事，界面上要说不同的话。 */
  noRepo: boolean
  loading: boolean
  /** 这一轮清单请求的身份；文件补丁跟着它刷新，避免左新右旧。 */
  revision: string
  reload: () => void
}

interface ReviewQuery { threadId?: string; wanted?: readonly string[] }

interface LoadedReview extends Omit<ReviewData, "loading" | "reload" | "revision"> {
  key: string
  scope: string
}

function loadedReview(
  key: string,
  scope: string,
  out: Awaited<ReturnType<NonNullable<typeof window.omni>["workReview"]>>,
): LoadedReview {
  if (out === undefined) {
    return { key, scope, root: "", cwd: "", files: [], baseline: false, failed: false, noRepo: true }
  }
  return {
    key,
    scope,
    ...out,
    baseline: out.baseline === true,
    failed: out.failed === true,
    noRepo: false,
  }
}

function reviewData(
  data: LoadedReview | undefined,
  key: string,
  scope: string,
  reload: () => void,
): ReviewData {
  if (data === undefined || data.scope !== scope) {
    return {
      root: "", cwd: "", files: [], noRepo: false, baseline: false, failed: false,
      loading: true, revision: key, reload,
    }
  }
  return { ...data, loading: data.key !== key, revision: key, reload }
}

/**
 * 文件清单。`stamp` 变一次就重问一遍——引擎跑完一轮，工作区就不一样了。
 *
 * **重问期间不清空旧的清单**：清空会让面板在每一轮结束时闪一下白，
 * 而多数时候新旧两份是几乎一样的。
 */
export function useReview(
  cwd: string,
  stamp: string,
  query: ReviewQuery = {},
): ReviewData {
  const [nonce, setNonce] = useState(0)
  const [visit, setVisit] = useState(0)
  const wanted = query.wanted ?? []
  const wantedKey = wanted.join("\u0000")
  const scope = `${cwd}\u0000${query.threadId ?? ""}\u0000${wantedKey}`
  const key = `${scope}\u0000${stamp}\u0000${String(nonce)}\u0000${String(visit)}`
  const [data, setData] = useState<LoadedReview | undefined>(undefined)
  useEffect(() => {
    if (typeof window === "undefined") return undefined
    const bump = (): void => {
      setVisit((n) => n + 1)
    }
    window.addEventListener("focus", bump)
    return () => {
      window.removeEventListener("focus", bump)
    }
  }, [])
  useEffect(() => {
    const bridge = bridgeOf()
    if (cwd === "" || bridge === undefined) return undefined
    let live = true
    void bridge
      .workReview(cwd, query.threadId, wanted)
      .then((out) => {
        if (!live) return
        setData(loadedReview(key, scope, out))
      })
      .catch(() => {
        if (!live) return
        setData({ key, scope, root: "", cwd, files: [], baseline: false, failed: true, noRepo: false })
      })
    return () => {
      live = false
    }
  }, [cwd, key, query.threadId, wantedKey])
  const reload = useCallback(() => {
    setNonce((n) => n + 1)
  }, [])
  // key 在 render 当下就变，旧数据不会在 effect 开始前闪回一帧。
  return reviewData(data, key, scope, reload)
}
