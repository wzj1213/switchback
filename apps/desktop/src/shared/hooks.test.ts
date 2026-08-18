import { describe, expect, it } from "vitest"
import { hookLines, hookLinesFlat, shortPath, trustKeyOf, type HookLine } from "./hooks.js"

/**
 * 一张表，一个循环。这里穷举的是「用户手写的配置能长成什么样」——
 * 两家的正常形状、codex 那张不是数组的 `[hooks.state]`、以及各种写坏了的。
 */
const CASES: readonly { name: string; raw: unknown; want: readonly HookLine[] }[] = [
  {
    name: "Claude：带 matcher / timeout / statusMessage",
    raw: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "./fmt.sh", timeout: 60, statusMessage: "格式化" }],
        },
      ],
    },
    want: [{ event: "PreToolUse", command: "./fmt.sh", timeout: 60, note: "格式化", matcher: "Bash" }],
  },
  {
    name: "codex：没有 matcher",
    raw: { Stop: [{ hooks: [{ type: "command", command: "sh restart.sh", timeout: 60 }] }] },
    want: [{ event: "Stop", command: "sh restart.sh", timeout: 60 }],
  },
  {
    name: "codex 的 [hooks.state] 是表不是数组，不该被当成事件",
    raw: { state: { "/a/config.toml:stop:0:0": { trusted_hash: "sha256:…" } } },
    want: [],
  },
  {
    name: "同一个事件下的多组多条，顺序照原样",
    raw: {
      PostToolUse: [
        { matcher: "Write", hooks: [{ command: "a" }, { command: "b" }] },
        { hooks: [{ command: "c" }] },
      ],
    },
    want: [
      { event: "PostToolUse", command: "a", matcher: "Write" },
      { event: "PostToolUse", command: "b", matcher: "Write" },
      { event: "PostToolUse", command: "c" },
    ],
  },
  {
    name: "命令不是字符串 / 是空串 / 整条不是对象——都跳过，不列半条",
    raw: { Stop: [{ hooks: [{ command: 42 }, { command: "" }, "不是对象", { timeout: 3 }] }] },
    want: [],
  },
  {
    name: "matcher 是空串等于没有：它不该在界面上占一个芯片",
    raw: { Stop: [{ matcher: "", hooks: [{ command: "x" }] }] },
    want: [{ event: "Stop", command: "x" }],
  },
  { name: "hooks 不是数组", raw: { Stop: [{ hooks: "x" }] }, want: [] },
  { name: "事件的值不是数组", raw: { Stop: { hooks: [{ command: "x" }] } }, want: [] },
  { name: "整份不是对象", raw: "hooks", want: [] },
  { name: "没有这一节", raw: undefined, want: [] },
  { name: "timeout 不是数字就不带出来，不编默认值", raw: { Stop: [{ hooks: [{ command: "x", timeout: "60" }] }] }, want: [{ event: "Stop", command: "x" }] },
]

describe("hookLines", () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(hookLines(c.raw)).toEqual(c.want)
    })
  }

  it("信任状态按（事件, 组, 条目）问，问到哪条挂哪条", () => {
    const raw = {
      Stop: [{ hooks: [{ command: "a" }, { command: "b" }] }],
      SessionStart: [{ hooks: [{ command: "c" }] }],
    }
    const lines = hookLines(raw, (event, group, index) =>
      event === "Stop" && group === 0 && index === 1 ? "trusted" : "pending",
    )
    expect(lines).toEqual([
      { event: "Stop", command: "a", trust: "pending" },
      { event: "Stop", command: "b", trust: "trusted" },
      { event: "SessionStart", command: "c", trust: "pending" },
    ])
  })
})

/** Kimi Code 那张平表：事件写在条目自己身上，没有 matcher 组这一层。 */
const FLAT: readonly { name: string; raw: unknown; want: readonly HookLine[] }[] = [
  {
    name: "正常一条",
    raw: [{ event: "PreToolUse", matcher: "Bash", command: "./guard.sh", timeout: 30 }],
    want: [{ event: "PreToolUse", command: "./guard.sh", timeout: 30, matcher: "Bash" }],
  },
  {
    name: "没有 matcher",
    raw: [{ event: "Stop", command: "./done.sh" }],
    want: [{ event: "Stop", command: "./done.sh" }],
  },
  { name: "事件名读不出来就整条不要", raw: [{ command: "./x.sh" }, { event: 7, command: "./y.sh" }], want: [] },
  { name: "命令读不出来就整条不要", raw: [{ event: "Stop" }, { event: "Stop", command: "" }], want: [] },
  { name: "不是数组（比如被写成了嵌套那种表）", raw: { Stop: [] }, want: [] },
  { name: "没有这一节", raw: undefined, want: [] },
]

describe("hookLinesFlat", () => {
  for (const c of FLAT) {
    it(c.name, () => {
      expect(hookLinesFlat(c.raw)).toEqual(c.want)
    })
  }
})

describe("trustKeyOf", () => {
  /**
   * 键要和 codex 自己写下的那份 `[hooks.state]` **逐字**对得上。
   * 事件名是**蛇形小写**——`Stop` 这个样本两种写法一样，正是它让
   * 最初那版 `toLowerCase()` 看起来是对的（见 `trustKeyOf` 的注释）。
   */
  const table: readonly [string, string, string][] = [
    ["Stop", "/a/.codex/config.toml", "/a/.codex/config.toml:stop:0:0"],
    ["PreToolUse", "/a/.codex/hooks.json", "/a/.codex/hooks.json:pre_tool_use:0:0"],
    ["PostToolUse", "/a/h.json", "/a/h.json:post_tool_use:0:0"],
    ["UserPromptSubmit", "/a/h.json", "/a/h.json:user_prompt_submit:0:0"],
    ["SessionEnd", "/a/h.json", "/a/h.json:session_end:0:0"],
    // 已经是蛇形的原样留着，别再切一刀
    ["session_start", "/a/h.json", "/a/h.json:session_start:0:0"],
  ]
  for (const [event, path, want] of table) {
    it(`${event} → ${want.split(":")[1] ?? ""}`, () => {
      expect(trustKeyOf(path, event, 0, 0)).toBe(want)
    })
  }
  it("组下标与条目下标照原样带上", () => {
    expect(trustKeyOf("/a/h.json", "PreToolUse", 2, 3)).toBe("/a/h.json:pre_tool_use:2:3")
  })
})

describe("shortPath", () => {
  const table: readonly [string, string, string][] = [
    ["/Users/w/.claude/settings.json", "/Users/w", "~/.claude/settings.json"],
    ["/Users/w/work/p/.codex/config.toml", "/Users/w", "~/work/p/.codex/config.toml"],
    // 家目录本身、以及只是**前缀相同**的另一个目录，都不该被缩
    ["/Users/w", "/Users/w", "/Users/w"],
    ["/Users/you2/x", "/Users/you", "/Users/you2/x"],
    ["/etc/claude/settings.json", "/Users/w", "/etc/claude/settings.json"],
    ["/Users/w/x", "", "/Users/w/x"],
  ]
  for (const [path, home, want] of table) {
    it(`${path} + ${home} → ${want}`, () => {
      expect(shortPath(path, home)).toBe(want)
    })
  }
})
