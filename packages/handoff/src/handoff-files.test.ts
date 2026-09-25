import { describe, expect, it } from "vitest"
import type { Event, Item, Thread } from "@omni/protocol"
import { briefOf, logFacts, stintsOf, transcriptOf, turnEnginesOf } from "./index.js"

const T0 = Date.UTC(2026, 7, 25, 2, 0, 0)
const thread: Thread = {
  id: "th-1", title: "抽出纯函数", cwd: "/work/app", engine: "codex", trust: "auto-edit", status: "idle",
  createdAt: T0, updatedAt: T0, engineHistory: ["claude", "codex"],
  segments: [
    { engine: "claude", handle: "s-1", logPath: "/home/.claude/projects/app/s-1.jsonl", startedAt: T0 },
    { engine: "codex", handle: "t-9", startedAt: T0 + 3_600_000 },
  ],
}
const at = (minutes: number): number => T0 + minutes * 60_000
const items: readonly Item[] = [
  { id: "u1", turnId: "a", kind: "user_message", at: at(1), text: "把 drain 抽出来" },
  { id: "r1", turnId: "a", kind: "reasoning", at: at(2), text: "先看 useFlow\n再拆", complete: true },
  { id: "it-3", nativeId: "toolu_01A", turnId: "a", kind: "tool_call", at: at(3), tool: "Bash", status: "ok",
    detail: { kind: "shell", command: "pnpm test", exitCode: 0, output: "```\nok\n```" } },
  { id: "it-4", turnId: "a", kind: "tool_call", at: at(4), tool: "Edit", status: "ok",
    detail: { kind: "file_edit", path: "src/a.ts", added: 1, removed: 1,
      files: [{ path: "src/a.ts", kind: "update", added: 1, removed: 1, diff: "-a\n+b" }] } },
  { id: "m1", turnId: "a", kind: "agent_message", at: at(5), text: "抽好了", complete: true },
  { id: "u2", turnId: "b", kind: "user_message", at: at(70), text: "继续" },
  { id: "p1", turnId: "b", kind: "plan", at: at(71), steps: [{ text: "写测试", status: "pending" }, { text: "拆文件", status: "done" }] },
]
const label = (id: string): string => ({ claude: "Claude Code", codex: "Codex" })[id] ?? id

describe("交接转写", () => {
  const { text: md, lines, lastTurn } = transcriptOf({ thread, items, label, at: at(80) })
  const cases = [
    ["标题与会话 id", "# 会话转写：抽出纯函数"],
    ["头部写出引擎接力的顺序", "- 共 2 轮；引擎：Claude Code → Codex"],
    ["轮次按时间归到引擎", "## 第 1 轮 · 2026-08-25T02:01:00Z · Claude Code"],
    ["换家之后归新引擎", "## 第 2 轮 · 2026-08-25T03:10:00Z · Codex"],
    ["推理原文保留", "> 先看 useFlow\n> 再拆"],
    ["工具调用带原生 id", "#### 工具 Bash：执行 `pnpm test` — ok〔toolu_01A〕"],
    ["输出里有围栏时加长外围栏", "````\n```\nok\n```\n````"],
    ["diff 完整保留", "src/a.ts（update）\n```diff\n-a\n+b\n```"],
    ["计划的勾选状态", "- [ ] 写测试\n- [x] 拆文件"],
  ] as const
  for (const [name, needle] of cases) {
    it(name, () => { expect(md).toContain(needle) })
  }
  it("没有原生 id 的（旧记录）不标：omni 自己铸的 id 在原始记录里搜不到", () => {
    expect(md).toContain("#### 工具 Edit：编辑 src/a.ts（+1 −1） — ok\n")
    expect(md).not.toContain("it-4")
  })
  it("行数与最后一轮的起始行对得上正文", () => {
    const rows = md.split("\n")
    expect(rows.length - 1).toBe(lines)
    expect(lastTurn?.turn).toBe(2)
    expect(rows[(lastTurn?.line ?? 0) - 1]).toBe("## 第 2 轮 · 2026-08-25T03:10:00Z · Codex")
  })
  it("一轮都没有时不报最后一轮", () => {
    expect(transcriptOf({ thread, items: [], label, at: at(80) }).lastTurn).toBeUndefined()
  })
})

describe("按引擎分段", () => {
  it("同一家连着跑的轮次并成一段", () => {
    expect(stintsOf(thread, items).map((s) => [s.engine, s.turns])).toEqual([["claude", 1], ["codex", 1]])
  })
  // 换家后第一轮的分段可能要等它跑完才落（句柄晚到），按时间推断会把它算给前一家
  const late: Thread = { ...thread, segments: [{ engine: "claude", handle: "s-1", startedAt: T0 }] }
  const started = (id: string, engine: string): Event =>
    ({ type: "turn.started", at: 0, turn: { id, threadId: "th-1", engine, status: "running", startedAt: 0 } })
  const cases = [
    ["只有分段：第二轮被推断给 claude", undefined, [["claude", 2]]],
    ["有 turn.started：按记录归属", turnEnginesOf([started("a", "claude"), started("b", "codex")]), [["claude", 1], ["codex", 1]]],
    ["记录缺了某一轮：那一轮退回按时间推断", turnEnginesOf([started("b", "codex")]), [["claude", 1], ["codex", 1]]],
  ] as const
  for (const [name, engines, want] of cases) {
    it(name, () => { expect(stintsOf(late, items, engines).map((s) => [s.engine, s.turns])).toEqual(want) })
  }
  it("转写的轮次标题也按记录归属", () => {
    const { text } = transcriptOf({ thread: late, items, label, at: at(80), engines: turnEnginesOf([started("b", "codex")]) })
    expect(text).toContain("## 第 2 轮 · 2026-08-25T03:10:00Z · Codex")
  })
})

const stamped = (key: string): string =>
  [1, 2, 3].map((n) => JSON.stringify({ type: "x", [key]: `2026-09-25T01:0${String(n)}:00.123Z` })).join("\n")
const nested = [1, 2].map((n) => JSON.stringify({ type: "x", meta: { at: `2026-09-25T01:0${String(n)}:00Z` } })).join("\n")

describe("原始记录的事实", () => {
  const jsonl = [
    JSON.stringify({ type: "user", message: { content: "hi" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_01A" }] } }),
    JSON.stringify({ type: "assistant", message: { content: [] } }),
    "{\"type\":\"assist",
  ].join("\n")
  const cases = [
    ["JSONL 与行数（容忍半截最后一行）", jsonl, ["toolu_01A"], { format: "jsonl", lines: 4 }],
    ["type 取值按条数排", jsonl, [], { types: [["assistant", 2], ["user", 1]] }],
    ["已知 id 落在哪个字段", jsonl, ["missing", "toolu_01A"], { idPath: "message.content[].id", idSample: "toolu_01A" }],
    ["整份 JSON", "{\n\"a\": 1\n}", [], { format: "json", types: [] }],
    ["纯文本", "hello\nworld", [], { format: "text", lines: 2 }],
    ["顶层时间戳字段", stamped("timestamp"), [], { timePath: "timestamp" }],
    ["下一层的时间戳字段", nested, [], { timePath: "meta.at" }],
  ] as const
  for (const [name, content, ids, expected] of cases) {
    it(name, () => { expect(logFacts(content, ids)).toMatchObject(expected) })
  }
})

describe("交接说明", () => {
  const brief = briefOf({
    engine: "Codex",
    stints: [{ engine: "Claude Code", from: at(1), to: at(5), turns: 12 }],
    transcript: { path: "/work/app/.omni/handoff/th-1.md", lines: 1234, bytes: 220_000, lastTurn: { turn: 12, line: 1180 } },
    logs: [
      { engine: "Claude Code", path: "/home/.claude/projects/app/s-1.jsonl", bytes: 9_000_000,
        facts: { format: "jsonl", lines: 4210, types: [["assistant", 1980]], idPath: "message.content[].id", idSample: "toolu_01A", timePath: "timestamp" } },
      { engine: "Gemini", path: "/home/.gemini/big.json", bytes: 90_000_000, facts: "large" },
      { engine: "Grok", path: "/home/.grok/locked.jsonl", bytes: 20, facts: "unreadable" },
      { engine: "Kimi", path: "/home/.kimi/gone.jsonl", bytes: undefined, facts: "unreadable" },
    ],
  })
  const cases = [
    ["包在交接标签里", "<omni-handoff>"],
    ["此前谁跑了哪几轮", "- Claude Code：第 1–12 轮，2026-08-25T02:01:00Z – 2026-08-25T02:05:00Z"],
    ["转写路径、体积与最后一轮的位置", "- /work/app/.omni/handoff/th-1.md（1,234 行，215 KB；最后一轮（第 12 轮）从第 1,180 行开始）"],
    ["原始记录的格式事实", "JSONL，每行一个 JSON，4,210 行；顶层 type 取值 assistant 1,980；转写里的原生 id 在这份记录的 message.content[].id 字段，例如 toolu_01A；每行的时间戳在 timestamp 字段（ISO 8601）"],
    ["太大的记录只报路径与体积", "- Gemini：/home/.gemini/big.json（85.8 MB；太大，没有逐行统计格式）"],
    ["读不了的记录照直说", "- Grok：/home/.grok/locked.jsonl（20 B；omni 读不了这份文件，没有统计格式）"],
    ["路径上已经没有文件", "- Kimi：/home/.kimi/gone.jsonl（这个路径上已经没有文件了）"],
  ] as const
  for (const [name, needle] of cases) {
    it(name, () => { expect(brief).toContain(needle) })
  }
  it("没有原始记录时照直说", () => {
    expect(briefOf({ engine: "Codex", stints: [], transcript: { path: "/x.md", lines: 1, bytes: 10 }, logs: [] }))
      .toContain("这几家没有报出本地原始记录")
  })
  it("不写任何让模型去做的事", () => {
    expect(brief).not.toMatch(/请|务必|你需要|应该/)
  })
})
