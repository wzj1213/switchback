import { describe, expect, it } from "vitest"
import type { Item, Thread, ToolCallItem } from "@omni/protocol"
import { elapsed, statusLabel } from "./status.js"
import { brief } from "./tool.js"

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

  it("最后一个工具已经跑完，就回到「正在思考」", () => {
    expect(statusLabel(thread("running"), [tool({ status: "ok" })])).toBe("正在思考")
  })

  it("只有文本没有工具时也是「正在思考」", () => {
    expect(statusLabel(thread("running"), [text()])).toBe("正在思考")
  })

  it("越过已完成的工具往前找的行为不存在——只看最后一个", () => {
    const items = [tool({ id: "a" }), tool({ id: "b", status: "ok" })]
    expect(statusLabel(thread("running"), items)).toBe("正在思考")
  })
})

describe("brief", () => {
  it("路径只取文件名——状态行是一行字，塞整条绝对路径等于什么都没说", () => {
    expect(brief({ kind: "file_read", path: "/a/b/c/math.js" })).toBe("math.js")
  })

  it("命令只取第一行", () => {
    expect(brief({ kind: "shell", command: "ls\ncat x" })).toBe("ls")
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
