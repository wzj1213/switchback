import type { FileChange, FileChangeKind } from "@omni/protocol"

/**
 * 一行 diff 的语义。
 *
 * `meta` 是 `--- a/x` / `+++ b/x` 这类文件头——它们以 `+`/`-` 开头却**不是**
 * 增删行，按增删渲染会让每个补丁凭空多出一红一绿两行。
 */
export type DiffLineKind = "add" | "del" | "ctx" | "hunk" | "meta"

export interface DiffLine {
  kind: DiffLineKind
  /** 已经剥掉前缀的正文。渲染层自己决定要不要补回 `+`/`-` 记号。 */
  text: string
}

function classify(line: string, inHunk: boolean): DiffLineKind {
  if (line.startsWith("@@")) return "hunk"
  if (!inHunk && (line.startsWith("+++ ") || line.startsWith("--- "))) return "meta"
  if (line.startsWith("diff ") || line.startsWith("index ")) return "meta"
  if (/^(?:old mode|new mode|deleted file mode|new file mode|copy from|copy to|rename from|rename to|similarity index|dissimilarity index|\\ No newline at end of file)/.test(line)) return "meta"
  if (line.startsWith("+")) return "add"
  if (line.startsWith("-")) return "del"
  return "ctx"
}

function stripPrefix(kind: DiffLineKind, line: string): string {
  if (kind === "add" || kind === "del") return line.slice(1)
  if (kind === "ctx") return line.startsWith(" ") ? line.slice(1) : line
  return line
}

/**
 * 把一个文件的改动解析成可渲染的行。
 *
 * **`kind` 是必需的参数，不是可选的润色。** 各家给 `add` / `delete` 时递过来的是
 * **文件内容本身**，不带任何 `+`/`-` 前缀；照 unified diff 去解析，一个以
 * `-- 说明` 开头的 Markdown 新文件就会被读成"删除了一行"。
 */
export function parseDiff(diff: string, kind: FileChangeKind): readonly DiffLine[] {
  if (diff === "") return []
  const raw = diff.split("\n")
  // 末尾换行造成的空串不是一行内容
  const lines = raw[raw.length - 1] === "" ? raw.slice(0, -1) : raw
  if (kind === "add") return lines.map((text) => ({ kind: "add" as const, text }))
  if (kind === "delete") return lines.map((text) => ({ kind: "del" as const, text }))
  let inHunk = false
  return lines.map((line) => {
    if (line.startsWith("diff --git ")) inHunk = false
    if (line.startsWith("@@")) inHunk = true
    const lineKind = classify(line, inHunk)
    return { kind: lineKind, text: stripPrefix(lineKind, line) }
  })
}

const KIND_LABEL: Readonly<Record<FileChangeKind, string>> = {
  add: "新建",
  delete: "删除",
  update: "修改",
}

export function kindLabel(kind: FileChangeKind): string {
  return KIND_LABEL[kind]
}

/** 文件名与它上面的目录分开：文件名给足权重，路径压成次级信息。 */
export function splitPath(path: string): { dir: string; name: string } {
  const at = path.lastIndexOf("/")
  return at === -1 ? { dir: "", name: path } : { dir: path.slice(0, at + 1), name: path.slice(at + 1) }
}

/** 合计增删。标题上只放一个数，逐文件的数字在各自的文件头上。 */
export function tally(files: readonly FileChange[]): { added: number; removed: number } {
  return files.reduce(
    (acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }),
    { added: 0, removed: 0 },
  )
}
