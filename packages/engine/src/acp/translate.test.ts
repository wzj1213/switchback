import { describe, expect, it } from "vitest"
import { detailOf, merge, stopStatus, toToolCall, toolNameOf, toolStatusOf } from "./translate.js"
import { currentModeOf, modelsOf, modesOf } from "./setup.js"
import type { AcpNewSession, AcpToolCall } from "./wire.js"

describe("工具形态", () => {
  it("**实测的 read 调用**：kind + locations，落 file_read", () => {
    const call: AcpToolCall = {
      toolCallId: "exec-b95",
      status: "in_progress",
      kind: "read",
      title: "Read file '/tmp/x/hello.txt'",
      locations: [{ path: "/tmp/x/hello.txt" }],
    }
    expect(detailOf(call)).toEqual({ kind: "file_read", path: "/tmp/x/hello.txt" })
  })

  it("**实测的 edit 调用**：content 里是前后全文，不是 unified diff", () => {
    const call: AcpToolCall = {
      toolCallId: "exec-8c6",
      title: "Editing files",
      kind: "edit",
      content: [{ type: "diff", oldText: "原始内容\n", newText: "已改\n", path: "/tmp/x/hello.txt" }],
    }
    expect(detailOf(call)).toEqual({
      kind: "file_edit",
      path: "/tmp/x/hello.txt",
      // 两份全文进来，出去的是**合成的真 diff**（带 `+`/`-` 前缀），不是整份新文件
      files: [{ path: "/tmp/x/hello.txt", kind: "update", diff: "-原始内容\n+已改", added: 1, removed: 1 }],
      added: 1,
      removed: 1,
    })
  })

  /**
   * 这条是上一版漏掉的那种：单行文件恰好 +1 −1，怎么算都对，
   * 于是「按整份文件的行数算」这个 bug 一直没被测试拦住。
   */
  it("**多行文件里只改一行，就该是 +1 −1**——不是整份文件的行数", () => {
    const before = Array.from({ length: 40 }, (_, i) => `第 ${String(i)} 行`).join("\n")
    const after = before.replace("第 20 行", "第 20 行（改过）")
    const call: AcpToolCall = {
      toolCallId: "c",
      kind: "edit",
      content: [{ type: "diff", oldText: `${before}\n`, newText: `${after}\n`, path: "/w/long.ts" }],
    }
    const detail = detailOf(call)
    expect(detail?.kind === "file_edit" ? { added: detail.added, removed: detail.removed } : {}).toEqual({
      added: 1,
      removed: 1,
    })
    // 而且 diff 里只带改动附近几行，不是整份文件——journal 也跟着瘦下来
    const diff = detail?.kind === "file_edit" ? (detail.files[0]?.diff ?? "") : ""
    expect(diff.split("\n").length).toBeLessThan(10)
    expect(diff).toContain("+第 20 行（改过）")
  })

  it("oldText 为 null 是新建文件，删除数记 0 而不是「旧内容是空串」", () => {
    const call: AcpToolCall = {
      toolCallId: "c",
      kind: "edit",
      content: [{ type: "diff", oldText: null, newText: "一\n二\n", path: "/w/new.ts" }],
    }
    const detail = detailOf(call)
    expect(detail).toMatchObject({ kind: "file_edit", added: 2, removed: 0 })
    expect(detail.kind === "file_edit" ? detail.files[0]?.kind : "").toBe("add")
  })

  it("**实测的 execute 调用**：命令在 rawInput，输出在 rawOutput.formatted_output", () => {
    const call: AcpToolCall = {
      toolCallId: "c",
      kind: "execute",
      title: "curl -s https://example.com",
      rawInput: { command: "curl -s https://example.com", cwd: "/tmp/x" },
      rawOutput: { formatted_output: "被沙箱拦了", exit_code: -1 },
    }
    expect(detailOf(call)).toEqual({
      kind: "shell",
      command: "curl -s https://example.com",
      cwd: "/tmp/x",
      exitCode: -1,
      output: "被沙箱拦了",
    })
  })

  it("Grok Monitor 虽映成 ACP other，仍按公开的原生身份落 shell 工具", () => {
    const call: AcpToolCall = {
      toolCallId: "monitor-1", kind: "other", title: "Start monitor: app log",
      rawInput: { command: "tail -f app.log", description: "app log" },
      _meta: { "x.ai/tool": { version: 1, kind: "monitor", name: "monitor" } },
    }
    expect(toToolCall(call, "turn-1", 1)).toMatchObject({
      id: "monitor-1", tool: "acp:monitor",
      detail: { kind: "shell", command: "tail -f app.log" },
    })
  })

  it("认不出的 kind 落 other，名字用 title——比裸 kind 有用得多", () => {
    expect(detailOf({ toolCallId: "c", kind: "think", title: "Thinking about it" })).toMatchObject({
      kind: "other",
      name: "Thinking about it",
    })
  })

  it("工具身份带 acp: 前缀，不和别家的 read / edit 撞名", () => {
    expect(toolNameOf("read")).toBe("acp:read")
    expect(toolNameOf(undefined)).toBe("acp:other")
  })
})

describe("工具状态", () => {
  it("**退出码不为 0 一律算失败**——completed 说的是进程跑完了，不是事情办成了", () => {
    expect(toolStatusOf({ status: "completed", rawOutput: { exit_code: 1 } })).toBe("failed")
    expect(toolStatusOf({ status: "completed", rawOutput: { exit_code: 0 } })).toBe("ok")
    expect(toolStatusOf({ status: "completed" })).toBe("ok")
  })

  it("状态缺失时按 running，不按 ok——猜错的方向要安全", () => {
    expect(toolStatusOf({})).toBe("running")
  })
})

describe("合并补丁", () => {
  it("**没给的字段保持原样**——收尾更新只有 status，不合并就把整行清空了", () => {
    const prev: AcpToolCall = { toolCallId: "c", title: "跑命令", kind: "execute", status: "in_progress" }
    expect(merge(prev, { toolCallId: "c", status: "completed" })).toEqual({
      toolCallId: "c",
      title: "跑命令",
      kind: "execute",
      status: "completed",
    })
  })

  it("null 是显式清空，和「没给」不同", () => {
    const prev: AcpToolCall = { toolCallId: "c", title: "旧标题" }
    expect(merge(prev, { toolCallId: "c", title: null }).title).toBeNull()
  })
})

describe("停止原因", () => {
  it("正常收工", () => {
    expect(stopStatus("end_turn")).toEqual({ status: "completed" })
  })

  it("被取消算中断，不算失败——那是用户自己按的停止", () => {
    expect(stopStatus("cancelled")).toEqual({ status: "interrupted" })
  })

  it("**撞上限判 failed 并说清楚**——判成 completed 的话，用户不会知道它是撞墙停的", () => {
    expect(stopStatus("max_tokens").status).toBe("failed")
    expect(stopStatus("max_turn_requests").error).toContain("请求次数上限")
  })

  it("**refusal 判 failed**：协议原文说被拒的这一轮不进下一次请求，界面必须体现", () => {
    const out = stopStatus("refusal")
    expect(out.status).toBe("failed")
    expect(out.error).toContain("不会进入下一次请求")
  })

  it("没给原因就当正常收工", () => {
    expect(stopStatus(undefined)).toEqual({ status: "completed" })
  })
})

describe("两代适配器报的字段名不一样", () => {
  /** 实测 codex-acp 1.3.0 的 session/new 结果（截取）。 */
  const NEW_STYLE: AcpNewSession = {
    sessionId: "01a0",
    models: {
      currentModelId: "gpt-5.6-luna[medium]",
      availableModels: [{ modelId: "gpt-5.6-sol[low]", name: "GPT-5.6-Sol (low)", description: "轻推理" }],
    },
    modes: {
      currentModeId: "agent",
      availableModes: [{ id: "read-only", name: "Read-only" }, { id: "agent", name: "Agent" }],
    },
  }

  /** 实测 codex-acp 0.16.0 的形状：只有 configOptions。 */
  const OLD_STYLE: AcpNewSession = {
    sessionId: "01a0",
    configOptions: [
      {
        id: "model",
        currentValue: "gpt-5.6-luna",
        options: [{ value: "gpt-5.5", name: "GPT-5.5", description: "前沿模型" }],
      },
      {
        id: "mode",
        currentValue: "agent",
        options: [{ value: "read-only", name: "Read-only" }, { value: "agent", name: "Agent" }],
      },
    ],
  }

  it("新版从 models.availableModels 读", () => {
    expect(modelsOf(NEW_STYLE)).toEqual([
      { id: "gpt-5.6-sol[low]", label: "GPT-5.6-Sol (low)", description: "轻推理" },
    ])
  })

  it("**旧版只有 configOptions，也要读得出来**——只认新版的话，装旧适配器的用户一个模型都选不了", () => {
    expect(modelsOf(OLD_STYLE)).toEqual([{ id: "gpt-5.5", label: "GPT-5.5", description: "前沿模型" }])
  })

  it("档位两条路都通", () => {
    expect(modesOf(NEW_STYLE).map((m) => m.id)).toEqual(["read-only", "agent"])
    expect(modesOf(OLD_STYLE).map((m) => m.id)).toEqual(["read-only", "agent"])
    expect(currentModeOf(NEW_STYLE)).toBe("agent")
    expect(currentModeOf(OLD_STYLE)).toBe("agent")
  })

  it("两样都没有就给空——界面据此不显示选择器，而不是显示一个空下拉", () => {
    expect(modelsOf({ sessionId: "x" })).toEqual([])
    expect(modesOf({ sessionId: "x" })).toEqual([])
    expect(currentModeOf({ sessionId: "x" })).toBeUndefined()
  })

  it("**ACP 不报 efforts**——强度编在 modelId 里（gpt-5.6-sol[low]），报了界面上会多一个点了没用的控件", () => {
    expect(modelsOf(NEW_STYLE)[0]).not.toHaveProperty("efforts")
  })
})
