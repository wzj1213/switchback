import type { Item, Thread, ToolCallItem, UserMessageItem } from "@switchback/protocol"
import type { Locale } from "@switchback/i18n"
import { shellTranscript, target, verbOf } from "./tool.js"
import { EXPORT } from "./export.messages.js"

/**
 * 把一段会话导成 Markdown。
 *
 * 用途是**贴到别处去**——issue、评审、给同事看。所以格式上有两条取舍：
 *
 * - 工具调用保留但压成一行标题 + 折叠的输出。原样贴几百行 stdout 进 issue
 *   没有人会读，但完全不提又会让「它到底做了什么」不可考。
 * - `reasoning` **不导出**。那是模型的内部草稿，不是给第三个人看的东西。
 */

const FENCE = "```"

function fence(text: string, lang = ""): string {
  // 内容里本来就有围栏时用更长的围栏，否则代码块会被内容提前闭合
  const longest = /`{3,}/g.exec(text)?.[0] ?? ""
  const bar = longest.length >= FENCE.length ? "`".repeat(longest.length + 1) : FENCE
  return `${bar}${lang}\n${text.replace(/\n$/, "")}\n${bar}`
}

function toolBlock(item: ToolCallItem, locale: Locale): string {
  const head = `**${verbOf(item.detail.kind, locale)}** \`${target(item.detail, locale)}\` — ${item.status}`
  if (item.detail.kind === "file_edit") {
    const files = item.detail.files
      .filter((f) => f.diff !== undefined && f.diff !== "")
      .map((f) => `${f.path}\n${fence(f.diff ?? "", "diff")}`)
    return files.length === 0 ? head : `${head}\n\n${files.join("\n\n")}`
  }
  if (item.detail.kind === "shell") {
    const transcript = shellTranscript(item.detail, locale)
    if (transcript !== undefined && transcript !== "") return `${head}\n\n${fence(transcript)}`
  }
  return head
}

function userHeading(item: UserMessageItem, locale: Locale): string {
  const m = EXPORT[locale]
  if (item.origin === undefined) return m.you
  if (item.origin === "handoff") return m.handoff
  if (item.origin.kind === "shell") return m.shell
  return item.origin.kind === "goal_continuation" ? m.goal : m.scheduled
}

function block(item: Item, engineLabel: string, locale: Locale): string | undefined {
  const m = EXPORT[locale]
  switch (item.kind) {
    case "user_message":
      return `### ${userHeading(item, locale)}${item.text === "" ? "" : `\n\n${item.text}`}`
    case "agent_message":
      return `### ${engineLabel}\n\n${item.text}`
    case "tool_call":
      return toolBlock(item, locale)
    case "plan":
      return `**${m.plan}**\n\n${item.steps.map((s) => `- [${s.status === "done" ? "x" : " "}] ${s.text}`).join("\n")}`
    case "approval":
      return m.approval(item.summary, item.status, item.reason)
    case "notice":
      return `> **${m.notice(item.level)}**\n>\n> ${item.message.replace(/\n/g, "\n> ")}`
    case "error":
      // 引擎补的那句原因一并带走。**报错是最要靠原文的东西**——
      // 导出的那份是拿去开 issue、拿去搜的，少一句就少一条线索
      return `> ⚠️ ${item.message}${item.detail === undefined ? "" : `\n> ${item.detail}`}`
    // 模型的内部草稿不导出——那不是给第三个人看的东西
    case "reasoning":
      return undefined
  }
}

export function toMarkdown(thread: Thread, items: readonly Item[], engineLabel: string, locale: Locale): string {
  const head = `# ${thread.title}\n\n> ${EXPORT[locale].head(thread.cwd, engineLabel)}`
  const body = items
    .map((item) => block(item, engineLabel, locale))
    .filter((b): b is string => b !== undefined)
  return `${[head, ...body].join("\n\n")}\n`
}

/** 单条消息的可复制文本。工具调用复制的是它执行的东西，不是它的标题。 */
export function textOf(item: Item, locale: Locale): string {
  if (item.kind === "user_message" || item.kind === "agent_message" || item.kind === "reasoning") {
    return item.text
  }
  if (item.kind === "tool_call") return target(item.detail, locale)
  if (item.kind === "error") return item.detail === undefined ? item.message : `${item.message}\n${item.detail}`
  if (item.kind === "notice") return item.message
  if (item.kind === "approval") return `${item.summary}\n${item.reason}`
  return item.steps.map((s) => s.text).join("\n")
}
