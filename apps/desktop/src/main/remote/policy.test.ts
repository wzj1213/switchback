import { describe, expect, it } from "vitest"
import type { Command, Trust } from "@omni/protocol"
import { clamp, isCommand, lower } from "./policy.js"

describe("档位比较", () => {
  const cases: readonly [Trust, Trust, Trust][] = [
    ["read-only", "full", "read-only"],
    ["full", "read-only", "read-only"],
    ["auto-edit", "full", "auto-edit"],
    ["full", "auto-edit", "auto-edit"],
    ["auto-edit", "read-only", "read-only"],
    ["full", "full", "full"],
  ]
  for (const [a, b, expected] of cases) {
    it(`${a} ∧ ${b} = ${expected}`, () => {
      expect(lower(a, b)).toBe(expected)
    })
  }
})

describe("新建会话被钳到上限", () => {
  const create = (trust: Trust): Command => ({ type: "thread.create", cwd: "/w", engine: "codex", trust })

  it("要完全档、上限是自动编辑 → 开出来是自动编辑，并说清楚", () => {
    const { command, note } = clamp(create("full"), "auto-edit")
    expect(command).toMatchObject({ trust: "auto-edit" })
    expect(note).toContain("上限")
  })

  it("要的本来就在上限内 → 一个字不动，也不多说一句", () => {
    const { command, note } = clamp(create("read-only"), "auto-edit")
    expect(command).toMatchObject({ trust: "read-only" })
    expect(note).toBeUndefined()
  })

  it("上限是完全档 → 什么都不钳", () => {
    expect(clamp(create("full"), "full").note).toBeUndefined()
  })
})

describe("切档被钳到上限", () => {
  const setTrust = (trust: Trust): Command => ({ type: "thread.setTrust", threadId: "t", trust })

  it("远程最高只能切到上限", () => {
    const { command, note } = clamp(setTrust("full"), "read-only")
    expect(command).toMatchObject({ trust: "read-only" })
    expect(note).toContain("read-only")
  })
})

describe("审批：放行，但记忆范围要收", () => {
  const resolve = (remember: "once" | "session" | "project"): Command => ({
    type: "approval.resolve",
    itemId: "i",
    allow: true,
    remember,
  })

  it("**批准本身从不拦**——「在外面把卡住的那一轮放行」正是这个功能存在的理由", () => {
    const { command } = clamp(resolve("once"), "read-only")
    expect(command).toMatchObject({ allow: true, remember: "once" })
  })

  it("完全档以下，project 降成 session：小屏幕上不该做跨会话的长期决定", () => {
    const { command, note } = clamp(resolve("project"), "auto-edit")
    expect(command).toMatchObject({ remember: "session" })
    expect(note).toContain("本会话")
  })

  it("完全档下 project 照旧生效", () => {
    const { command, note } = clamp(resolve("project"), "full")
    expect(command).toMatchObject({ remember: "project" })
    expect(note).toBeUndefined()
  })

  it("session 不受影响", () => {
    expect(clamp(resolve("session"), "read-only").note).toBeUndefined()
  })
})

describe("其余命令原样通过", () => {
  const others: readonly Command[] = [
    { type: "thread.prompt", threadId: "t", text: "hi" },
    { type: "thread.interrupt", threadId: "t" },
    { type: "thread.delete", threadId: "t" },
    { type: "thread.handoff", threadId: "t", to: "claude" },
  ]
  for (const command of others) {
    it(command.type, () => {
      expect(clamp(command, "read-only")).toEqual({ command })
    })
  }
})

describe("线上来的东西必须先验形状", () => {
  const good: readonly unknown[] = [
    { type: "thread.prompt", threadId: "t", text: "hi" },
    { type: "thread.prompt", threadId: "t", text: "hi", attachments: ["/a.png"] },
    { type: "thread.create", cwd: "/w", engine: "codex", trust: "full" },
    { type: "approval.resolve", itemId: "i", allow: false, remember: "once" },
    { type: "thread.setModel", threadId: "t", model: "gpt-5", effort: "high" },
  ]
  for (const value of good) {
    it(`认：${JSON.stringify(value).slice(0, 50)}`, () => {
      expect(isCommand(value)).toBe(true)
    })
  }

  const bad: readonly [string, unknown][] = [
    ["不是对象", "thread.prompt"],
    ["null", null],
    ["没有 type", { threadId: "t", text: "hi" }],
    ["type 不认识", { type: "thread.rm", threadId: "t" }],
    ["缺必需字段", { type: "thread.prompt", threadId: "t" }],
    ["字段类型不对", { type: "thread.prompt", threadId: 1, text: "hi" }],
    [
      "**approval.resolve 缺 allow**——按 falsy 读就静默变成「拒绝」，用户点了允许却被拒",
      { type: "approval.resolve", itemId: "i", remember: "once" },
    ],
    ["allow 是字符串不是布尔", { type: "approval.resolve", itemId: "i", allow: "true", remember: "once" }],
    ["trust 取值不合法", { type: "thread.create", cwd: "/w", engine: "codex", trust: "sudo" }],
    ["remember 取值不合法", { type: "approval.resolve", itemId: "i", allow: true, remember: "forever" }],
    ["原型污染那一套也只是个认不出的 type", { type: "__proto__" }],
  ]
  for (const [why, value] of bad) {
    it(`拒：${why}`, () => {
      expect(isCommand(value)).toBe(false)
    })
  }
})
