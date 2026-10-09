import { describe, expect, it } from "vitest"
import type { EngineInfo, Thread } from "@switchback/protocol"
import { cannotRevive, historyNote } from "./history-note.js"

const thread: Thread = {
  id: "t",
  title: "旧会话",
  cwd: "/w",
  engine: "codex",
  trust: "auto-edit",
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["codex"],
  engineHandle: "h",
  detached: true,
}

const engines: readonly EngineInfo[] = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
]

describe("历史会话的输入框说什么", () => {
  const cases: readonly {
    name: string
    patch: Partial<Thread>
    list?: readonly EngineInfo[]
    want: { text: string; held: boolean } | undefined
  }[] = [
    { name: "活会话不说", patch: { detached: false }, want: undefined },
    {
      name: "原来那家还在：直接发就接回",
      patch: {},
      want: { text: "历史会话：直接发话，会先接回 Codex 原来的会话。", held: false },
    },
    {
      name: "挑过另一家：发出去由它接着做",
      patch: { nextEngine: "claude" },
      want: { text: "历史会话：发出去由 Claude Code 接着做。", held: false },
    },
    {
      name: "原来那家不在列表里：提示换一家，但不拦（列表可能还没探完）",
      patch: { engine: "acp:gone", engineHistory: ["acp:gone"] },
      want: { text: "引擎列表里已经没有 acp:gone——在下面换一家接着做；直接发会先试着接回它。", held: false },
    },
    {
      name: "关掉的那家：显示用的清单补了它（名字照样有），清单本身没有它",
      patch: {},
      list: [{ id: "claude", label: "Claude Code" }],
      want: { text: "引擎列表里已经没有 Codex——在下面换一家接着做；直接发会先试着接回它。", held: false },
    },
    {
      name: "引擎清单还没到时不下「不在了」的结论",
      patch: { engine: "acp:gone", engineHistory: ["acp:gone"] },
      list: [],
      want: { text: "历史会话：直接发话，会先接回 acp:gone 原来的会话。", held: false },
    },
    {
      name: "没留句柄、也没换家：宿主必拒，发送键灰着",
      patch: { engineHandle: undefined },
      want: {
        text: "这条会话没留下 Codex 的会话句柄，接不回原来的上下文——在下面换一家引擎接着做。",
        held: true,
      },
    },
    {
      name: "没留句柄但换了一家：照样能发",
      patch: { engineHandle: undefined, nextEngine: "claude" },
      want: { text: "历史会话：发出去由 Claude Code 接着做。", held: false },
    },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(historyNote({ ...thread, ...c.patch }, engines, c.list ?? engines)).toEqual(c.want)
    })
  }

  it("「接不回来」只认历史会话：活会话没有句柄是还没跑过第一轮，不是接不回", () => {
    expect(cannotRevive({ ...thread, engineHandle: undefined, detached: false })).toBe(false)
    expect(cannotRevive({ ...thread, engineHandle: undefined })).toBe(true)
  })
})
