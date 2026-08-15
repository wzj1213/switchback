import type { FileChange } from "@omni/protocol"

/**
 * 从 Claude 的编辑参数**合成** diff。
 *
 * Claude 的 `Edit` 递过来的是 `old_string` / `new_string`，`Write` 递过来的是
 * 整份 `content`——都不是 diff。codex 那边是现成的 unified diff，Claude 这边
 * 只能自己拼，否则 Claude 会话里的文件改动在界面上就是一片空白。
 *
 * ⚠️ 这**不是**真正的逐行 diff（没有 LCS）。做法是：掐掉首尾相同的行，
 * 中间整块按「旧的全删、新的全增」呈现。对 `Edit` 那种小范围替换读起来
 * 和真 diff 没区别；对一次替换几十行的情况会显得笨，但不会**说错**——
 * 删的确实删了，增的确实增了。
 */

const CONTEXT = 2

function lines(text: string): readonly string[] {
  if (text === "") return []
  const raw = text.split("\n")
  return raw[raw.length - 1] === "" ? raw.slice(0, -1) : raw
}

function commonPrefix(a: readonly string[], b: readonly string[]): number {
  const max = Math.min(a.length, b.length)
  for (let i = 0; i < max; i += 1) {
    if (a[i] !== b[i]) return i
  }
  return max
}

/** 后缀不能和前缀重叠，否则同一行会被同时算进上下文两端。 */
function commonSuffix(a: readonly string[], b: readonly string[], prefix: number): number {
  const max = Math.min(a.length, b.length) - prefix
  for (let i = 0; i < max; i += 1) {
    if (a[a.length - 1 - i] !== b[b.length - 1 - i]) return i
  }
  return Math.max(0, max)
}

export interface Synth {
  diff: string
  added: number
  removed: number
}

export function synthDiff(oldText: string, newText: string): Synth {
  const a = lines(oldText)
  const b = lines(newText)
  const p = commonPrefix(a, b)
  const s = commonSuffix(a, b, p)
  const removed = a.slice(p, a.length - s)
  const added = b.slice(p, b.length - s)
  const head = a.slice(Math.max(0, p - CONTEXT), p)
  const tail = a.slice(a.length - s, a.length - s + CONTEXT)
  const body = [
    ...head.map((l) => ` ${l}`),
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
    ...tail.map((l) => ` ${l}`),
  ]
  return { diff: body.join("\n"), added: added.length, removed: removed.length }
}

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
