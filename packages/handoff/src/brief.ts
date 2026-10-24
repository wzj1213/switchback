import type { LogFacts } from "./log-facts.js"
import { isoAt, type Stint } from "./stints.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { BRIEF } from "./brief.messages.js"

type Text = (typeof BRIEF)[Locale]

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
  /** 用哪种语言说（交接那一刻的界面语言）。缺省中文；转写要用同一种。 */
  locale?: Locale
}

export function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function count(n: number): string {
  return n.toLocaleString("en-US")
}

function stintLines(stints: readonly Stint[], m: Text): readonly string[] {
  let next = 1
  return stints.map((stint) => {
    const range = stint.turns === 1 ? m.turnOne(next) : m.turnRange(next, next + stint.turns - 1)
    next += stint.turns
    return m.stint(stint.engine, range, isoAt(stint.from), isoAt(stint.to))
  })
}

function factsText(facts: LogFacts, m: Text): string {
  const parts = [m.lines(m.format[facts.format], count(facts.lines))]
  if (facts.types.length > 0) {
    parts.push(m.types(facts.types.slice(0, 6).map(([name, n]) => `${name} ${count(n)}`)))
  }
  if (facts.idPath !== undefined && facts.idSample !== undefined) {
    parts.push(m.idAt(facts.idPath === "" ? m.wholeLine : facts.idPath, facts.idSample))
  }
  if (facts.timePath !== undefined) parts.push(m.timeAt(facts.timePath))
  return m.join(parts)
}

function logLine(log: BriefLog, m: Text): string {
  if (log.bytes === undefined) return m.gone(log.engine, log.path)
  const facts = log.facts === "large" ? m.large
    : log.facts === "unreadable" ? m.unreadable : factsText(log.facts, m)
  return m.log(log.engine, log.path, sizeOf(log.bytes), facts)
}

function logLines(logs: readonly BriefLog[], m: Text): readonly string[] {
  if (logs.length === 0) return [m.noLogs]
  return logs.map((log) => logLine(log, m))
}

function transcriptLine(t: BriefInput["transcript"], m: Text): string {
  const last = t.lastTurn === undefined ? "" : m.lastTurn(t.lastTurn.turn, count(t.lastTurn.line))
  return m.transcript(t.path, count(t.lines), sizeOf(t.bytes), last)
}

export function briefOf(input: BriefInput): string {
  const m = BRIEF[input.locale ?? DEFAULT_LOCALE]
  return [
    "<switchback-handoff>",
    m.intro(input.engine),
    ...stintLines(input.stints, m),
    "",
    m.transcriptHead,
    transcriptLine(input.transcript, m),
    "",
    m.logsHead,
    ...logLines(input.logs, m),
    "</switchback-handoff>",
  ].join("\n")
}
