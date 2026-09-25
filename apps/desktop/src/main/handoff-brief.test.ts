import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Event, Item, Thread } from "@omni/protocol"
import { createHandoffBrief } from "./handoff-brief.js"

const T0 = Date.UTC(2026, 8, 25, 1, 0, 0)
const LABELS: Readonly<Record<string, string>> = { claude: "Claude Code", codex: "Codex" }

interface Fixture {
  root: string
  cwd: string
  spare: string
  log: string
}

function threadOf(fx: Fixture, patch: Partial<Thread> = {}): Thread {
  return {
    id: "th-1", title: "抽出纯函数", cwd: fx.cwd, engine: "codex", trust: "auto-edit", status: "idle",
    createdAt: T0, updatedAt: T0, engineHistory: ["claude", "codex"],
    segments: [{ engine: "claude", handle: "s-1", logPath: fx.log, startedAt: T0 }],
    ...patch,
  }
}

function eventsOf(thread: Thread): readonly Event[] {
  const turn = { id: "tn-1", threadId: thread.id, engine: "claude", status: "running" as const, startedAt: T0 }
  const items: readonly Item[] = [
    { id: "it-1", turnId: "tn-1", kind: "user_message", at: T0 + 1000, text: "把 drain 抽出来" },
    { id: "it-2", nativeId: "toolu_01A", turnId: "tn-1", kind: "tool_call", at: T0 + 2000, tool: "Bash", status: "ok",
      detail: { kind: "shell", command: "pnpm test", exitCode: 0, output: "ok" } },
    { id: "it-3", turnId: "tn-1", kind: "agent_message", at: T0 + 3000, text: "额度用完前抽好了一半", complete: true },
  ]
  return [
    { type: "thread.started", at: T0, thread },
    { type: "turn.started", at: T0, turn },
    ...items.map((item): Event => ({ type: "item.started", at: item.at, item })),
    { type: "turn.completed", at: T0 + 4000, turnId: "tn-1", status: "completed" },
  ]
}

function briefFor(fx: Fixture, events: readonly Event[], enabled = true): ReturnType<typeof createHandoffBrief> {
  return createHandoffBrief({
    journal: { flush: () => Promise.resolve(), read: () => Promise.resolve(events) },
    enabled: () => enabled,
    label: (id) => LABELS[id] ?? id,
    spareDir: fx.spare,
    now: () => T0 + 60_000,
  })
}

const RAW = [
  JSON.stringify({ type: "user", timestamp: "2026-09-25T01:00:01.100Z", message: { content: "把 drain 抽出来" } }),
  JSON.stringify({ type: "assistant", timestamp: "2026-09-25T01:00:02.100Z", message: { content: [{ type: "tool_use", id: "toolu_01A", name: "Bash" }] } }),
  JSON.stringify({ type: "user", timestamp: "2026-09-25T01:00:02.900Z", message: { content: [{ type: "tool_result", tool_use_id: "toolu_01A" }] } }),
].join("\n")

describe("换引擎交接说明（主进程）", () => {
  const fx: Fixture = { root: "", cwd: "", spare: "", log: "" }

  beforeEach(async () => {
    fx.root = await mkdtemp(join(tmpdir(), "omni-handoff-"))
    fx.cwd = join(fx.root, "work")
    fx.spare = join(fx.root, "userData", "handoff")
    fx.log = join(fx.root, "claude", "s-1.jsonl")
    await mkdir(fx.cwd, { recursive: true })
    await mkdir(join(fx.root, "claude"), { recursive: true })
    await writeFile(fx.log, RAW, "utf8")
  })

  afterEach(async () => {
    await rm(fx.root, { recursive: true, force: true })
  })

  it("开着：转写写进工作区 .omni/handoff/，说明里带路径、分段与原始记录的格式事实", async () => {
    const thread = threadOf(fx)
    const note = await briefFor(fx, eventsOf(thread))(thread)
    const path = join(fx.cwd, ".omni", "handoff", "th-1.md")
    expect(note).toContain("接下来由 Codex 接着进行")
    expect(note).toContain("- Claude Code：第 1 轮，2026-09-25T01:00:01Z – 2026-09-25T01:00:03Z")
    expect(note).toContain(`- ${path}（`)
    expect(note).toContain("最后一轮（第 1 轮）从第")
    expect(note).toContain(`- Claude Code：${fx.log}（`)
    expect(note).toContain("JSONL，每行一个 JSON，3 行；顶层 type 取值 user 2、assistant 1")
    expect(note).toContain("转写里的原生 id 在这份记录的 message.content[].id 字段，例如 toolu_01A；每行的时间戳在 timestamp 字段（ISO 8601）")
    const md = await readFile(path, "utf8")
    expect(md).toContain("## 第 1 轮 · 2026-09-25T01:00:01Z · Claude Code")
    expect(md).toContain("#### 工具 Bash：执行 `pnpm test` — ok〔toolu_01A〕")
    expect(await readFile(join(fx.cwd, ".omni", ".gitignore"), "utf8")).toContain("\n*\n")
  })

  it("用户在 .omni 里自己写过 .gitignore：不覆盖", async () => {
    await mkdir(join(fx.cwd, ".omni"), { recursive: true })
    await writeFile(join(fx.cwd, ".omni", ".gitignore"), "handoff/\n", "utf8")
    const thread = threadOf(fx)
    await briefFor(fx, eventsOf(thread))(thread)
    expect(await readFile(join(fx.cwd, ".omni", ".gitignore"), "utf8")).toBe("handoff/\n")
  })

  it("工作区写不进去：转写退到应用数据目录", async () => {
    // 工作区路径上是个文件，mkdir 必然失败
    const blocked = join(fx.root, "blocked")
    await writeFile(blocked, "", "utf8")
    const thread = threadOf(fx, { cwd: blocked })
    const note = await briefFor(fx, eventsOf(thread))(thread)
    expect(note).toContain(`- ${join(fx.spare, "th-1.md")}（`)
    expect(await readFile(join(fx.spare, "th-1.md"), "utf8")).toContain("# 会话转写：抽出纯函数")
  })

  const quiet: readonly { name: string; enabled: boolean; events: (thread: Thread) => readonly Event[] }[] = [
    { name: "关着", enabled: false, events: eventsOf },
    { name: "一条记录都没有", enabled: true, events: (thread) => [{ type: "thread.started", at: T0, thread }] },
  ]
  for (const c of quiet) {
    it(`${c.name}：不附说明，也不往工作区写东西`, async () => {
      const thread = threadOf(fx)
      expect(await briefFor(fx, c.events(thread), c.enabled)(thread)).toBeUndefined()
      await expect(readFile(join(fx.cwd, ".omni", "handoff", "th-1.md"), "utf8")).rejects.toThrow()
    })
  }

  it("原始记录已经不在了：照直说，不因此不交接", async () => {
    await rm(fx.log)
    const thread = threadOf(fx)
    expect(await briefFor(fx, eventsOf(thread))(thread)).toContain(`${fx.log}（这个路径上已经没有文件了）`)
  })

  it("换回之前那家：它正在续的那条会话不列（它自己记得），别家的照列", async () => {
    const codexLog = join(fx.root, "codex.jsonl")
    await writeFile(codexLog, "{\"type\":\"session_meta\"}\n", "utf8")
    const thread = threadOf(fx, {
      engine: "claude",
      engineHandle: "s-1",
      segments: [
        { engine: "claude", handle: "s-1", logPath: fx.log, startedAt: T0 },
        { engine: "codex", handle: "t-9", logPath: codexLog, startedAt: T0 + 10_000 },
      ],
    })
    const note = await briefFor(fx, eventsOf(thread))(thread) ?? ""
    expect(note).toContain(`- Codex：${codexLog}（`)
    expect(note).not.toContain(fx.log)
  })
})
