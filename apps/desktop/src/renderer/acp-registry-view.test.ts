import { describe, expect, it } from "vitest"
import type { AcpEngineRow, RegistryRow, RegistryView } from "../shared/acp-registry.js"
import { ageOf, builtinTwin, commandLine, filterRows, planText, sizeOf, updateOf } from "./acp-registry-view.js"

const row = (id: string, name: string, extra: Partial<RegistryRow> = {}): RegistryRow => ({ id, name, version: "1.0.0", authors: [], ...extra })
const ROWS = [
  row("gemini", "Gemini CLI", { description: "Google's official CLI", authors: ["Google"] }),
  row("goose", "goose", { description: "open source agent by Block" }),
  row("qwen-code", "Qwen Code", { authors: ["Alibaba Qwen Team"] }),
]

describe("filterRows", () => {
  const table: readonly [string, readonly string[]][] = [
    ["", ["gemini", "goose", "qwen-code"]],
    ["GOOGLE", ["gemini"]],
    ["block", ["goose"]],
    ["qwen team", ["qwen-code"]],
    ["qwen google", []],
    ["  ", ["gemini", "goose", "qwen-code"]],
  ]
  for (const [query, want] of table) {
    it(JSON.stringify(query), () => expect(filterRows(ROWS, query).map((r) => r.id)).toEqual(want))
  }
})

describe("ageOf", () => {
  const now = 1_000 * 60 * 60 * 24 * 10
  const table: readonly [number | undefined, string][] = [
    [undefined, "还没取到过"],
    [now - 10_000, "刚刚取的"],
    [now - 12 * 60_000, "12 分钟前取的"],
    [now - 3 * 60 * 60_000, "3 小时前取的"],
    [now - 5 * 24 * 60 * 60_000, "5 天前取的"],
    [now + 60_000, "刚刚取的"],
  ]
  for (const [at, want] of table) it(want, () => expect(ageOf(at, now, "zh-CN")).toBe(want))
})

describe("sizeOf / commandLine", () => {
  it("字节数", () => {
    expect(sizeOf(512 * 1024)).toBe("512 KB")
    expect(sizeOf(45.6 * 1024 * 1024)).toBe("45.6 MB")
  })
  it("只给真带空白或引号的参数加引号——和终端里看到的一样", () => {
    expect(commandLine("npx", ["-y", "@google/gemini-cli@0.61.0", "--acp"])).toBe("npx -y @google/gemini-cli@0.61.0 --acp")
    expect(commandLine("uvx", ["fast-agent-acp==0.10.1", "-x"])).toBe("uvx fast-agent-acp==0.10.1 -x")
    expect(commandLine("/Apps/My Agent/bin", ["it's"])).toBe(`'/Apps/My Agent/bin' 'it'\\''s'`)
  })
})

describe("planText", () => {
  it("npx：说出要执行的那一行，以及第一次会下载什么", () => {
    const text = planText({ kind: "npx", command: "npx", args: ["-y", "@google/gemini-cli@0.61.0", "--acp"], package: "@google/gemini-cli@0.61.0" }, "zh-CN")
    expect(text.what).toBe("运行 npx -y @google/gemini-cli@0.61.0 --acp")
    expect(text.note).toContain("@google/gemini-cli@0.61.0")
    expect(text.note).toContain("npm")
  })
  it("二进制：下载地址、有没有校验值、之后怎么起", () => {
    const text = planText({ kind: "binary", archive: "https://x/goose.tar.bz2", cmd: "./goose", args: ["acp"], sha256: "a".repeat(64) }, "zh-CN")
    expect(text.what).toBe("下载 https://x/goose.tar.bz2")
    expect(text.note).toContain("sha256")
    expect(text.note).toContain("./goose acp")
    expect(planText({ kind: "binary", archive: "https://x/y", cmd: "./y", args: [] }, "zh-CN").note).toContain("没给校验值")
  })
})

describe("updateOf", () => {
  const engine: AcpEngineRow = { name: "gemini", id: "acp:gemini", label: "Gemini CLI", command: "npx", args: [], source: { id: "gemini", version: "0.60.0", kind: "npx" }, inUse: false }
  const view = (update: boolean, name = "gemini"): RegistryView => ({
    source: "cache", rows: [row("gemini", "Gemini CLI", { version: "0.61.0", connected: { name, version: "0.60.0", update } })],
  })
  it("注册表说有新版，而且说的就是这一条", () => expect(updateOf(engine, view(true))).toBe("0.61.0"))
  it("没有新版、说的是别的条目、手接的、还没取到清单：都没有", () => {
    expect(updateOf(engine, view(false))).toBeUndefined()
    expect(updateOf(engine, view(true, "other"))).toBeUndefined()
    expect(updateOf({ ...engine, source: undefined }, view(true))).toBeUndefined()
    expect(updateOf(engine, undefined)).toBeUndefined()
  })
})

describe("builtinTwin", () => {
  const table: readonly [string, string | undefined][] = [
    ["claude-acp", "Claude Code"],
    ["codex-acp", "Codex"],
    ["grok-build", "Grok"],
    ["kimi", "Kimi Code"],
    ["gemini", undefined],
    ["__proto__", undefined],
  ]
  for (const [id, want] of table) it(id, () => expect(builtinTwin(id)).toBe(want))
})
