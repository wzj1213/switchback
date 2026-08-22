import type { DiffLine } from "./diff.js"

/** 带行号的一行。`old`/`new` 缺席表示这一侧没有这一行（增行没有旧行号）。 */
export interface NumberedLine extends DiffLine {
  old?: number
  new?: number
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** 给 unified diff 正文配行号；每个 hunk 头都会重置新旧两侧游标。 */
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

/** 只丢重复的路径/blob 头；模式变化、改名与无换行标记仍是审核所需信息。 */
export function trimMeta(lines: readonly NumberedLine[]): readonly NumberedLine[] {
  return lines.filter(
    (line) =>
      line.kind !== "meta" ||
      !/^(?:diff --git |index |--- |\+\+\+ )/.test(line.text),
  )
}
