import { describe, expect, it } from "vitest"
import type { Item, Thread, ToolCallItem, ToolDetail, TurnPace } from "@switchback/protocol"
import { elapsed, paceLine as paceIn, sinceOf, spent, statusLabel as statusIn } from "./status.js"
import { brief as briefIn, target as targetIn } from "./tool.js"

// 下面那些用例写的是中文那版；英文那版的差别集中在文末
const statusLabel = (t: Thread, items: readonly Item[]): string | undefined => statusIn(t, items, "zh-CN")
const target = (detail: ToolDetail): string => targetIn(detail, "zh-CN")
const brief = (detail: ToolDetail): string => briefIn(detail, "zh-CN")
const paceLine = (pace: TurnPace): string => paceIn(pace, "zh-CN")

const thread = (status: Thread["status"]): Thread => ({
  id: "th",
  title: "工作区",
  cwd: "/w",
  engine: "codex",
  trust: "auto-edit",
  status,
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["codex"],
})

const tool = (over: Partial<ToolCallItem> = {}): ToolCallItem => ({
  id: "t1",
  turnId: "tn",
  kind: "tool_call",
  at: 0,
  tool: "shell",
  status: "running",
  detail: { kind: "shell", command: "pnpm test" },
  ...over,
})

const text = (): Item => ({ id: "m", turnId: "tn", kind: "agent_message", at: 0, text: "好", complete: true })

describe("statusLabel", () => {
  it("空闲时不显示——没有事情发生就不该有一行字在那儿闪", () => {
    expect(statusLabel(thread("idle"), [])).toBeUndefined()
  })

  it("等待批准优先于一切：这时候要人去做事，不能只说「正在思考」", () => {
    expect(statusLabel(thread("waiting_approval"), [tool()])).toBe("等待批准")
  })

  it("正在跑的工具说得出跑的是什么", () => {
    expect(statusLabel(thread("running"), [tool()])).toBe("执行 pnpm test")
  })

  it("原生空 stdin 轮询明确说正在等后台终端", () => {
    expect(
      statusLabel(thread("running"), [
        tool({
          detail: { kind: "shell", command: "pnpm test", terminal: { waiting: true, inputs: [] } },
        }),
      ]),
    ).toBe("等待后台终端 pnpm test")
  })

  it("最后一个工具已经跑完，就回到「正在思考」", () => {
    expect(statusLabel(thread("running"), [tool({ status: "ok" })])).toBe("正在思考")
  })

  it("只有文本没有工具时也是「正在思考」", () => {
    expect(statusLabel(thread("running"), [text()])).toBe("正在思考")
  })

  it("回答正在往外写时说「正在回答」，不挂着前面那段推理", () => {
    const writing: Item = { id: "w", turnId: "tn", kind: "agent_message", at: 1, text: "分页那段", complete: false }
    const reasoning: Item = { id: "r", turnId: "tn", kind: "reasoning", at: 0, text: "**看一下订阅**\n先看", complete: true }
    expect(statusLabel(thread("running"), [writing])).toBe("正在回答")
    expect(statusLabel(thread("running"), [reasoning, writing])).toBe("正在回答")
  })

  it("越过已完成的工具往前找的行为不存在——只看最后一个", () => {
    const items = [tool({ id: "a" }), tool({ id: "b", status: "ok" })]
    expect(statusLabel(thread("running"), items)).toBe("正在思考")
  })
})

describe("target", () => {
  it("多文件改动报「N 个文件」——只报第一个等于说了假话", () => {
    expect(
      target({
        kind: "file_edit",
        path: "/w/index.js",
        files: [
          { path: "/w/index.js", kind: "add", added: 1, removed: 0 },
          { path: "/w/math.js", kind: "update", added: 3, removed: 0 },
        ],
        added: 4,
        removed: 0,
      }),
    ).toBe("2 个文件")
  })

  it("单文件仍然报路径", () => {
    expect(
      target({
        kind: "file_edit",
        path: "/w/math.js",
        files: [{ path: "/w/math.js", kind: "update", added: 1, removed: 1 }],
        added: 1,
        removed: 1,
      }),
    ).toBe("/w/math.js")
  })
})

describe("brief", () => {
  it("路径只取文件名——状态行是一行字，塞整条绝对路径等于什么都没说", () => {
    expect(brief({ kind: "file_read", path: "/a/b/c/math.js" })).toBe("math.js")
  })

  it("命令只取第一行", () => {
    expect(brief({ kind: "shell", command: "ls\ncat x" })).toBe("ls")
  })

  it("剥掉 codex 的 shell 包壳——那 16 个字符会把真正有信息量的部分挤出截断线", () => {
    expect(brief({ kind: "shell", command: `/bin/zsh -lc 'pnpm test --run'` })).toBe("pnpm test --run")
    expect(brief({ kind: "shell", command: `/bin/zsh -c "ls -la"` })).toBe("ls -la")
  })

  it("不是包壳的原样保留，别把正常命令切坏了", () => {
    expect(brief({ kind: "shell", command: "zsh install.sh" })).toBe("zsh install.sh")
  })

  it("过长截断并加省略号", () => {
    const long = "x".repeat(80)
    expect(brief({ kind: "shell", command: long })).toHaveLength(49)
  })
})

describe("elapsed", () => {
  it("一分钟以内只显示秒", () => {
    expect(elapsed(0, 42_000)).toBe("42s")
  })

  it("超过一分钟显示分与秒", () => {
    expect(elapsed(0, 125_000)).toBe("2m 5s")
  })

  it("时钟回拨也不会出现负数", () => {
    expect(elapsed(1000, 0)).toBe("0s")
  })
})

describe("paceLine", () => {
  const cases: readonly (readonly [string, { firstMs: number; tps?: number; tokens: number; exact: boolean }, string])[] = [
    ["真数不带 ≈", { firstMs: 800, tps: 34.4, tokens: 900, exact: true }, "首字 0.8 秒 · 34 tok/s"],
    ["估数带 ≈", { firstMs: 1240, tps: 58.6, tokens: 900, exact: false }, "首字 1.2 秒 · ≈ 59 tok/s"],
    ["慢到十以下留一位小数", { firstMs: 400, tps: 7.26, tokens: 90, exact: true }, "首字 0.4 秒 · 7.3 tok/s"],
    ["首字十秒以上取整", { firstMs: 12_600, tps: 40, tokens: 900, exact: true }, "首字 13 秒 · 40 tok/s"],
    ["整秒也写一位小数：一行里的数位对得齐", { firstMs: 1000, tps: 40, tokens: 900, exact: true }, "首字 1.0 秒 · 40 tok/s"],
    ["出字时长太短量不出速度：只说首字", { firstMs: 900, tokens: 12, exact: true }, "首字 0.9 秒"],
  ]
  for (const [name, pace, want] of cases) {
    it(name, () => {
      expect(paceLine(pace)).toBe(want)
    })
  }
})

describe("英文那版", () => {
  const MIN = 60_000
  const at = new Date(2026, 9, 3, 12).getTime()
  const cases: readonly (readonly [string, () => string | undefined, string])[] = [
    ["等待批准", () => statusIn(thread("waiting_approval"), [], "en"), "Waiting for approval"],
    ["正在跑的工具用进行时", () => statusIn(thread("running"), [tool()], "en"), "Running pnpm test"],
    ["没有工具时在想", () => statusIn(thread("running"), [], "en"), "Thinking"],
    ["时长", () => spent(131_000, "en"), "2m 11s"],
    ["整分钟", () => spent(120_000, "en"), "2m"],
    ["节奏", () => paceIn({ firstMs: 800, tps: 34.4, tokens: 900, exact: false }, "en"), "first token 0.8s · ≈ 34 tok/s"],
    ["刚刚", () => sinceOf(at, at + 10_000, "en"), "now"],
    ["分钟", () => sinceOf(at, at + 5 * MIN, "en"), "5m ago"],
    ["昨天", () => sinceOf(at, at + 30 * 60 * MIN, "en"), "yesterday"],
    ["一周以上报日期", () => sinceOf(at, at + 10 * 24 * 60 * MIN, "en"), "Oct 3"],
    ["多文件改动", () => targetIn({ kind: "file_edit", path: "/w/a", files: [
      { path: "/w/a", kind: "add", added: 1, removed: 0 },
      { path: "/w/b", kind: "add", added: 1, removed: 0 },
    ], added: 2, removed: 0 }, "en"), "2 files"],
  ]
  for (const [name, run, want] of cases) {
    it(name, () => {
      expect(run()).toBe(want)
    })
  }

  it("中文那版的日期和时长不变", () => {
    expect([sinceOf(at, at + 10 * 24 * 60 * MIN, "zh-CN"), spent(131_000, "zh-CN")]).toEqual(["10 月 3 日", "2 分 11 秒"])
  })
})
