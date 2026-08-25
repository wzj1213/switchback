import { describe, expect, it } from "vitest"
import { toTranscript } from "./transcript.js"

describe("Kimi transcript", () => {
  it("同一轮多次 todo_list 只留下最后一版计划", () => {
    const got = toTranscript({
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "7",
          state: "completed",
          steps: [
            {
              frames: [
                {
                  kind: "tool",
                  frameId: "f1",
                  toolCallId: "tc1",
                  name: "TodoWrite",
                  state: "done",
                  display: { kind: "todo_list", items: [{ title: "查", status: "in_progress" }] },
                },
                {
                  kind: "tool",
                  frameId: "f2",
                  toolCallId: "tc2",
                  name: "TodoWrite",
                  state: "done",
                  display: { kind: "todo_list", items: [{ title: "查", status: "completed" }] },
                },
              ],
            },
          ],
        },
      ],
    })

    expect(got).toMatchObject({
      total: 1,
      items: [{ id: "kimi-history-7-plan", kind: "plan", steps: [{ text: "查", status: "done" }] }],
    })
  })

  it("历史 warning 保持提示级别，只有原生 error 才恢复成致命错误", () => {
    const got = toTranscript({
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "8",
          state: "completed",
          steps: [
            {
              frames: [
                { kind: "notice", frameId: "w1", level: "warning", message: "trim AGENTS.md" },
                { kind: "notice", frameId: "e1", level: "error", message: "model failed" },
              ],
            },
          ],
        },
      ],
    })

    expect(got.items).toMatchObject([
      { id: "w1", kind: "notice", level: "warning", message: "trim AGENTS.md" },
      { id: "e1", kind: "error", fatal: true, message: "model failed" },
    ])
  })

  it("历史定时轮展示原任务而不是给模型看的 cron-fire 包装", () => {
    const got = toTranscript({
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "9",
          state: "completed",
          origin: {
            kind: "cron",
            taskId: "job-1",
            payload: {
              kind: "cron_job",
              jobId: "job-1",
              cron: "7 * * * *",
              recurring: true,
              coalescedCount: 2,
              stale: true,
            },
          },
          prompt:
            '<cron-fire jobId="job-1" cron="7 * * * *" recurring="true" coalescedCount="2" stale="true">\n<prompt>\n检查部署\n第二行\n</prompt>\n</cron-fire>',
          steps: [],
        },
      ],
    })

    expect(got.items).toEqual([
      {
        id: "kimi-history-9-prompt",
        turnId: "kimi-history-9",
        at: 0,
        kind: "user_message",
        text: "检查部署\n第二行",
        origin: {
          kind: "scheduled",
          taskId: "job-1",
          schedule: "7 * * * *",
          recurring: true,
          coalescedCount: 2,
          stale: true,
        },
      },
    ])
  })

  it("历史目标续轮保留空边界，不泄露引擎内部续跑提示", () => {
    const got = toTranscript({
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "goal-1",
          state: "completed",
          origin: {
            kind: "other",
            payload: { kind: "system_trigger", name: "goal_continuation" },
          },
          steps: [
            {
              frames: [
                { kind: "text", frameId: "answer-goal", role: "assistant", text: "继续完成" },
              ],
            },
          ],
        },
      ],
    })

    expect(got.items).toMatchObject([
      { kind: "user_message", text: "", origin: { kind: "goal_continuation" } },
      { id: "answer-goal", kind: "agent_message", text: "继续完成" },
    ])
    expect(JSON.stringify(got.items)).not.toContain("Continue working toward")
  })

  it("历史 max_tokens step 恢复原生截断提示", () => {
    const got = toTranscript({
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "10",
          state: "completed",
          steps: [
            {
              finishReason: "max_tokens",
              frames: [{ kind: "text", frameId: "answer", role: "assistant", text: "半截回答" }],
            },
          ],
        },
      ],
    })

    expect(got.items).toMatchObject([
      { id: "answer", kind: "agent_message", text: "半截回答" },
      {
        id: "kimi-history-10-max-tokens-1",
        kind: "notice",
        level: "warning",
        message: "Model hit max_tokens — no tool call was emitted.",
      },
    ])
  })

  it("历史 step 中断保留原生原因且不吞终局错误", () => {
    const got = toTranscript({
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "interrupted",
          state: "failed",
          error: "provider unavailable",
          steps: [
            {
              state: "interrupted",
              endReason: "provider_reset",
              frames: [{ kind: "text", frameId: "partial", role: "assistant", text: "半截回答" }],
            },
          ],
        },
      ],
    })

    expect(got.items).toMatchObject([
      { id: "partial", kind: "agent_message", text: "半截回答" },
      {
        id: "kimi-history-interrupted-step-interrupted-1",
        kind: "error",
        message: "step interrupted (provider_reset)",
        fatal: false,
      },
      { id: "kimi-history-interrupted-error", message: "provider unavailable", fatal: true },
    ])
  })

  it("冷历史用持久化 marker 恢复用户中断但不猜输出截断", () => {
    const got = toTranscript({
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "t0",
          state: "completed",
          steps: [
            {
              state: "completed",
              frames: [
                { kind: "text", frameId: "length-partial", role: "assistant", text: "半截一" },
              ],
            },
          ],
        },
        {
          kind: "turn",
          turnId: "t1",
          state: "cancelled",
          steps: [
            {
              state: "completed",
              frames: [
                { kind: "text", frameId: "abort-partial", role: "assistant", text: "半截二" },
              ],
            },
          ],
        },
        {
          kind: "marker",
          markerId: "m1",
          marker: "interruption",
          payload: { agentId: "main", turnId: 1, target: "active", reason: "user_cancelled" },
          at: "2026-08-25T11:33:49.118Z",
        },
      ],
    })

    expect(got.items).toContainEqual({
      id: "kimi-history-t1-user-interrupted",
      turnId: "kimi-history-t1",
      at: new Date("2026-08-25T11:33:49.118Z").getTime(),
      kind: "error",
      message: "Interrupted by user",
      fatal: false,
    })
    expect(
      got.items.some((item) => item.kind === "notice" && item.message.includes("max_tokens")),
    ).toBe(false)
  })

  it("实时 transcript 已有 step 原因时不重复恢复中断 marker", () => {
    const got = toTranscript({
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "t2",
          state: "cancelled",
          steps: [{ state: "interrupted", endReason: "aborted", frames: [] }],
        },
        {
          kind: "marker",
          markerId: "live-m2",
          marker: "interruption",
          payload: { turnId: 2, reason: "user_cancelled" },
        },
      ],
    })

    expect(got.items.filter((item) => item.kind === "error")).toHaveLength(1)
    expect(got.items[0]).toMatchObject({ message: "Interrupted by user", fatal: false })
  })

  it("历史里的半截工具参数不再恢复成永久运行中的调用", () => {
    const got = toTranscript({
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "11",
          state: "completed",
          steps: [
            {
              finishReason: "max_tokens",
              frames: [
                {
                  kind: "tool",
                  frameId: "partial-frame",
                  toolCallId: "partial",
                  name: "Shell",
                  state: "running",
                  inputText: '{"command":',
                },
              ],
            },
          ],
        },
      ],
    })

    expect(got.items).toMatchObject([
      {
        id: "partial",
        kind: "tool_call",
        tool: "Shell",
        status: "failed",
        detail: { kind: "other", input: '{"command":' },
        error: "Model hit max_tokens — tool call was truncated before it could run.",
      },
      {
        id: "kimi-history-11-max-tokens-1",
        kind: "notice",
        level: "warning",
        message: "Model hit max_tokens — tool call was truncated before it could run.",
      },
    ])
  })

  it("历史 skill 标记沿用原生文案且不泄露展开后的内部提示", () => {
    const got = toTranscript({
      has_more: false,
      items: [
        {
          kind: "marker",
          markerId: "m1",
          marker: "skill",
          payload: {
            text: "<skill-loaded>private instructions</skill-loaded>",
            origin: {
              kind: "skill_activation",
              activationId: "a1",
              skillName: "review",
              trigger: "user-slash",
            },
          },
        },
        {
          kind: "turn",
          turnId: "12",
          state: "completed",
          origin: {
            kind: "other",
            payload: {
              kind: "skill_activation",
              activationId: "a1",
              skillName: "review",
              trigger: "user-slash",
            },
          },
          prompt: "<skill-loaded>private instructions</skill-loaded>",
          steps: [
            { frames: [{ kind: "text", frameId: "answer-12", role: "assistant", text: "完成" }] },
          ],
        },
      ],
    })

    expect(got.items).toMatchObject([
      {
        id: "kimi-activation-a1",
        turnId: "kimi-history-12",
        kind: "notice",
        message: "Activated skill: review",
      },
      { id: "answer-12", turnId: "kimi-history-12", kind: "agent_message", text: "完成" },
    ])
    expect(got.items.some((item) => item.kind === "user_message")).toBe(false)
    expect(JSON.stringify(got.items)).not.toContain("private instructions")
  })

  it("模型触发的 skill 标记归到前一轮，插件命令归到后一轮", () => {
    const got = toTranscript({
      has_more: false,
      items: [
        { kind: "turn", turnId: "13", state: "completed", prompt: "开始", steps: [] },
        {
          kind: "marker",
          markerId: "m2",
          marker: "skill",
          payload: { activationId: "a2", skillName: "search", trigger: "model-tool" },
        },
        {
          kind: "marker",
          markerId: "m3",
          marker: "skill",
          payload: {
            variant: "plugin_command",
            activationId: "a3",
            pluginId: "release",
            commandName: "check",
            trigger: "user-slash",
          },
        },
        {
          kind: "turn",
          turnId: "14",
          state: "completed",
          origin: {
            kind: "other",
            payload: {
              kind: "plugin_command",
              activationId: "a3",
              pluginId: "release",
              commandName: "check",
              trigger: "user-slash",
            },
          },
          prompt: "expanded command body",
          steps: [],
        },
      ],
    })

    expect(got.items.filter((item) => item.kind === "notice")).toMatchObject([
      { id: "kimi-activation-a2", turnId: "kimi-history-13", message: "Activated skill: search" },
      { id: "kimi-activation-a3", turnId: "kimi-history-14", message: "/release:check" },
    ])
    expect(JSON.stringify(got.items)).not.toContain("expanded command body")
  })

  it("原生 shell 历史不再显示内部 XML 包装", () => {
    const got = toTranscript({
      has_more: false,
      items: [
        {
          kind: "turn",
          turnId: "15",
          state: "completed",
          origin: { kind: "user", payload: { kind: "shell_command", phase: "input" } },
          prompt: "<bash-input>\nprintf 'hello'\n</bash-input>",
          steps: [],
        },
        {
          kind: "turn",
          turnId: "16",
          state: "completed",
          origin: { kind: "user", payload: { kind: "shell_command", phase: "output" } },
          prompt: "<bash-stdout>hello</bash-stdout><bash-stderr></bash-stderr>",
          steps: [],
        },
      ],
    })

    expect(got.items).toMatchObject([
      { kind: "user_message", text: "$ printf 'hello'", origin: { kind: "shell" } },
      { kind: "notice", message: "hello", level: "info" },
    ])
    expect(JSON.stringify(got.items)).not.toContain("bash-")
  })
})
