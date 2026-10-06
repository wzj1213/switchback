import { describe, expect, it } from "vitest"
import { countDiff, isStreamingText, itemToSwitchback, textOf, toToolCall, toolStatus, turnStatus } from "./translate.js"
import type { WireItem } from "./wire.js"

const ctx = { turnId: "tn-1", at: 100 }

const exec = (over: Partial<WireItem> = {}): WireItem => ({
  type: "commandExecution",
  id: "exec-1",
  command: "/bin/zsh -lc ls",
  cwd: "/w",
  status: "completed",
  exitCode: 0,
  aggregatedOutput: "a.txt\n",
  ...over,
})

describe("commandExecution", () => {
  it("codex 已经解析好的 read 动作直接落 file_read，不用自己猜 sed 是在读文件", () => {
    const item = exec({
      command: "/bin/zsh -lc \"sed -n '1,240p' math.js\"",
      commandActions: [{ type: "read", command: "sed", path: "/w/math.js", name: "math.js" }],
    })
    expect(toToolCall(item, ctx).detail).toEqual({ kind: "file_read", path: "/w/math.js" })
  })

  it("认不出的动作落 shell，把 cwd/退出码/输出都带上", () => {
    expect(toToolCall(exec(), ctx).detail).toEqual({
      kind: "shell",
      command: "/bin/zsh -lc ls",
      cwd: "/w",
      exitCode: 0,
      output: "a.txt\n",
    })
  })

  it("后台终端等待与已写入的 stdin 保留在原命令详情里", () => {
    expect(
      toToolCall(
        exec({
          status: "inProgress",
          terminalInputs: ["yes\n"],
          waitingForTerminal: true,
        }),
        ctx,
      ).detail,
    ).toMatchObject({
      kind: "shell",
      terminal: { waiting: true, inputs: ["yes\n"] },
    })
  })

  it("读文件命令一旦出现终端交互就按 shell 展示，不能把等待态藏掉", () => {
    expect(
      toToolCall(
        exec({
          commandActions: [{ type: "read", path: "log.txt" }],
          waitingForTerminal: true,
        }),
        ctx,
      ).detail,
    ).toMatchObject({ kind: "shell", terminal: { waiting: true } })
  })

  it("退出码不为 0 算失败——codex 说的 completed 只是「进程跑完了」", () => {
    expect(toolStatus(exec({ exitCode: 1 }))).toBe("failed")
  })

  it("declined 落 denied", () => {
    expect(toolStatus(exec({ status: "declined" }))).toBe("denied")
  })

  it("复用 codex 的 item id——审批请求只带 itemId 回来，靠它挂对位置", () => {
    expect(toToolCall(exec(), ctx).id).toBe("exec-1")
  })
})

describe("fileChange", () => {
  const change = (over: Partial<WireItem> = {}): WireItem => ({
    type: "fileChange",
    id: "exec-2",
    status: "completed",
    changes: [{ path: "/w/a.txt", kind: { type: "add" }, diff: "hi\n" }],
    ...over,
  })

  it("新增文件的 diff 是纯内容没有 +/- 前缀，按行数算新增", () => {
    expect(toToolCall(change(), ctx).detail).toEqual({
      kind: "file_edit",
      path: "/w/a.txt",
      files: [{ path: "/w/a.txt", kind: "add", diff: "hi\n", added: 1, removed: 0 }],
      added: 1,
      removed: 0,
    })
  })

  it("多文件逐个保留——拼成一坨之后界面就没法按文件分组了", () => {
    const detail = toToolCall(
      change({
        changes: [
          { path: "/w/a.txt", kind: { type: "add" }, diff: "x\n" },
          { path: "/w/b.ts", kind: { type: "update" }, diff: "+新\n-旧\n" },
          { path: "/w/c.ts", kind: { type: "delete" }, diff: "老\n" },
        ],
      }),
      ctx,
    ).detail
    expect(detail.kind === "file_edit" ? detail.files.map((f) => [f.path, f.kind]) : []).toEqual([
      ["/w/a.txt", "add"],
      ["/w/b.ts", "update"],
      ["/w/c.ts", "delete"],
    ])
  })

  it("多文件补丁的增删是累加的", () => {
    const detail = toToolCall(
      change({
        changes: [
          { path: "/w/a.txt", kind: { type: "add" }, diff: "x\n" },
          { path: "/w/b.txt", kind: { type: "update" }, diff: "+新\n-旧\n" },
        ],
      }),
      ctx,
    ).detail
    expect(detail).toMatchObject({ added: 2, removed: 1, path: "/w/a.txt" })
  })
})

describe("countDiff", () => {
  it("update 只数带 +/- 前缀的行，跳过 +++/--- 文件头", () => {
    expect(countDiff("update", "--- a\n+++ b\n+新\n+新2\n-旧\n 上下文")).toEqual({ added: 2, removed: 1 })
  })

  it("delete 按行数算删除", () => {
    expect(countDiff("delete", "一\n二\n")).toEqual({ added: 0, removed: 2 })
  })
})

describe("itemToSwitchback", () => {
  it("userMessage 返回 undefined——宿主发 prompt 时已经发过一条了，再发就是重影", () => {
    expect(itemToSwitchback({ type: "userMessage", id: "u1" }, ctx, true)).toBeUndefined()
  })

  it("agentMessage 落 agent_message 并带 complete", () => {
    expect(itemToSwitchback({ type: "agentMessage", id: "m1", text: "好" }, ctx, true)).toEqual({
      id: "m1",
      turnId: "tn-1",
      at: 100,
      kind: "agent_message",
      text: "好",
      complete: true,
    })
  })

  it("reasoning 把 summary 与 content 拼起来", () => {
    expect(textOf({ type: "reasoning", id: "r", summary: ["一"], content: ["二"] })).toBe("一\n二")
  })

  it("contextCompaction 是原生状态提示，不冒充未知工具调用", () => {
    expect(itemToSwitchback({ type: "contextCompaction", id: "compact-1" }, ctx, true)).toEqual({
      id: "compact-1",
      turnId: "tn-1",
      at: 100,
      kind: "notice",
      message: "上下文已压缩。",
      level: "info",
    })
  })

  it("认不出的类型落 tool_call/other，原始 type 带上便于排查", () => {
    const item = itemToSwitchback({ type: "imageGeneration", id: "x" }, ctx, true)
    expect(item).toMatchObject({ kind: "tool_call", tool: "imageGeneration", detail: { kind: "other" } })
  })
})

describe("isStreamingText", () => {
  it("只有 agentMessage 和 reasoning 会收到 delta", () => {
    expect(isStreamingText("agentMessage")).toBe(true)
    expect(isStreamingText("reasoning")).toBe(true)
    expect(isStreamingText("commandExecution")).toBe(false)
  })
})

describe("turnStatus", () => {
  it("映射四态", () => {
    expect(turnStatus("inProgress")).toBe("running")
    expect(turnStatus("interrupted")).toBe("interrupted")
    expect(turnStatus("failed")).toBe("failed")
    expect(turnStatus(undefined)).toBe("completed")
  })
})
