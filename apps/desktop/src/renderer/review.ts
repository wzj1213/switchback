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
      rows.push({ ...(left === undefined ? {} : { left }), ...(right === undefined ? {} : { right }) })
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
export function filterFiles(files: readonly ReviewFile[], query: string): readonly ReviewFile[] {
  const q = query.trim().toLowerCase()
  if (q === "") return files
  return files.filter((f) => f.rel.toLowerCase().includes(q))
}

export function tallyReview(files: readonly ReviewFile[]): { added: number; removed: number } {
  return files.reduce(
    (acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }),
    { added: 0, removed: 0 },
  )
}

const bridgeOf = (): typeof window.omni | undefined => (typeof window === "undefined" ? undefined : window.omni)

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
  const [data, setData] = useState<{ root: string; files: readonly ReviewFile[]; more?: number } | undefined>(undefined)
  const [noRepo, setNoRepo] = useState(false)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    const bridge = bridgeOf()
    if (cwd === "" || bridge === undefined) return undefined
    let live = true
    setLoading(true)
    void bridge.workReview(cwd).then((out) => {
      if (!live) return
      setNoRepo(out === undefined)
      if (out !== undefined) setData(out)
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [cwd, stamp, nonce])
  const reload = useCallback(() => {
    setNonce((n) => n + 1)
  }, [])
  return {
    root: data?.root ?? "",
    files: data?.files ?? [],
    ...(data?.more === undefined ? {} : { more: data.more }),
    noRepo,
    loading,
    reload,
  }
}

export interface PatchData extends ReviewPatch {
  lines: readonly NumberedLine[]
  loading: boolean
}

const EMPTY: PatchData = { patch: "", added: 0, removed: 0, lines: [], loading: false }

/**
 * 一个文件的补丁，点开哪个取哪个。
 *
 * **一律按 `"update"` 解析**：git 给的永远是真正的 unified diff，新建文件也带
 * `@@` 头和 `+` 前缀。工具行那份不是这样（`kind` 决定格式），
 * 两者的解析规则不能互相借用。
 */
export function usePatch(cwd: string, rel: string | undefined, context: number, stamp: string): PatchData {
  const [out, setOut] = useState<PatchData>(EMPTY)
  useEffect(() => {
    const bridge = bridgeOf()
    if (cwd === "" || rel === undefined || bridge === undefined) {
      setOut(EMPTY)
      return undefined
    }
    let live = true
    setOut((was) => ({ ...was, loading: true }))
    void bridge.workPatch(cwd, rel, context).then((got) => {
      if (!live) return
      setOut({ ...got, lines: numbered(parseDiff(got.patch, "update")), loading: false })
    })
    return () => {
      live = false
    }
  }, [cwd, rel, context, stamp])
  return out
}
