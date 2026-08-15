import type {
  FileChange,
  FileChangeKind,
  Item,
  ToolCallItem,
  ToolDetail,
  ToolStatus,
  TurnId,
  TurnStatus,
} from "@omni/protocol"
import type { WireFileChangeEntry, WireItem, WireTurnStatus } from "./wire.js"

export interface CodexContext {
  turnId: TurnId
  at: number
}

/**
 * 文本流式 item：只有这两类会收到 delta 通知
 * （`item/agentMessage/delta`、`item/reasoning/summaryTextDelta`）。
 *
 * 它们**不在 `item/started` 时立刻发出去**——codex 的 reasoning item 经常
 * 从头到尾都是空的（推理摘要没开时），发出去就是一条看不见的 item，
 * 它不显示任何内容却会把连续的工具调用分组打断。
 * Claude 那边的空 text 块踩过一模一样的坑，见 `claude/translate.ts`。
 * 所以策略是**有内容才落地**，由 `driver.ts` 的 materialize 逻辑执行。
 */
export function isStreamingText(type: string): boolean {
  return type === "agentMessage" || type === "reasoning"
}

/** reasoning 的文本分散在 summary 与 content 两个数组里，拼起来。 */
export function textOf(item: WireItem): string {
  if (item.type === "agentMessage") return item.text ?? ""
  return [...(item.summary ?? []), ...(item.content ?? [])].join("\n").trim()
}

const TOOL_STATUS: Readonly<Record<string, ToolStatus>> = {
  inProgress: "running",
  completed: "ok",
  failed: "failed",
  declined: "denied",
}

/**
 * 退出码不为 0 一律算失败，哪怕 codex 说 `completed`——
 * 那个字段说的是「进程跑完了」，不是「事情办成了」。界面要的是后者。
 */
export function toolStatus(item: WireItem): ToolStatus {
  const base = TOOL_STATUS[item.status ?? ""] ?? "running"
  if (base === "ok" && typeof item.exitCode === "number" && item.exitCode !== 0) return "failed"
  return base
}

/** add/delete 的 diff 是纯内容没有前缀，只有 update 才是真正的 unified diff。 */
export function countDiff(kind: string, diff: string): { added: number; removed: number } {
  const lines = diff === "" ? [] : diff.split("\n").filter((l) => l !== "")
  if (kind === "add") return { added: lines.length, removed: 0 }
  if (kind === "delete") return { added: 0, removed: lines.length }
  return {
    added: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
    removed: lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
  }
}

/**
 * codex 已经把命令解析成了 `commandActions`——读文件的调用能直接落
 * `file_read`，不用我们再去猜 `sed -n '1,240p' x.js` 是在读文件。
 * 这是 codex 比 Claude 多给的一份信息，白拿。
 */
function commandDetail(item: WireItem): ToolDetail {
  const first = item.commandActions?.[0]
  if (first?.type === "read" && typeof first.path === "string") {
    return { kind: "file_read", path: first.path }
  }
  return {
    kind: "shell",
    command: item.command ?? "",
    ...(item.cwd === undefined || item.cwd === null ? {} : { cwd: item.cwd }),
    ...(typeof item.exitCode === "number" ? { exitCode: item.exitCode } : {}),
    ...(item.aggregatedOutput === undefined || item.aggregatedOutput === null
      ? {}
      : { output: item.aggregatedOutput }),
  }
}

const CHANGE_KIND: Readonly<Record<string, FileChangeKind>> = {
  add: "add",
  delete: "delete",
  update: "update",
}

function toFileChange(entry: WireFileChangeEntry): FileChange {
  const kind = CHANGE_KIND[entry.kind?.type ?? "update"] ?? "update"
  const diff = entry.diff ?? ""
  return { path: entry.path, kind, ...(diff === "" ? {} : { diff }), ...countDiff(kind, diff) }
}

/**
 * 逐文件保留，**不拼成一坨**。一次 `apply_patch` 可以改好几个文件；
 * 拼接之后界面就再也没法按文件分组、按文件折叠、按文件跳编辑器了。
 */
function fileChangeDetail(item: WireItem): ToolDetail {
  const files = (item.changes ?? []).map(toFileChange)
  const tally = files.reduce(
    (acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }),
    { added: 0, removed: 0 },
  )
  return { kind: "file_edit", path: files[0]?.path ?? "", files, ...tally }
}

/** 认不出的 item 落 `other`，原始 type 带上，排查时一眼看得出漏了哪类。 */
function detailOf(item: WireItem): ToolDetail {
  switch (item.type) {
    case "commandExecution":
      return commandDetail(item)
    case "fileChange":
      return fileChangeDetail(item)
    case "mcpToolCall":
      return { kind: "other", name: `${item.server ?? "mcp"}/${item.tool ?? "?"}`, input: item.arguments }
    case "webSearch":
      return { kind: "other", name: "web_search", input: { query: item.query ?? "" } }
    default:
      return { kind: "other", name: item.type }
  }
}

const TOOL_NAME: Readonly<Record<string, string>> = {
  commandExecution: "shell",
  fileChange: "apply_patch",
  webSearch: "web_search",
}

function toolName(item: WireItem): string {
  if (item.type === "mcpToolCall") return `${item.server ?? "mcp"}/${item.tool ?? "?"}`
  return TOOL_NAME[item.type] ?? item.type
}

export function toToolCall(item: WireItem, ctx: CodexContext): ToolCallItem {
  const status = toolStatus(item)
  return {
    // 直接复用 codex 的 item id：审批请求只带 itemId 回来，靠它把审批卡挂对位置
    id: item.id,
    turnId: ctx.turnId,
    at: ctx.at,
    kind: "tool_call",
    tool: toolName(item),
    status,
    detail: detailOf(item),
    ...(status === "failed" && item.error?.message !== undefined ? { error: item.error.message } : {}),
  }
}

/**
 * `WireItem` → omni `Item`。
 *
 * `userMessage` 返回 `undefined`：那条 item 宿主在发 prompt 时已经自己发过了，
 * 引擎再发一遍会在界面上出现两条一样的用户消息。
 */
export function itemToOmni(item: WireItem, ctx: CodexContext, complete: boolean): Item | undefined {
  if (item.type === "userMessage") return undefined
  const base = { id: item.id, turnId: ctx.turnId, at: ctx.at }
  if (item.type === "agentMessage") {
    return { ...base, kind: "agent_message", text: textOf(item), complete }
  }
  if (item.type === "reasoning") {
    return { ...base, kind: "reasoning", text: textOf(item), complete }
  }
  return toToolCall(item, ctx)
}

const TURN_STATUS: Readonly<Record<string, TurnStatus>> = {
  inProgress: "running",
  completed: "completed",
  interrupted: "interrupted",
  failed: "failed",
}

export function turnStatus(status: WireTurnStatus | undefined): TurnStatus {
  return TURN_STATUS[status ?? ""] ?? "completed"
}
