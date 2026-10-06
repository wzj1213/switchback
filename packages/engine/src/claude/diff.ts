import type { FileChange } from "@switchback/protocol"
import { synthDiff, type Synth } from "../synth.js"

const strOf = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

interface RawEdit {
  old_string?: unknown
  new_string?: unknown
}

/** `MultiEdit` 的多处改动落在同一个文件上，合成一条，用 hunk 头分段。 */
function multi(edits: readonly RawEdit[]): Synth {
  const parts = edits.map((e, i) => {
    const one = synthDiff(strOf(e.old_string) ?? "", strOf(e.new_string) ?? "")
    return { header: `@@ 第 ${String(i + 1)} 处 @@`, ...one }
  })
  return {
    diff: parts.map((p) => `${p.header}\n${p.diff}`).join("\n"),
    added: parts.reduce((n, p) => n + p.added, 0),
    removed: parts.reduce((n, p) => n + p.removed, 0),
  }
}

/**
 * Claude 的编辑类工具 → `FileChange`。
 *
 * `kind` 一律是 `update`：**Claude 不告诉我们这个文件此前存不存在**。
 * 标 `add` 会在覆盖已有文件时说假话，而标 `update` 在新建时只是不够精确——
 * 两种不精确里选后者。
 */
export function fileChangesOf(
  tool: string,
  input: Readonly<Record<string, unknown>>,
): readonly FileChange[] {
  const path = strOf(input["file_path"]) ?? ""
  if (path === "") return []
  if (tool === "Write") {
    const content = strOf(input["content"]) ?? ""
    const synth = synthDiff("", content)
    return [{ path, kind: "update", diff: synth.diff, added: synth.added, removed: synth.removed }]
  }
  const edits = input["edits"]
  const synth = Array.isArray(edits)
    ? multi(edits as readonly RawEdit[])
    : synthDiff(strOf(input["old_string"]) ?? "", strOf(input["new_string"]) ?? "")
  if (synth.added === 0 && synth.removed === 0) return []
  return [{ path, kind: "update", diff: synth.diff, added: synth.added, removed: synth.removed }]
}
