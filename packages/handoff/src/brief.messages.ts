import { defineMessages } from "@switchback/i18n"

/**
 * 交接说明。只陈述事实：此前谁跑了哪几轮、转写与各段原始记录在哪、它们实际是什么格式。
 * 给接手的那家读，也原样显示在转录区，所以跟着交接那一刻的界面语言。
 * 和转写里的分节标题、id 记号要说同一种话（见 `transcript.messages.ts`）。
 */
export const BRIEF = defineMessages(
  {
    turnOne: (n: number) => `第 ${String(n)} 轮`,
    turnRange: (from: number, to: number) => `第 ${String(from)}–${String(to)} 轮`,
    stint: (engine: string, range: string, from: string, to: string) => `- ${engine}：${range}，${from} – ${to}`,
    format: { jsonl: "JSONL，每行一个 JSON", json: "整份 JSON", text: "纯文本" },
    lines: (kind: string, n: string) => `${kind}，${n} 行`,
    types: (pairs: readonly string[]) => `顶层 type 取值 ${pairs.join("、")}`,
    idAt: (path: string, sample: string) => `转写里的原生 id 在这份记录的 ${path} 字段，例如 ${sample}`,
    wholeLine: "(整行)",
    timeAt: (path: string) => `每行的时间戳在 ${path} 字段（ISO 8601）`,
    join: (parts: readonly string[]) => parts.join("；"),
    gone: (engine: string, path: string) => `- ${engine}：${path}（这个路径上已经没有文件了）`,
    large: "太大，没有逐行统计格式",
    unreadable: "Switchback 读不了这份文件，没有统计格式",
    log: (engine: string, path: string, size: string, facts: string) => `- ${engine}：${path}（${size}；${facts}）`,
    noLogs: "- 这几家没有报出本地原始记录，只有上面的转写。",
    lastTurn: (turn: number, line: string) => `；最后一轮（第 ${String(turn)} 轮）从第 ${line} 行开始`,
    transcript: (path: string, lines: string, size: string, last: string) => `- ${path}（${lines} 行，${size}${last}）`,
    intro: (engine: string) => `这条会话中途换了引擎，接下来由 ${engine} 接着进行。此前的工作：`,
    transcriptHead:
      "完整转写（Switchback 从会话记录整理：每轮的提问、回答、思考、工具调用与完整输出、改动 diff；" +
      "按 `## 第 N 轮` 分节，标题里是这一轮的开始时间（UTC），工具调用行尾〔…〕是原生 id）：",
    logsHead: "各段原始记录（引擎自己的会话文件，下面的格式是从文件里读出来的）：",
  },
  {
    turnOne: (n) => `turn ${String(n)}`,
    turnRange: (from, to) => `turns ${String(from)}–${String(to)}`,
    stint: (engine, range, from, to) => `- ${engine}: ${range}, ${from} – ${to}`,
    format: { jsonl: "JSONL, one JSON object per line", json: "a single JSON document", text: "plain text" },
    lines: (kind, n) => `${kind}, ${n} lines`,
    types: (pairs) => `top-level type values ${pairs.join(", ")}`,
    idAt: (path, sample) => `the native ids in the transcript are in this record's ${path} field, e.g. ${sample}`,
    wholeLine: "(the whole line)",
    timeAt: (path) => `each line's timestamp is in the ${path} field (ISO 8601)`,
    join: (parts) => parts.join("; "),
    gone: (engine, path) => `- ${engine}: ${path} (there's no file at this path anymore)`,
    large: "too large; no per-line format stats",
    unreadable: "Switchback can't read this file; no format stats",
    log: (engine, path, size, facts) => `- ${engine}: ${path} (${size}; ${facts})`,
    noLogs: "- These engines didn't report any local raw records; there's only the transcript above.",
    lastTurn: (turn, line) => `; the last turn (turn ${String(turn)}) starts at line ${line}`,
    transcript: (path, lines, size, last) => `- ${path} (${lines} lines, ${size}${last})`,
    intro: (engine) => `This thread switched engines partway through; ${engine} continues from here. The work so far:`,
    transcriptHead:
      "Full transcript (compiled by Switchback from the thread's records: each turn's prompt, answer, thinking, tool calls with full output, and diffs; " +
      "sectioned by `## Turn N`, each heading carrying that turn's start time (UTC); the [...] at the end of a tool line is the native id):",
    logsHead: "Raw records for each stretch (the engines' own session files; the formats below were read from the files):",
  },
)
