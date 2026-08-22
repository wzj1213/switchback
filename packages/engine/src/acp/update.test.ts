import { beforeEach, describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { closeText, createUpdateState, handleUpdate, sweep, type UpdateContext, type UpdateState } from "./update.js"
import type { AcpToolCall, AcpUpdate } from "./wire.js"

function setup(): { ctx: UpdateContext; state: UpdateState; events: Event[] } {
  const events: Event[] = []
  let seq = 0
  const ctx: UpdateContext = {
    threadId: "t1",
    engine: "acp:fake",
    emit: (e) => events.push(e),
    turnId: () => "turn-1",
    inflight: new Map<string, AcpToolCall>(),
    newId: (prefix) => {
      seq += 1
      return `${prefix}-${String(seq)}`
    },
    now: () => 1000,
  }
  return { ctx, state: createUpdateState(), events }
}

function chunk(text: string, kind: "agent_message_chunk" | "agent_thought_chunk" = "agent_message_chunk"): AcpUpdate {
  return { sessionUpdate: kind, content: { type: "text", text } }
}

describe("文本块的身份是我们划出来的", () => {
  let s: ReturnType<typeof setup>
  beforeEach(() => {
    s = setup()
  })

  it("**连续的 chunk 合成一条 item**——ACP 不给消息 id，不合并的话一段回答会碎成几十条气泡", () => {
    handleUpdate(s.ctx, s.state, chunk("你"))
    handleUpdate(s.ctx, s.state, chunk("好"))
    handleUpdate(s.ctx, s.state, chunk("吗"))
    const started = s.events.filter((e) => e.type === "item.started")
    const deltas = s.events.filter((e) => e.type === "item.delta")
    expect(started).toHaveLength(1)
    expect(deltas).toHaveLength(3)
    expect(new Set(deltas.map((d) => (d.type === "item.delta" ? d.itemId : "")))).toHaveLength(1)
  })

  it("正文与思考各成一条，不会串到一起", () => {
    handleUpdate(s.ctx, s.state, chunk("在想", "agent_thought_chunk"))
    handleUpdate(s.ctx, s.state, chunk("在说", "agent_message_chunk"))
    const started = s.events.filter((e) => e.type === "item.started")
    expect(started).toHaveLength(2)
    expect(started.map((e) => (e.type === "item.started" ? e.item.kind : ""))).toEqual([
      "reasoning",
      "agent_message",
    ])
  })

  it("**工具调用打断文本**——不收口的话工具行会插进一条没结束的消息中间", () => {
    handleUpdate(s.ctx, s.state, chunk("先说一句"))
    handleUpdate(s.ctx, s.state, { sessionUpdate: "tool_call", toolCallId: "c1", title: "跑命令", kind: "execute" })
    handleUpdate(s.ctx, s.state, chunk("再说一句"))
    const kinds = s.events.map((e) =>
      e.type === "item.started" || e.type === "item.updated" ? `${e.type}:${e.item.kind}` : e.type,
    )
    expect(kinds).toEqual([
      "item.started:agent_message",
      "item.delta",
      "item.updated:agent_message", // 收口
      "item.started:tool_call",
      "item.started:agent_message", // 新的一条
      "item.delta",
    ])
  })

  it("收口时带上攒齐的全文与 complete", () => {
    handleUpdate(s.ctx, s.state, chunk("上"))
    handleUpdate(s.ctx, s.state, chunk("下"))
    closeText(s.ctx, s.state)
    const last = s.events.at(-1)
    expect(last?.type === "item.updated" && last.item.kind === "agent_message" ? last.item : undefined).toMatchObject(
      { text: "上下", complete: true },
    )
  })

  it("收口幂等——扫两次不会多发一条", () => {
    handleUpdate(s.ctx, s.state, chunk("话"))
    closeText(s.ctx, s.state)
    const n = s.events.length
    closeText(s.ctx, s.state)
    expect(s.events).toHaveLength(n)
  })

  it("用户消息回声丢掉——宿主已经发过一条了", () => {
    handleUpdate(s.ctx, s.state, { sessionUpdate: "user_message_chunk", content: { type: "text", text: "嗨" } })
    expect(s.events).toHaveLength(0)
  })
})

describe("工具调用更新是补丁不是快照", () => {
  it("**收尾更新只有 status，标题和 diff 必须留住**——第一版就是这里把整行清空的", () => {
    const s = setup()
    handleUpdate(s.ctx, s.state, {
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "Editing files",
      kind: "edit",
      status: "in_progress",
      content: [{ type: "diff", path: "/w/a.ts", oldText: "旧\n", newText: "新\n" }],
    } as AcpUpdate)
    handleUpdate(s.ctx, s.state, { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed" })
    const last = s.events.at(-1)
    const item = last?.type === "item.updated" && last.item.kind === "tool_call" ? last.item : undefined
    expect(item?.status).toBe("ok")
    expect(item?.detail).toMatchObject({ kind: "file_edit", path: "/w/a.ts" })
  })

  it("没见过的 id 直接发更新也照样落一条，不能整个工具调用不见", () => {
    const s = setup()
    handleUpdate(s.ctx, s.state, {
      sessionUpdate: "tool_call_update",
      toolCallId: "ghost",
      title: "谁知道呢",
      kind: "execute",
      status: "completed",
    })
    expect(s.events.filter((e) => e.type === "item.started")).toHaveLength(1)
  })

  it("终态的调用移出在途表——留着会被收工清扫二次改写", () => {
    const s = setup()
    handleUpdate(s.ctx, s.state, { sessionUpdate: "tool_call", toolCallId: "c1", title: "x", kind: "execute" })
    handleUpdate(s.ctx, s.state, { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed" })
    expect(s.ctx.inflight.size).toBe(0)
  })
})

describe("收工清扫", () => {
  it("**在途工具不能留在 running**——那是界面上一个永远转下去的转圈", () => {
    const s = setup()
    handleUpdate(s.ctx, s.state, {
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "长命令",
      kind: "execute",
      status: "in_progress",
    })
    sweep(s.ctx, s.state, "interrupted")
    const last = s.events.at(-1)
    expect(last?.type === "item.updated" && last.item.kind === "tool_call" ? last.item.status : "").toBe("interrupted")
    expect(s.ctx.inflight.size).toBe(0)
  })

  it("清扫也收口在途文本，否则最后一条消息永远停在「正在输入」", () => {
    const s = setup()
    handleUpdate(s.ctx, s.state, chunk("没说完"))
    sweep(s.ctx, s.state, "interrupted")
    const updated = s.events.filter((e) => e.type === "item.updated")
    expect(updated).toHaveLength(1)
  })
})

describe("计划与用量", () => {
  it("计划整份替换，同一轮里复用一个 id", () => {
    const s = setup()
    const plan = (status: string): AcpUpdate => ({
      sessionUpdate: "plan",
      entries: [{ content: "第一步", status }],
    })
    handleUpdate(s.ctx, s.state, plan("pending"))
    handleUpdate(s.ctx, s.state, plan("completed"))
    const ids = s.events
      .filter((e) => e.type === "item.started" || e.type === "item.updated")
      .map((e) => (e.type === "item.started" || e.type === "item.updated" ? e.item.id : ""))
    expect(new Set(ids)).toHaveLength(1)
    expect(s.events.at(-1)?.type).toBe("item.updated")
  })

  it("用量报的是上下文占用，不是累计账单", () => {
    const s = setup()
    handleUpdate(s.ctx, s.state, { sessionUpdate: "usage_update", used: 15576, size: 258400 })
    const last = s.events.at(-1)
    expect(last?.type === "usage.updated" ? last.usage : undefined).toEqual({
      contextUsed: 15576,
      contextWindow: 258400,
    })
  })

  it("引擎自己换档要报出来，否则界面显示的档位会和实际悄悄分家", () => {
    const s = setup()
    handleUpdate(s.ctx, s.state, { sessionUpdate: "current_mode_update", currentModeId: "read-only" })
    expect(s.events.at(-1)).toMatchObject({ type: "engine.status", status: "ready" })
  })

  it("**引擎自己切档要落回驱动的状态**——不落回去，那个字段记的只是 omni 一厢情愿设过什么", () => {
    const s = setup()
    const seen: string[] = []
    handleUpdate(
      { ...s.ctx, onMode: (id) => seen.push(id) },
      s.state,
      { sessionUpdate: "current_mode_update", currentModeId: "plan" },
    )
    expect(seen).toEqual(["plan"])
  })

  it("没带 currentModeId 的那条不回调——「没报」不是「切成了 undefined」", () => {
    const s = setup()
    const seen: string[] = []
    handleUpdate({ ...s.ctx, onMode: (id) => seen.push(id) }, s.state, { sessionUpdate: "current_mode_update" })
    expect(seen).toEqual([])
  })

  it("认不出的更新静默丢弃，不掀翻会话——协议一直在加新类型", () => {
    const s = setup()
    expect(() => {
      handleUpdate(s.ctx, s.state, { sessionUpdate: "some_future_update" })
      handleUpdate(s.ctx, s.state, {})
    }).not.toThrow()
  })

  it("认不出的更新静默丢弃——协议一直在加新类型", () => {
    const s = setup()
    handleUpdate(s.ctx, s.state, { sessionUpdate: "session_info_update" })
    handleUpdate(s.ctx, s.state, { sessionUpdate: "config_option_update" })
    expect(s.events).toHaveLength(0)
  })
})

/**
 * ACP 没有「列命令」的请求方法，agent 是自己推过来的。以前这条通知被丢掉，
 * 于是 kimi / grok 的原生命令和 skill 在 `/` 面板里**一条都看不见**。
 */
describe("引擎自己认的斜杠命令", () => {
  const update = (commands: unknown): AcpUpdate =>
    ({ sessionUpdate: "available_commands_update", availableCommands: commands }) as AcpUpdate

  it("翻成 omni 的形状，参数提示从 input.hint 里取", () => {
    const s = setup()
    handleUpdate(
      s.ctx,
      s.state,
      update([
        { name: "compact", description: "压缩上下文", input: { hint: "要保留什么" } },
        { name: "context", description: "看上下文用量", input: null },
      ]),
    )
    expect(s.events).toEqual([
      {
        type: "commands.updated",
        at: 1000,
        threadId: "t1",
        engine: "acp:fake",
        commands: [
          { name: "compact", description: "压缩上下文", argumentHint: "要保留什么", source: "engine" },
          { name: "context", description: "看上下文用量", source: "engine" },
        ],
      },
    ])
  })

  // 名字就是要打进输入框的那串字。空的话面板上会多一条点了什么都不发生的命令
  it("没名字的丢掉，剩下的照发", () => {
    const s = setup()
    handleUpdate(s.ctx, s.state, update([{ name: "  " }, { description: "没名字" }, { name: "afk" }]))
    expect(s.events).toMatchObject([{ commands: [{ name: "afk", description: "", source: "engine" }] }])
  })

  // 后到的覆盖先到的（宿主按 threadId 只留最后一条），所以空清单也要发出去
  it("字段缺席不发，空清单照发", () => {
    const s = setup()
    handleUpdate(s.ctx, s.state, { sessionUpdate: "available_commands_update" })
    expect(s.events).toHaveLength(0)
    handleUpdate(s.ctx, s.state, update([]))
    expect(s.events).toMatchObject([{ type: "commands.updated", commands: [] }])
  })
})

/**
 * agent 自己把可选项换了。
 *
 * **强度的词表是跟着模型走的**：实测 ZCode 的 GLM-5.3 有 low/high/max，
 * 换到 GLM-5-Turbo 之后一个都没有——照旧摆着那三档的话，点下去引擎直接报错。
 */
describe("config_option_update：换完模型，可选项跟着换", () => {
  const optionsUpdate = (models: readonly string[], thought: readonly string[]): AcpUpdate => ({
    sessionUpdate: "config_option_update",
    configOptions: [
      {
        id: "model",
        category: "model",
        currentValue: models[0],
        options: models.map((value) => ({ value, name: value })),
      },
      ...(thought.length === 0
        ? []
        : [
            {
              id: "thought",
              category: "thought_level",
              currentValue: thought[0],
              options: thought.map((value) => ({ value })),
            },
          ]),
    ],
  })

  it("清单翻好了交给驱动——**由它落状态、由它转发**，这里不越界", () => {
    const { ctx, state } = setup()
    const seen: { models: readonly { id: string; efforts?: readonly string[] }[] }[] = []
    handleUpdate({ ...ctx, onCatalog: (c) => seen.push(c) }, state, optionsUpdate(["GLM-5.3"], ["low", "high", "max"]))
    expect(seen[0]?.models.map((m) => m.id)).toEqual(["GLM-5.3"])
    expect(seen[0]?.models[0]?.efforts).toEqual(["low", "high", "max"])
  })

  it("**新模型没有强度档时，那一节就该没了**", () => {
    const { ctx, state } = setup()
    const seen: { models: readonly { efforts?: readonly string[] }[] }[] = []
    handleUpdate({ ...ctx, onCatalog: (c) => seen.push(c) }, state, optionsUpdate(["GLM-5-Turbo"], []))
    expect(seen[0]?.models[0]?.efforts).toBeUndefined()
  })

  it("没人接也不崩——老驱动没挂这个回调", () => {
    const { ctx, state } = setup()
    expect(() => {
      handleUpdate(ctx, state, optionsUpdate(["a"], []))
    }).not.toThrow()
  })
})
