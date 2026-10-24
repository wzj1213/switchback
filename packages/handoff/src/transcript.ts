import type { Item, PlanItem, Thread, ToolCallItem } from "@switchback/protocol"
import { isoAt, ownerOf, stintsOf, turnsOf, type TurnEngines } from "./stints.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { TRANSCRIPT } from "./transcript.messages.js"

type Text = (typeof TRANSCRIPT)[Locale]

/**
 * 交接用的会话转写：**尽量无损**，给接手的那家引擎自己去读。
 *
 * 和桌面端「导出 Markdown」（贴到 issue 给人看）不是一回事：那边为可读性压掉了推理、
 * 只留工具标题；这里读者是模型，能留的都留——推理原文、完整命令输出、完整 diff、
 * 审批与报错。工具调用行尾带 `〔原生 id〕`：宿主为全局唯一重铸了条目 id，引擎自己报的那个
 * 留在 `nativeId` 上，拿它去那一段的原始记录里搜就能落到同一次调用。没有 `nativeId`
 *（旧记录）就不标——Switchback 自己铸的 id 在原始记录里搜不到，标上只会让人白搜一趟。
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
  /** 标题与记法用哪种语言（交接那一刻的界面语言）。缺省中文。 */
  locale?: Locale
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

function toolHead(item: ToolCallItem, m: Text): string {
  const detail = item.detail
  const what = detail.kind === "shell" ? m.run(detail.command)
    : detail.kind === "file_edit" ? m.edit(detail.path, detail.added, detail.removed)
    : detail.kind === "file_read" ? m.read(detail.path, detail.range)
    : detail.kind === "fetch" ? m.fetch(detail.url)
    : `${detail.name}`
  return m.tool(item.tool, what, item.status, item.nativeId)
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

type Detail<K extends ToolCallItem["detail"]["kind"]> = Extract<ToolCallItem["detail"], { kind: K }>

function shellBody(detail: Detail<"shell">, m: Text): readonly string[] {
  return [
    ...(detail.exitCode === undefined ? [] : [m.exitCode(detail.exitCode)]),
    ...(detail.output === undefined || detail.output === "" ? [] : [fence(detail.output)]),
  ]
}

function editBody(detail: Detail<"file_edit">, m: Text): readonly string[] {
  return detail.files
    .filter((file) => file.diff !== undefined && file.diff !== "")
    .map((file) => `${m.file(file.path, file.kind)}\n${fence(file.diff ?? "", "diff")}`)
}

function otherBody(detail: Detail<"other">, m: Text): readonly string[] {
  const output = detail.output
  return [
    ...(detail.input === undefined ? [] : [`${m.input}\n${fence(json(detail.input), "json")}`]),
    ...(output === undefined ? [] : [`${m.output}\n${fence(typeof output === "string" ? output : json(output))}`]),
  ]
}

function toolBody(item: ToolCallItem, m: Text): readonly string[] {
  const detail = item.detail
  const body = detail.kind === "shell" ? shellBody(detail, m)
    : detail.kind === "file_edit" ? editBody(detail, m)
    : detail.kind === "other" ? otherBody(detail, m) : []
  return item.error === undefined || item.error === "" ? body : [...body, m.error(item.error)]
}

function planBlock(item: PlanItem, m: Text): string {
  const mark = { pending: " ", in_progress: "~", done: "x", dropped: "-" } as const
  const steps = item.steps.map((step) => `- [${mark[step.status]}] ${step.text}`).join("\n")
  return `${m.plan}\n\n${item.explanation === undefined ? "" : `${item.explanation}\n\n`}${steps}`
}

function lanePrefix(item: Item, m: Text): string {
  return item.lane === undefined ? "" : m.lane(item.lane.id)
}

type Of<K extends Item["kind"]> = Extract<Item, { kind: K }>

function userBlock(item: Of<"user_message">, m: Text): string {
  const who = item.origin === undefined ? m.who.user : item.origin === "handoff" ? m.who.handoff : m.who.auto
  const files = (item.attachments ?? []).length === 0 ? "" : `\n\n${m.attachments(item.attachments ?? [])}`
  return `#### ${who}${lanePrefix(item, m)}\n\n${item.text}${files}`
}

function errorBlock(item: Of<"error">, m: Text): string {
  const detail = item.detail === undefined ? "" : `\n\n${fence(item.detail)}`
  return `${m.errorHead(item.fatal)}\n\n${item.message}${detail}`
}

function approvalBlock(item: Of<"approval">, m: Text): string {
  return `${m.approval(item.tool, item.status)}\n\n${item.summary}${item.reason === "" ? "" : `\n\n${m.reason(item.reason)}`}`
}

const RENDER: { [K in Item["kind"]]: (item: Of<K>, m: Text) => string } = {
  user_message: userBlock,
  agent_message: (item, m) => `${m.answer(lanePrefix(item, m), item.complete)}\n\n${item.text}`,
  reasoning: (item, m) => `${m.thinking(lanePrefix(item, m))}\n\n${quote(item.text)}`,
  tool_call: (item, m) => [`${toolHead(item, m)}${lanePrefix(item, m)}`, ...toolBody(item, m)].join("\n\n"),
  plan: planBlock,
  approval: approvalBlock,
  notice: (item, m) => `${m.notice(item.level)}\n\n${item.message}`,
  error: errorBlock,
}

function block(item: Item, m: Text): string {
  return (RENDER[item.kind] as (item: Item, m: Text) => string)(item, m)
}

function header(input: TranscriptInput, turns: number, m: Text): string {
  const { thread } = input
  const route = stintsOf(thread, input.items, input.engines).map((stint) => input.label(stint.engine))
  return [
    m.title(thread.title),
    "",
    m.id(thread.id),
    m.cwd(thread.cwd),
    m.at(isoAt(input.at)),
    m.turns(turns, route.length === 0 ? input.label(thread.engine) : route.join(" → ")),
    m.legend,
  ].join("\n")
}

function lineCount(text: string): number {
  return text.split("\n").length
}

export function transcriptOf(input: TranscriptInput): Transcript {
  const m = TRANSCRIPT[input.locale ?? DEFAULT_LOCALE]
  const turns = turnsOf(input.items)
  const sections = turns.map((turn, index) => {
    const first = turn.items[0]
    const who = input.label(ownerOf(input.thread, turn, input.engines))
    const when = first === undefined ? "" : ` · ${isoAt(first.at)} · ${who}`
    return [m.turn(index + 1, when), ...turn.items.map((item) => block(item, m))].join("\n\n")
  })
  const parts = [header(input, turns.length, m), ...sections]
  const text = `${parts.join("\n\n")}\n`
  // 各段之间空一行：最后一节的起始行＝前面各节行数之和，加上每节后面那一行空行
  const before = parts.slice(0, -1).reduce((sum, part) => sum + lineCount(part) + 1, 0)
  return {
    text,
    lines: lineCount(text) - 1,
    ...(sections.length === 0 ? {} : { lastTurn: { turn: sections.length, line: before + 1 } }),
  }
}
