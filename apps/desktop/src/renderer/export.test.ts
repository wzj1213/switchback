import { describe, expect, it } from "vitest"
import type { Item, Thread } from "@switchback/protocol"
import { toMarkdown, textOf } from "./export.js"

const thread: Thread = {
  id: "th",
  title: "switchback",
  cwd: "/w",
  engine: "codex",
  trust: "auto-edit",
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["codex"],
}

const user = (text: string): Item => ({ id: "u", turnId: "t", kind: "user_message", at: 0, text })
const agent = (text: string): Item => ({
  id: "a",
  turnId: "t",
  kind: "agent_message",
  at: 0,
  text,
  complete: true,
})

describe("toMarkdown", () => {
  it("带上工作区与引擎，方便贴到别处之后还知道是哪来的", () => {
    expect(toMarkdown(thread, [], "Codex")).toContain("> 工作区 `/w` · 引擎 Codex")
  })

  it("用户与模型分小节", () => {
    const md = toMarkdown(thread, [user("问题"), agent("回答")], "Codex")
    expect(md).toContain("### 你\n\n问题")
    expect(md).toContain("### Codex\n\n回答")
  })

  it("定时触发导出时不冒充成用户本人", () => {
    const scheduled: Item = {
      id: "s",
      turnId: "t",
      kind: "user_message",
      at: 0,
      text: "检查部署",
      origin: {
        kind: "scheduled",
        taskId: "job-1",
        schedule: "7 * * * *",
        recurring: true,
        coalescedCount: 1,
        stale: false,
      },
    }
    const md = toMarkdown(thread, [scheduled], "Kimi")
    expect(md).toContain("### 定时任务\n\n检查部署")
    expect(md).not.toContain("### 你\n\n检查部署")
  })

  it("原生终端命令导出时保留来源", () => {
    const shell: Item = {
      id: "shell",
      turnId: "t",
      kind: "user_message",
      at: 0,
      text: "$ printf ok",
      origin: { kind: "shell" },
    }

    expect(toMarkdown(thread, [shell], "Kimi")).toContain("### 终端命令\n\n$ printf ok")
  })

  it("长期目标自动续轮导出原生边界且没有虚构正文", () => {
    const continuation: Item = {
      id: "goal",
      turnId: "t",
      kind: "user_message",
      at: 0,
      text: "",
      origin: { kind: "goal_continuation" },
    }

    expect(toMarkdown(thread, [continuation], "Kimi")).toContain("### 长期目标续跑")
    expect(toMarkdown(thread, [continuation], "Kimi")).not.toContain("Continue working")
  })

  it("reasoning 不导出——那是模型的内部草稿，不是给第三个人看的东西", () => {
    const md = toMarkdown(
      thread,
      [{ id: "r", turnId: "t", kind: "reasoning", at: 0, text: "先想想", complete: true }],
      "Codex",
    )
    expect(md).not.toContain("先想想")
  })

  it("命令的输出包进围栏", () => {
    const md = toMarkdown(
      thread,
      [
        {
          id: "e",
          turnId: "t",
          kind: "tool_call",
          at: 0,
          tool: "shell",
          status: "ok",
          detail: { kind: "shell", command: "ls", output: "a.txt\n" },
        },
      ],
      "Codex",
    )
    expect(md).toContain("**执行** `ls` — ok")
    expect(md).toContain("```\na.txt\n```")
  })

  it("后台终端输入也进入导出，并与命令输出分区", () => {
    const md = toMarkdown(
      thread,
      [
        {
          id: "e",
          turnId: "t",
          kind: "tool_call",
          at: 0,
          tool: "shell",
          status: "ok",
          detail: {
            kind: "shell",
            command: "read answer",
            output: "ready\n",
            terminal: { waiting: false, inputs: ["yes\n"] },
          },
        },
      ],
      "Codex",
    )
    expect(md).toContain("终端输出：\nready")
    expect(md).toContain("后台终端输入 1：\nyes")
  })

  it("输出里本来就有围栏时，外层用更长的围栏——否则代码块会被内容提前闭合", () => {
    const md = toMarkdown(
      thread,
      [
        {
          id: "e",
          turnId: "t",
          kind: "tool_call",
          at: 0,
          tool: "shell",
          status: "ok",
          detail: { kind: "shell", command: "cat a.md", output: "```js\nx\n```" },
        },
      ],
      "Codex",
    )
    expect(md).toContain("````\n```js")
  })

  it("文件改动逐个带 diff 围栏", () => {
    const md = toMarkdown(
      thread,
      [
        {
          id: "f",
          turnId: "t",
          kind: "tool_call",
          at: 0,
          tool: "apply_patch",
          status: "ok",
          detail: {
            kind: "file_edit",
            path: "/w/a.ts",
            files: [{ path: "/w/a.ts", kind: "update", diff: "-旧\n+新", added: 1, removed: 1 }],
            added: 1,
            removed: 1,
          },
        },
      ],
      "Codex",
    )
    expect(md).toContain("```diff\n-旧\n+新\n```")
  })

  it("审批与错误保留成引用块——「它做了什么」必须可考", () => {
    const md = toMarkdown(
      thread,
      [
        {
          id: "ap",
          turnId: "t",
          kind: "approval",
          at: 0,
          toolCallId: "x",
          tool: "shell",
          summary: "执行 rm -rf /tmp/x",
          status: "denied",
          reason: "越界",
        },
        { id: "er", turnId: "t", kind: "error", at: 0, message: "上游超时", fatal: true },
      ],
      "Codex",
    )
    expect(md).toContain("> **需要确认**：执行 rm -rf /tmp/x（denied）")
    expect(md).toContain("> ⚠️ 上游超时")
  })

  it("原生提示保留级别、原文与多行引用", () => {
    const md = toMarkdown(
      thread,
      [
        {
          id: "n",
          turnId: "t",
          kind: "notice",
          at: 0,
          message: "被 hook 拦下\n请检查规则",
          level: "warning",
        },
      ],
      "Claude",
    )
    expect(md).toContain("> **引擎提示 · warning**")
    expect(md).toContain("> 被 hook 拦下\n> 请检查规则")
  })
})

describe("textOf", () => {
  it("报错连引擎补的那句原因一起复制——拿去搜、拿去开 issue 的正是那一句", () => {
    expect(
      textOf({
        id: "er",
        turnId: "t",
        kind: "error",
        at: 0,
        message: "Reconnecting... 1/5",
        fatal: false,
        detail: "上游过载",
      }),
    ).toBe("Reconnecting... 1/5\n上游过载")
  })

  it("消息复制正文", () => {
    expect(textOf(agent("正文"))).toBe("正文")
  })

  it("原生提示复制原文", () => {
    expect(
      textOf({ id: "n", turnId: "t", kind: "notice", at: 0, message: "原文", level: "info" }),
    ).toBe("原文")
  })

  it("工具调用复制它执行的东西，不是标题", () => {
    expect(
      textOf({
        id: "e",
        turnId: "t",
        kind: "tool_call",
        at: 0,
        tool: "shell",
        status: "ok",
        detail: { kind: "shell", command: "pnpm test" },
      }),
    ).toBe("pnpm test")
  })
})
