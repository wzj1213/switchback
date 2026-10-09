import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { Command, Trust } from "@switchback/protocol"
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

  it("要完全档、上限是自动审批 → 开出来是自动审批，并说清楚", () => {
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
    { type: "question.resolve", threadId: "t", questionId: "q", response: { dismissed: true } },
  ]
  for (const command of others) {
    it(command.type, () => {
      // 目标会话本身就在上限之内（发话要查得到档位，见 `ON_HISTORY`）
      expect(clamp(command, "read-only", () => "read-only")).toEqual({ command })
    })
  }
})

describe("线上来的东西必须先验形状", () => {
  const good: readonly unknown[] = [
    { type: "thread.prompt", threadId: "t", text: "hi" },
    { type: "thread.prompt", threadId: "t", text: "hi", attachments: ["/a.png"] },
    { type: "thread.create", cwd: "/w", engine: "codex", trust: "full" },
    { type: "approval.resolve", itemId: "i", allow: false, remember: "once" },
    { type: "question.resolve", threadId: "t", questionId: "q", response: { dismissed: true } },
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
    ["结构化回答缺 response", { type: "question.resolve", threadId: "t", questionId: "q" }],
    ["结构化回答不能是数组", { type: "question.resolve", threadId: "t", questionId: "q", response: [] }],
    ["原型污染那一套也只是个认不出的 type", { type: "__proto__" }],
  ]
  for (const [why, value] of bad) {
    it(`拒：${why}`, () => {
      expect(isCommand(value)).toBe(false)
    })
  }
})

describe("上限管得住已经开着的会话", () => {
  const full = (): Trust => "full"

  it("**往一条完全档会话发提问，在自动审批上限下要被拒**——这是最容易发生的那条绕过", () => {
    const verdict = clamp({ type: "thread.prompt", threadId: "t", text: "跑一下" }, "auto-edit", full)
    expect(verdict.command).toBeUndefined()
    expect(verdict.note).toContain("full")
  })

  it("**fork 会继承源会话的档**，所以同样要拦——不然远程凭空得到一条完全档会话", () => {
    const verdict = clamp({ type: "thread.fork", threadId: "t", to: "claude" }, "auto-edit", full)
    expect(verdict.command).toBeUndefined()
  })

  it("resume 与 rewind 同理", () => {
    expect(clamp({ type: "thread.resume", threadId: "t" }, "read-only", full).command).toBeUndefined()
    expect(clamp({ type: "thread.rewind", threadId: "t", turnId: "u" }, "read-only", full).command).toBeUndefined()
  })

  it("**不让引擎动起来的那些照旧放行**：停下、改名、删掉、换模型", () => {
    for (const command of [
      { type: "thread.interrupt", threadId: "t" },
      { type: "thread.rename", threadId: "t", title: "x" },
      { type: "thread.delete", threadId: "t" },
      { type: "thread.setModel", threadId: "t", model: "m" },
    ] as const) {
      expect(clamp(command, "read-only", full).command).toEqual(command)
    }
  })

  it("**批准从不拦**——「在外面把卡住的那一轮放行」正是这个功能存在的理由", () => {
    const resolve = { type: "approval.resolve", itemId: "i", allow: true, remember: "once" } as const
    expect(clamp(resolve, "read-only", full).command).toEqual(resolve)
  })

  it("**切低是允许的**：这是用户在手机上把会话拉回上限之内的唯一办法", () => {
    const verdict = clamp({ type: "thread.setTrust", threadId: "t", trust: "auto-edit" }, "auto-edit", full)
    expect(verdict.command).toMatchObject({ trust: "auto-edit" })
  })

  it("目标会话不高过上限就什么都不做", () => {
    const prompt = { type: "thread.prompt", threadId: "t", text: "hi" } as const
    expect(clamp(prompt, "full", () => "auto-edit").command).toEqual(prompt)
  })

  it("查不到会话时，宿主只认活会话的那几条不拦——它自己会拒", () => {
    const aside = { type: "thread.sideQuestion", threadId: "没有这条", text: "hi" } as const
    expect(clamp(aside, "read-only", () => undefined).command).toEqual(aside)
  })

  it("**查不到档位就不许发话、分叉**：宿主会按记录照做，可能开在完全档", () => {
    for (const command of [
      { type: "thread.prompt", threadId: "历史", text: "hi" },
      { type: "thread.switchNow", threadId: "历史" },
      { type: "thread.fork", threadId: "历史", to: "claude" },
      { type: "thread.rewind", threadId: "历史", turnId: "u" },
    ] as const) {
      const verdict = clamp(command, "auto-edit", () => undefined)
      expect(verdict.command).toBeUndefined()
      expect(verdict.note).toContain("接回来")
    }
  })

  it("上限就是完全档时没有什么可高过的，查不到也放行", () => {
    const prompt = { type: "thread.prompt", threadId: "历史", text: "hi" } as const
    expect(clamp(prompt, "full", () => undefined).command).toEqual(prompt)
  })

  it("网页端的「接回来」照旧放行（它先降档再接）——查不到档位的缺口是旧的，见 README", () => {
    const resume = { type: "thread.resume", threadId: "历史" } as const
    expect(clamp(resume, "auto-edit", () => undefined).command).toEqual(resume)
  })

  it("只读上限下 adopt 被拒（它的档位是写死的，钳不动）", () => {
    const adopt = { type: "thread.adopt", engine: "codex", handle: "h", cwd: "/w", title: "x" } as const
    expect(clamp(adopt, "read-only").command).toBeUndefined()
    expect(clamp(adopt, "auto-edit").command).toEqual(adopt)
  })
})

describe("形状表不许落在协议后面", () => {
  /**
   * **这条测试是被一次真实的遗漏逼出来的。**
   *
   * `SHAPES` 是一张手维护的白名单，而 `Command` 联合会长。漏一条的后果不是放行
   * 而是**整条拒掉**——远程发过去只会收到一句「这条命令的形状 Switchback 认不出来」。
   * 实测漏过 `thread.steerQueued` 和 `thread.switchNow`，而前者恰恰是最赶时间的
   * 那个动作：排着的那句往往是「别再往下走了」。
   *
   * 判据是**读源码**而不是列一份手写清单——手写清单和白名单一样会落后。
   */
  it("`Command` 联合里的每一种，`SHAPES` 里都要有", () => {
    const src = readFileSync(new URL("../../../../../packages/protocol/src/command.ts", import.meta.url), "utf8")
    const declared = [...src.matchAll(/\{ type: "([a-z]+\.[a-zA-Z]+)"/gu)].map((m) => m[1] ?? "")
    expect(declared.length).toBeGreaterThan(10)
    const missing = [...new Set(declared)].filter((type) => !isCommand({ ...sample(type) }))
    expect(missing).toEqual([])
  })
})

/** 造一条**形状上合法**的样例命令。字段照 `SHAPES` 的要求给，值本身无所谓。 */
function sample(type: string): Record<string, unknown> {
  return {
    type,
    threadId: "t",
    text: "x",
    title: "x",
    cwd: "/w",
    engine: "codex",
    handle: "h",
    to: "claude",
    turnId: "u",
    id: "i",
    itemId: "i",
    remember: "once",
    allow: true,
    model: "m",
    trust: "auto-edit",
    questionId: "q",
    response: { dismissed: true },
  }
}
