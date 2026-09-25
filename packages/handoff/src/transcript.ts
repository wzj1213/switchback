import type { Item, PlanItem, Thread, ToolCallItem } from "@omni/protocol"
import { isoAt, ownerOf, stintsOf, turnsOf, type TurnEngines } from "./stints.js"

/**
 * 交接用的会话转写：**尽量无损**，给接手的那家引擎自己去读。
 *
 * 和桌面端「导出 Markdown」（贴到 issue 给人看）不是一回事：那边为可读性压掉了推理、
 * 只留工具标题；这里读者是模型，能留的都留——推理原文、完整命令输出、完整 diff、
 * 审批与报错。工具调用行尾带 `〔原生 id〕`：宿主为全局唯一重铸了条目 id，引擎自己报的那个
 * 留在 `nativeId` 上，拿它去那一段的原始记录里搜就能落到同一次调用。没有 `nativeId`
 *（旧记录）就不标——omni 自己铸的 id 在原始记录里搜不到，标上只会让人白搜一趟。
 *
 * 纯函数：时间由调用方传入，不读时钟、不碰磁盘。
 */
export interface TranscriptInput {
  thread: Thread
  items: readonly Item[]
  /** 引擎 id → 人话名。 */
  label: (engine: string) => string
  /** 这份转写生成的时刻。 */
  at: number
  /** 每一轮是哪家开的（`turnEnginesOf`）。缺了的轮次按分段开始时间推断。 */
  engines?: TurnEngines
}

export interface Transcript {
  text: string
  /** 总行数。 */
  lines: number
  /** 最后一轮：第几轮、从第几行开始（1 起）。接手的那家多半先读这里。 */
  lastTurn?: { turn: number; line: number }
}

const FENCE = "```"

function fence(text: string, lang = ""): string {
  // 内容里本来就有围栏时用更长的围栏，否则代码块会被内容提前闭合
  const longest = Math.max(0, ...[...text.matchAll(/`{3,}/g)].map((match) => match[0].length))
  const bar = longest >= FENCE.length ? "`".repeat(longest + 1) : FENCE
  return `${bar}${lang}\n${text.replace(/\n$/, "")}\n${bar}`
}

function quote(text: string): string {
  return text.split("\n").map((line) => `> ${line}`).join("\n")
}

function toolHead(item: ToolCallItem): string {
  const detail = item.detail
  const what = detail.kind === "shell" ? `执行 \`${detail.command}\``
    : detail.kind === "file_edit" ? `编辑 ${detail.path}（+${String(detail.added)} −${String(detail.removed)}）`
    : detail.kind === "file_read" ? `读取 ${detail.path}${detail.range === undefined ? "" : `（第 ${String(detail.range[0])}–${String(detail.range[1])} 行）`}`
    : detail.kind === "fetch" ? `抓取 ${detail.url}`
    : `${detail.name}`
  return `#### 工具 ${item.tool}：${what} — ${item.status}${item.nativeId === undefined ? "" : `〔${item.nativeId}〕`}`
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

type Detail<K extends ToolCallItem["detail"]["kind"]> = Extract<ToolCallItem["detail"], { kind: K }>

function shellBody(detail: Detail<"shell">): readonly string[] {
  return [
    ...(detail.exitCode === undefined ? [] : [`退出码 ${String(detail.exitCode)}`]),
    ...(detail.output === undefined || detail.output === "" ? [] : [fence(detail.output)]),
  ]
}

function editBody(detail: Detail<"file_edit">): readonly string[] {
  return detail.files
    .filter((file) => file.diff !== undefined && file.diff !== "")
    .map((file) => `${file.path}（${file.kind}）\n${fence(file.diff ?? "", "diff")}`)
}

function otherBody(detail: Detail<"other">): readonly string[] {
  const output = detail.output
  return [
    ...(detail.input === undefined ? [] : [`输入\n${fence(json(detail.input), "json")}`]),
    ...(output === undefined ? [] : [`输出\n${fence(typeof output === "string" ? output : json(output))}`]),
  ]
}

function toolBody(item: ToolCallItem): readonly string[] {
  const detail = item.detail
  const body = detail.kind === "shell" ? shellBody(detail)
    : detail.kind === "file_edit" ? editBody(detail)
    : detail.kind === "other" ? otherBody(detail) : []
  return item.error === undefined || item.error === "" ? body : [...body, `错误：${item.error}`]
}

function planBlock(item: PlanItem): string {
  const mark = { pending: " ", in_progress: "~", done: "x", dropped: "-" } as const
  const steps = item.steps.map((step) => `- [${mark[step.status]}] ${step.text}`).join("\n")
  return `#### 计划\n\n${item.explanation === undefined ? "" : `${item.explanation}\n\n`}${steps}`
}

function lanePrefix(item: Item): string {
  return item.lane === undefined ? "" : `（旁路 ${item.lane.id}）`
}

type Of<K extends Item["kind"]> = Extract<Item, { kind: K }>

function userBlock(item: Of<"user_message">): string {
  const who = item.origin === undefined ? "用户" : item.origin === "handoff" ? "交接说明" : "自动触发"
  const files = (item.attachments ?? []).length === 0 ? "" : `\n\n附件：${(item.attachments ?? []).join("、")}`
  return `#### ${who}${lanePrefix(item)}\n\n${item.text}${files}`
}

function errorBlock(item: Of<"error">): string {
  const detail = item.detail === undefined ? "" : `\n\n${fence(item.detail)}`
  return `#### 报错${item.fatal ? "（致命）" : ""}\n\n${item.message}${detail}`
}

function approvalBlock(item: Of<"approval">): string {
  return `#### 审批 ${item.tool} — ${item.status}\n\n${item.summary}${item.reason === "" ? "" : `\n\n理由：${item.reason}`}`
}

const RENDER: { [K in Item["kind"]]: (item: Of<K>) => string } = {
  user_message: userBlock,
  agent_message: (item) => `#### 回答${lanePrefix(item)}${item.complete ? "" : "（未完成）"}\n\n${item.text}`,
  reasoning: (item) => `#### 思考${lanePrefix(item)}\n\n${quote(item.text)}`,
  tool_call: (item) => [`${toolHead(item)}${lanePrefix(item)}`, ...toolBody(item)].join("\n\n"),
  plan: planBlock,
  approval: approvalBlock,
  notice: (item) => `#### 提示（${item.level}）\n\n${item.message}`,
  error: errorBlock,
}

function block(item: Item): string {
  return (RENDER[item.kind] as (item: Item) => string)(item)
}

function header(input: TranscriptInput, turns: number): string {
  const { thread } = input
  const route = stintsOf(thread, input.items, input.engines).map((stint) => input.label(stint.engine))
  return [
    `# 会话转写：${thread.title}`,
    "",
    `- 会话 id：${thread.id}`,
    `- 工作区：${thread.cwd}`,
    `- 生成时间：${isoAt(input.at)}（omni 从会话记录整理）`,
    `- 共 ${String(turns)} 轮；引擎：${route.length === 0 ? input.label(thread.engine) : route.join(" → ")}`,
    "- 记法：每轮标题写着第几轮、开始时间（UTC）、哪家引擎在跑；工具调用行尾〔…〕是引擎自己报的调用 id，用来到它的原始记录里对位。",
  ].join("\n")
}

function lineCount(text: string): number {
  return text.split("\n").length
}

export function transcriptOf(input: TranscriptInput): Transcript {
  const turns = turnsOf(input.items)
  const sections = turns.map((turn, index) => {
    const first = turn.items[0]
    const who = input.label(ownerOf(input.thread, turn, input.engines))
    const when = first === undefined ? "" : ` · ${isoAt(first.at)} · ${who}`
    return [`## 第 ${String(index + 1)} 轮${when}`, ...turn.items.map(block)].join("\n\n")
  })
  const parts = [header(input, turns.length), ...sections]
  const text = `${parts.join("\n\n")}\n`
  // 各段之间空一行：最后一节的起始行＝前面各节行数之和，加上每节后面那一行空行
  const before = parts.slice(0, -1).reduce((sum, part) => sum + lineCount(part) + 1, 0)
  return {
    text,
    lines: lineCount(text) - 1,
    ...(sections.length === 0 ? {} : { lastTurn: { turn: sections.length, line: before + 1 } }),
  }
}
