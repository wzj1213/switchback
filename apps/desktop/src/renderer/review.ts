import { useCallback, useEffect, useState } from "react"
import type { ReviewFile, ReviewPatch } from "../shared/review.js"
import { parseDiff, type DiffLine } from "./diff.js"

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

/** 带行号的一行。`old`/`new` 缺席表示这一侧没有这一行（增行没有旧行号）。 */
export interface NumberedLine extends DiffLine {
  old?: number
  new?: number
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * 给每一行配上行号。
 *
 * 遇到 hunk 头就重置两个游标——**这一步不能省**：一份补丁里有好几个 hunk，
 * 沿用上一个 hunk 的游标会让第二段之后的行号全部偏掉，而偏掉的行号
 * 比没有行号更坏（人会照着它去文件里找，找到的是别的地方）。
 */
export function numbered(lines: readonly DiffLine[]): readonly NumberedLine[] {
  const at = { old: 0, new: 0 }
  return lines.map((line) => {
    const hunk = line.kind === "hunk" ? HUNK.exec(line.text) : null
    if (hunk !== null) {
      at.old = Number(hunk[1])
      at.new = Number(hunk[2])
      return line
    }
    if (line.kind === "del") return { ...line, old: at.old++ }
    if (line.kind === "add") return { ...line, new: at.new++ }
    if (line.kind === "ctx") return { ...line, old: at.old++, new: at.new++ }
    return line
  })
}

/**
 * 丢掉 `diff --git` / `index` / `---` / `+++` 那四行。
 *
 * **它们在这块面板里是纯噪音**：路径就写在正文上方的文件头上，blob 哈希对读代码
 * 没有任何帮助，而每个文件开头都顶着四行灰字，第一处真正的改动就被推下去了。
 * 转录区里那份保留它们是另一回事——那里没有文件头。
 */
export function trimMeta(lines: readonly NumberedLine[]): readonly NumberedLine[] {
  return lines.filter((l) => l.kind !== "meta")
}

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
  files: readonly ReviewFile[]
  more?: number
  /** 不是 git 仓库。和「没有改动」是两件事，界面上要说不同的话。 */
  noRepo: boolean
  loading: boolean
  reload: () => void
}

/**
 * 文件清单。`stamp` 变一次就重问一遍——引擎跑完一轮，工作区就不一样了。
 *
 * **重问期间不清空旧的清单**：清空会让面板在每一轮结束时闪一下白，
 * 而多数时候新旧两份是几乎一样的。
 */
export function useReview(cwd: string, stamp: string): ReviewData {
  const [nonce, setNonce] = useState(0)
  const key = `${cwd}\u0000${stamp}\u0000${String(nonce)}`
  const [data, setData] = useState<
    | {
        key: string
        root: string
        files: readonly ReviewFile[]
        more?: number
        noRepo: boolean
      }
    | undefined
  >(undefined)
  useEffect(() => {
    const bridge = bridgeOf()
    if (cwd === "" || bridge === undefined) return undefined
    let live = true
    void bridge.workReview(cwd).then((out) => {
      if (!live) return
      setData(
        out === undefined
          ? { key, root: "", files: [], noRepo: true }
          : { key, ...out, noRepo: false },
      )
    })
    return () => {
      live = false
    }
  }, [cwd, key])
  const reload = useCallback(() => {
    setNonce((n) => n + 1)
  }, [])
  return {
    root: data?.root ?? "",
    files: data?.files ?? [],
    ...(data?.more === undefined ? {} : { more: data.more }),
    noRepo: data?.noRepo ?? false,
    // key 在 render 当下就变，旧数据不会在 effect 开始前闪回一帧。
    loading: data?.key !== key,
    reload,
  }
}

export interface PatchData extends ReviewPatch {
  lines: readonly NumberedLine[]
  loading: boolean
}

const EMPTY = { patch: "", added: 0, removed: 0, lines: [] } as const

/**
 * 一个文件的补丁，点开哪个取哪个。
 *
 * **一律按 `"update"` 解析**：git 给的永远是真正的 unified diff，新建文件也带
 * `@@` 头和 `+` 前缀。工具行那份不是这样（`kind` 决定格式），
 * 两者的解析规则不能互相借用。
 */
export function usePatch(
  cwd: string,
  rel: string | undefined,
  context: number,
  stamp: string,
): PatchData {
  const key = `${cwd}\u0000${rel ?? ""}\u0000${String(context)}\u0000${stamp}`
  const [out, setOut] = useState<(Omit<PatchData, "loading"> & { key: string }) | undefined>(
    undefined,
  )
  useEffect(() => {
    const bridge = bridgeOf()
    if (cwd === "" || rel === undefined || bridge === undefined) {
      return undefined
    }
    let live = true
    void bridge.workPatch(cwd, rel, context).then((got) => {
      if (!live) return
      setOut({ key, ...got, lines: trimMeta(numbered(parseDiff(got.patch, "update"))) })
    })
    return () => {
      live = false
    }
  }, [cwd, rel, context, key])
  if (rel === undefined) return { ...EMPTY, loading: false }
  if (out?.key !== key) return { ...EMPTY, loading: true }
  return { ...out, loading: false }
}
