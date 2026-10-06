import type { FileChange, ToolCallItem, ToolDetail, ToolStatus, TurnId, TurnStatus } from "@switchback/protocol"
import { synthDiff } from "../synth.js"
import type { AcpDiff, AcpStopReason, AcpToolCall } from "./wire.js"

/**
 * ACP 的工具身份是 `kind`，不是工具名——协议里根本没有「工具名」这个字段。
 *
 * 加 `acp:` 前缀有两个用处：判定表里不会和 codex 的 `shell`、Claude 的 `Bash`
 * 撞名；排查时一眼看得出这条是哪家协议来的。
 */
export function toolNameOf(kind: string | null | undefined): string {
  return `acp:${kind ?? "other"}`
}

const TOOL_STATUS: Readonly<Record<string, ToolStatus>> = {
  pending: "pending",
  in_progress: "running",
  completed: "ok",
  failed: "failed",
}

function exitCodeOf(call: AcpToolCall): number | undefined {
  const code = call.rawOutput?.["exit_code"]
  return typeof code === "number" ? code : undefined
}

/**
 * 退出码不为 0 一律算失败，哪怕 ACP 说 `completed`。
 *
 * 和 codex 驱动同一个判断，理由也一样：`completed` 说的是「进程跑完了」，
 * 不是「事情办成了」。实测 codex-acp 里被沙箱拦下的 curl 就是
 * `status: failed` + `exit_code: -1`，但不是每家都这么老实。
 */
export function toolStatusOf(call: AcpToolCall): ToolStatus {
  const base = TOOL_STATUS[call.status ?? ""] ?? "running"
  const code = exitCodeOf(call)
  if (base === "ok" && code !== undefined && code !== 0) return "failed"
  return base
}

function stringField(raw: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = raw?.[key]
  return typeof value === "string" && value !== "" ? value : undefined
}

function canonicalToolKind(call: AcpToolCall): string | undefined {
  const value = call._meta?.["x.ai/tool"]
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return stringField(value as Record<string, unknown>, "kind")
}

/**
 * ACP 的 diff 内容块 → `FileChange`。
 *
 * ## 上一版把「整份文件」当成了「这次改了多少」
 *
 * ACP 给的是**前后全文**（`oldText` / `newText`），不是 unified diff。上一版直接
 * 数这两份全文各有多少行当增删数，于是**在 500 行的文件里改一行，界面上写着
 * `+500 −500`**；那份「diff」（其实是整份新文件）再逐行过渡染色器，正文里以
 * `-` 或 `+` 开头的行（Markdown 列表、YAML）全被画成红绿。
 * 当时的注释写着「别硬造一个假 diff 出来」——那句话防的是**凭空**加前缀，
 * 而 `synthDiff` 不是凭空：两份全文都在手上，掐掉首尾相同的行就是真的改动范围。
 *
 * `add` 那一支照旧把**全文**放进 `diff`（协议规定 add/delete 时它是文件内容本身，
 * 渲染层按 `kind` 读），但行数也走同一个口径算——不然「新建一个含空行的文件」
 * 和「改同样多行」会报出两个不同的语义。
 */
function toFileChange(entry: AcpDiff): FileChange | undefined {
  if (entry.type !== "diff" || entry.path === undefined) return undefined
  const isNew = entry.oldText === undefined || entry.oldText === null
  const newText = entry.newText ?? ""
  if (isNew) {
    return {
      path: entry.path,
      kind: "add",
      ...(entry.newText === undefined ? {} : { diff: entry.newText }),
      added: synthDiff("", newText).added,
      removed: 0,
    }
  }
  const synth = synthDiff(entry.oldText ?? "", newText)
  return { path: entry.path, kind: "update", diff: synth.diff, added: synth.added, removed: synth.removed }
}

function editDetail(call: AcpToolCall): ToolDetail {
  const files = (call.content ?? []).map(toFileChange).filter((f): f is FileChange => f !== undefined)
  const tally = files.reduce(
    (acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }),
    { added: 0, removed: 0 },
  )
  const fallback = call.locations?.[0]?.path ?? ""
  return { kind: "file_edit", path: files[0]?.path ?? fallback, files, ...tally }
}

/**
 * 命令的输出在 `rawOutput.formatted_output` 里。
 *
 * ACP 本来的设计是走 `terminal/*`：agent 让**客户端**开终端、客户端回传输出。
 * Switchback 不advertise `terminal` 能力（引擎跑自己的进程是这个产品的前提），
 * 实测 codex-acp 在这种情况下仍然把命令跑在自己那边，输出从 `rawOutput`
 * 和 `_meta.terminal_output_delta` 回来。所以读 `rawOutput` 就够，
 * 不必为了拿输出去实现一整套 `terminal/*`。
 */
function execDetail(call: AcpToolCall): ToolDetail {
  const command = stringField(call.rawInput, "command") ?? call.title ?? ""
  const cwd = stringField(call.rawInput, "cwd")
  const output = stringField(call.rawOutput, "formatted_output")
  const code = exitCodeOf(call)
  return {
    kind: "shell",
    command,
    ...(cwd === undefined ? {} : { cwd }),
    ...(code === undefined ? {} : { exitCode: code }),
    ...(output === undefined ? {} : { output }),
  }
}

function readDetail(call: AcpToolCall): ToolDetail | undefined {
  const path = call.locations?.[0]?.path ?? stringField(call.rawInput, "path")
  return path === undefined ? undefined : { kind: "file_read", path }
}

function fetchDetail(call: AcpToolCall): ToolDetail | undefined {
  const url = stringField(call.rawInput, "url") ?? stringField(call.rawInput, "uri")
  return url === undefined ? undefined : { kind: "fetch", url }
}

function otherDetail(call: AcpToolCall): ToolDetail {
  return { kind: "other", name: call.title ?? call.kind ?? "other", input: call.rawInput }
}

/**
 * kind → 形态。返回 `undefined` 表示「这个 kind 认得，但这一条缺了必要字段」，
 * 由 `detailOf` 统一落到 `other`——比在每个分支里各写一次回落干净。
 */
const DETAIL_BY_KIND: Readonly<Record<string, (call: AcpToolCall) => ToolDetail | undefined>> = {
  execute: execDetail,
  edit: editDetail,
  delete: editDetail,
  move: editDetail,
  read: readDetail,
  search: readDetail,
  fetch: fetchDetail,
}

/**
 * 认不出的 kind 落 `other`，**名字用 `title`**——ACP 的 title 是给人看的一句话
 * （实测："Read file '/tmp/x/hello.txt'"），比裸 kind 有用得多。
 */
export function detailOf(call: AcpToolCall): ToolDetail {
  // Grok 把 Monitor 有损映成 ACP other，但同时公开了规范化的 x.ai/tool.kind。
  // 它的 command 与后续输出都能走既有 shell 形态，无需为单家再造一种 Item。
  if (canonicalToolKind(call) === "monitor") return execDetail(call)
  return DETAIL_BY_KIND[call.kind ?? "other"]?.(call) ?? otherDetail(call)
}

export function toToolCall(call: AcpToolCall, turnId: TurnId, at: number): ToolCallItem {
  const status = toolStatusOf(call)
  return {
    id: call.toolCallId ?? `acp-${String(at)}`,
    turnId,
    at,
    kind: "tool_call",
    tool: toolNameOf(canonicalToolKind(call) ?? call.kind),
    status,
    detail: detailOf(call),
  }
}

/**
 * `tool_call_update` 是**局部补丁**：给了的字段替换，没给的保持原样。
 *
 * 实测 codex-acp 的收尾更新只有 `{toolCallId, status: "completed"}`——
 * 不合并的话，工具行会在完成的那一刻把标题、diff、输出全部丢光，
 * 变成一条什么都没有的空行。这是接 ACP 踩到的第一个真 bug。
 *
 * `null` 按协议是「显式清空」，和「没给」不同，所以只跳过 `undefined`。
 */
export function merge(prev: AcpToolCall | undefined, patch: AcpToolCall): AcpToolCall {
  const next: AcpToolCall = { ...prev }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    ;(next as Record<string, unknown>)[key] = value
  }
  return next
}

const STOP_STATUS: Readonly<Record<AcpStopReason, TurnStatus>> = {
  end_turn: "completed",
  cancelled: "interrupted",
  refusal: "failed",
  max_tokens: "failed",
  max_turn_requests: "failed",
}

const STOP_DETAIL: Readonly<Partial<Record<AcpStopReason, string>>> = {
  max_tokens: "模型输出达到长度上限，这一轮没说完就停了。",
  max_turn_requests: "达到单轮内的请求次数上限，引擎主动停手了。",
  refusal: "引擎拒绝了这一轮。**这条提问和它之后的内容不会进入下一次请求**——界面上还看得见，但模型已经不记得了。",
}

/**
 * `stopReason` → Switchback 轮次状态。
 *
 * `max_tokens` / `max_turn_requests` 判为 `failed` 是有意的：活儿没干完。
 * 判成 `completed` 的话界面上是一个干干净净的收工态，用户不会知道
 * 它其实是撞墙停的——而这两种情况下**接着说「继续」通常就能救回来**，
 * 前提是他知道发生了什么。附带的解释走 `error` 字段。
 *
 * `refusal` 也判 `failed`，理由不一样：协议原文说被拒的这一轮
 * 「不会进入下一次请求，所以应当在界面上体现出来」。Switchback 的 transcript
 * 是照着事件流重放的，它会一直显示这一轮——**那就和模型的记忆对不上了**。
 * 判成 `completed` 等于让界面撒一个很难发现的谎。
 */
export function stopStatus(reason: AcpStopReason | undefined): {
  status: TurnStatus
  error?: string
} {
  if (reason === undefined) return { status: "completed" }
  const detail = STOP_DETAIL[reason]
  return { status: STOP_STATUS[reason] ?? "completed", ...(detail === undefined ? {} : { error: detail }) }
}
