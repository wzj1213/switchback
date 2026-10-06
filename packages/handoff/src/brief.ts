import type { LogFacts } from "./log-facts.js"
import { isoAt, type Stint } from "./stints.js"

/**
 * 换引擎后第一句话前面那段交接说明。
 *
 * ## 这是 Switchback 往模型上下文里写话的唯一一处
 *
 * AGENTS.md 的边界是「不往模型的上下文里塞 Switchback 写的话」，这里是它唯一的例外：
 * 用户开着「换引擎自动交接」、刚换了一家、发出第一句话时才附，而且**只陈述事实**——
 * 此前谁跑了哪几轮、完整转写在哪、各段原始记录在哪、那份记录实际是什么格式。
 * 不下任务、不评价、不催进度；读不读、读多少由接手的那家自己定。
 * 包在 `<switchback-handoff>` 里，接手的那家分得清哪段是交接、哪段是用户这一句。
 *
 * 纯函数：路径、大小、格式事实都由调用方量好传进来。
 */
export interface BriefLog {
  engine: string
  path: string
  /** 量不到＝文件已经不在这个路径上（此时不看 `facts`）。 */
  bytes: number | undefined
  /** 读出来的格式事实；`large`＝太大没有逐行读，`unreadable`＝读不了。 */
  facts: LogFacts | "large" | "unreadable"
}

export interface BriefInput {
  /** 接手的这一家（人话名）。 */
  engine: string
  /** 此前各段；`engine` 已是人话名。 */
  stints: readonly Stint[]
  transcript: { path: string; lines: number; bytes: number; lastTurn?: { turn: number; line: number } }
  logs: readonly BriefLog[]
}

export function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function count(n: number): string {
  return n.toLocaleString("en-US")
}

function stintLines(stints: readonly Stint[]): readonly string[] {
  let next = 1
  return stints.map((stint) => {
    const range = stint.turns === 1 ? `第 ${String(next)} 轮` : `第 ${String(next)}–${String(next + stint.turns - 1)} 轮`
    next += stint.turns
    return `- ${stint.engine}：${range}，${isoAt(stint.from)} – ${isoAt(stint.to)}`
  })
}

function factsText(facts: LogFacts): string {
  const kind = { jsonl: "JSONL，每行一个 JSON", json: "整份 JSON", text: "纯文本" }[facts.format]
  const parts = [`${kind}，${count(facts.lines)} 行`]
  if (facts.types.length > 0) {
    parts.push(`顶层 type 取值 ${facts.types.slice(0, 6).map(([name, n]) => `${name} ${count(n)}`).join("、")}`)
  }
  if (facts.idPath !== undefined && facts.idSample !== undefined) {
    parts.push(`转写里的原生 id 在这份记录的 ${facts.idPath} 字段，例如 ${facts.idSample}`)
  }
  if (facts.timePath !== undefined) parts.push(`每行的时间戳在 ${facts.timePath} 字段（ISO 8601）`)
  return parts.join("；")
}

function logLine(log: BriefLog): string {
  if (log.bytes === undefined) return `- ${log.engine}：${log.path}（这个路径上已经没有文件了）`
  const facts = log.facts === "large" ? "太大，没有逐行统计格式"
    : log.facts === "unreadable" ? "Switchback 读不了这份文件，没有统计格式" : factsText(log.facts)
  return `- ${log.engine}：${log.path}（${sizeOf(log.bytes)}；${facts}）`
}

function logLines(logs: readonly BriefLog[]): readonly string[] {
  if (logs.length === 0) return ["- 这几家没有报出本地原始记录，只有上面的转写。"]
  return logs.map(logLine)
}

function transcriptLine(t: BriefInput["transcript"]): string {
  const last = t.lastTurn === undefined ? "" : `；最后一轮（第 ${String(t.lastTurn.turn)} 轮）从第 ${count(t.lastTurn.line)} 行开始`
  return `- ${t.path}（${count(t.lines)} 行，${sizeOf(t.bytes)}${last}）`
}

export function briefOf(input: BriefInput): string {
  return [
    "<switchback-handoff>",
    `这条会话中途换了引擎，接下来由 ${input.engine} 接着进行。此前的工作：`,
    ...stintLines(input.stints),
    "",
    "完整转写（Switchback 从会话记录整理：每轮的提问、回答、思考、工具调用与完整输出、改动 diff；按 `## 第 N 轮` 分节，标题里是这一轮的开始时间（UTC），工具调用行尾〔…〕是原生 id）：",
    transcriptLine(input.transcript),
    "",
    "各段原始记录（引擎自己的会话文件，下面的格式是从文件里读出来的）：",
    ...logLines(input.logs),
    "</switchback-handoff>",
  ].join("\n")
}
