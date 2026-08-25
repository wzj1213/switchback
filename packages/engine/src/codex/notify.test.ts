import { describe, expect, it, vi } from "vitest"
import type { Event } from "@omni/protocol"
import { handleNotification, type NotifyContext } from "./notify.js"
import type { WireItem } from "./wire.js"

const setup = (): { ctx: NotifyContext; events: Event[] } => {
  const events: Event[] = []
  const ctx: NotifyContext = {
    threadId: "th-1",
    // 还没握手完就不知道自己的 id——那时一律放行（见 `ours`）。
    // 归属判定另有专门的用例
    codexThread: () => undefined,
    emit: (e) => events.push(e),
    turnId: () => "tn-1",
    inflight: new Map<string, WireItem>(),
    streamed: new Map<string, string>(),
    materialized: new Set<string>(),
    mcpSeen: new Map<string, string>(),
    now: () => 100,
  }
  return { ctx, events }
}

const lifecycle = (item: WireItem): unknown => ({ item, threadId: "cx-th", turnId: "cx-tn" })

describe("文本流式 item 的延迟落地", () => {
  it("空的 reasoning 从头到尾不产生任何事件——否则界面上多一条看不见的 item，把工具分组打断", () => {
    const { ctx, events } = setup()
    const item: WireItem = { type: "reasoning", id: "rs-1", summary: [], content: [] }
    handleNotification(ctx, "item/started", lifecycle(item))
    handleNotification(ctx, "item/completed", lifecycle(item))
    expect(events).toEqual([])
  })

  it("第一条 delta 才落地，落地时文本为空，随后才追加", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "item/started", lifecycle({ type: "agentMessage", id: "m1", text: "" }))
    expect(events).toEqual([])
    handleNotification(ctx, "item/agentMessage/delta", { threadId: "x", turnId: "y", itemId: "m1", delta: "好" })
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: "item.started", item: { id: "m1", kind: "agent_message", text: "" } })
    expect(events[1]).toEqual({ type: "item.delta", at: 100, itemId: "m1", append: "好" })
  })

  it("没有 delta 但完成时有文本，也要落地一次再更新", () => {
    const { ctx, events } = setup()
    const item: WireItem = { type: "agentMessage", id: "m2", text: "" }
    handleNotification(ctx, "item/started", lifecycle(item))
    handleNotification(ctx, "item/completed", lifecycle({ ...item, text: "一句话" }))
    expect(events.map((e) => e.type)).toEqual(["item.started", "item.updated"])
    expect(events[1]).toMatchObject({ item: { text: "一句话", complete: true } })
  })

  it("reasoning 的两种 delta 通知都认", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "item/started", lifecycle({ type: "reasoning", id: "r1" }))
    handleNotification(ctx, "item/reasoning/summaryTextDelta", { threadId: "x", turnId: "y", itemId: "r1", delta: "想" })
    handleNotification(ctx, "item/reasoning/textDelta", { threadId: "x", turnId: "y", itemId: "r1", delta: "法" })
    expect(events.filter((e) => e.type === "item.delta")).toHaveLength(2)
  })

  it("reasoning 新段落先切开已有文字，首段信号不制造空白 item", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "item/started", lifecycle({ type: "reasoning", id: "r2" }))
    handleNotification(ctx, "item/reasoning/summaryPartAdded", {
      threadId: "x", turnId: "y", itemId: "r2", summaryIndex: 0,
    })
    expect(events).toEqual([])
    handleNotification(ctx, "item/reasoning/summaryTextDelta", {
      threadId: "x", turnId: "y", itemId: "r2", delta: "第一段",
    })
    handleNotification(ctx, "item/reasoning/summaryPartAdded", {
      threadId: "x", turnId: "y", itemId: "r2", summaryIndex: 1,
    })
    handleNotification(ctx, "item/reasoning/summaryTextDelta", {
      threadId: "x", turnId: "y", itemId: "r2", delta: "第二段",
    })
    expect(events.flatMap((event) => event.type === "item.delta" ? [event.append] : []))
      .toEqual(["第一段", "\n", "第二段"])
  })
})

describe("工具类 item", () => {
  const exec: WireItem = { type: "commandExecution", id: "e1", command: "ls", status: "inProgress" }

  it("started 立刻发，completed 发整条替换值", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "item/started", lifecycle(exec))
    handleNotification(ctx, "item/completed", lifecycle({ ...exec, status: "completed", exitCode: 0 }))
    expect(events.map((e) => e.type)).toEqual(["item.started", "item.updated"])
    expect(events[0]).toMatchObject({ item: { status: "running" } })
    expect(events[1]).toMatchObject({ item: { status: "ok" } })
  })

  it("在途表在 started 时记下、completed 时清掉——审批要靠它说清批准的是什么", () => {
    const { ctx } = setup()
    handleNotification(ctx, "item/started", lifecycle(exec))
    expect(ctx.inflight.get("e1")).toMatchObject({ command: "ls" })
    handleNotification(ctx, "item/completed", lifecycle(exec))
    expect(ctx.inflight.has("e1")).toBe(false)
  })

  it("后台终端轮询更新等待态，stdin 写入留痕且 completed 快照不会抹掉", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "item/started", lifecycle(exec))
    handleNotification(ctx, "item/commandExecution/outputDelta", {
      threadId: "cx-th",
      turnId: "cx-tn",
      itemId: "e1",
      delta: "ready\n",
    })
    handleNotification(ctx, "item/commandExecution/terminalInteraction", {
      threadId: "cx-th",
      turnId: "cx-tn",
      itemId: "e1",
      processId: "42",
      stdin: "",
    })
    expect(events.at(-1)).toMatchObject({
      type: "item.updated",
      item: { detail: { output: "ready\n", terminal: { waiting: true, inputs: [] } } },
    })
    const waitingEvents = events.length
    handleNotification(ctx, "item/commandExecution/terminalInteraction", {
      threadId: "cx-th",
      turnId: "cx-tn",
      itemId: "e1",
      processId: "42",
      stdin: "",
    })
    expect(events).toHaveLength(waitingEvents)
    handleNotification(ctx, "item/commandExecution/terminalInteraction", {
      threadId: "cx-th",
      turnId: "cx-tn",
      itemId: "e1",
      processId: "42",
      stdin: "yes\n",
    })
    handleNotification(
      ctx,
      "item/completed",
      lifecycle({ ...exec, status: "completed", exitCode: 0 }),
    )
    expect(events.at(-1)).toMatchObject({
      type: "item.updated",
      item: { status: "ok", detail: { terminal: { waiting: false, inputs: ["yes\n"] } } },
    })
  })

  it("终端通知挂不到在途命令时静默忽略，不凭 processId 猜一条工具调用", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "item/commandExecution/terminalInteraction", {
      threadId: "cx-th",
      turnId: "cx-tn",
      itemId: "missing",
      processId: "42",
      stdin: "yes\n",
    })
    expect(events).toEqual([])
  })

  it("userMessage 不转发——宿主已经发过一条了", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "item/started", lifecycle({ type: "userMessage", id: "u1" }))
    expect(events).toEqual([])
  })

  it("上下文压缩生命周期原地收口成一条提示", () => {
    const { ctx, events } = setup()
    const item: WireItem = { type: "contextCompaction", id: "compact-1" }
    handleNotification(ctx, "item/started", lifecycle(item))
    handleNotification(ctx, "item/completed", lifecycle(item))
    expect(events.map((event) => event.type)).toEqual(["item.started", "item.updated"])
    expect(events).toMatchObject([
      { item: { id: "compact-1", kind: "notice", message: "上下文已压缩。" } },
      { item: { id: "compact-1", kind: "notice", message: "上下文已压缩。" } },
    ])
  })
})

describe("轮次与错误", () => {
  it("turn/completed 用宿主的 turnId，不用 codex 的", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "turn/completed", {
      threadId: "cx",
      turn: { id: "cx-tn", status: "completed" },
    })
    expect(events[0]).toEqual({ type: "turn.completed", at: 100, turnId: "tn-1", status: "completed" })
  })

  it("失败的轮次带上原因", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "turn/completed", {
      threadId: "cx",
      turn: { id: "cx-tn", status: "failed", error: { message: "上游超时" } },
    })
    expect(events[0]).toMatchObject({ status: "failed", error: "上游超时" })
  })

  it("willRetry 的错误不算终态——画一条红色失败会误导人", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "error", { error: { message: "429" }, willRetry: true })
    expect(events[0]).toMatchObject({ item: { kind: "error", fatal: false } })
  })

  it("带上引擎补的那句原因——`Reconnecting... 1/5` 一个字都没说为什么", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "error", {
      error: { message: "Reconnecting... 1/5", additionalDetails: "上游过载" },
      willRetry: true,
    })
    expect(events[0]).toMatchObject({ item: { message: "Reconnecting... 1/5", detail: "上游过载" } })
  })

  it("没报原因就不带这个字段——不替它编一句", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "error", { error: { message: "炸了", additionalDetails: null } })
    expect(events[0]).toMatchObject({ item: { kind: "error" } })
    expect(events[0]?.type === "item.started" && "detail" in events[0].item).toBe(false)
  })

  it("一次重连的五条只占一行：第一条起、后面原地更新", () => {
    const { ctx, events } = setup()
    for (const n of [1, 2, 3]) {
      handleNotification(ctx, "error", { error: { message: `Reconnecting... ${String(n)}/5` }, willRetry: true })
    }
    expect(events.map((e) => e.type)).toEqual(["item.started", "item.updated", "item.updated"])
    const ids = new Set(events.map((e) => (e.type === "item.started" || e.type === "item.updated" ? e.item.id : "")))
    expect(ids.size).toBe(1)
    expect(events[2]).toMatchObject({ item: { message: "Reconnecting... 3/5" } })
  })

  it("终态的错误各占一条——它们不是同一件事的第几次", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "error", { error: { message: "Reconnecting... 1/5" }, willRetry: true })
    handleNotification(ctx, "error", { error: { message: "上游 500" } })
    expect(events.map((e) => e.type)).toEqual(["item.started", "item.started"])
    expect(events[1]).toMatchObject({ item: { fatal: true } })
  })

  it("没有轮次时一律不发事件——事件没有归属会被 store 丢掉", () => {
    const events: Event[] = []
    const ctx: NotifyContext = {
      threadId: "th",
      codexThread: () => undefined,
      emit: (e) => events.push(e),
      turnId: () => undefined,
      inflight: new Map(),
      streamed: new Map(),
      materialized: new Set(),
      mcpSeen: new Map(),
      now: () => 0,
    }
    handleNotification(ctx, "item/started", lifecycle({ type: "commandExecution", id: "x" }))
    handleNotification(ctx, "turn/completed", { threadId: "c", turn: { id: "t", status: "completed" } })
    expect(events).toEqual([])
  })

  it("认不出的通知静默丢弃——codex 有 74 种通知，我们只消费一小撮", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "thread/backgroundTerminals/changed", { whatever: 1 })
    expect(events).toEqual([])
  })

  it("对端清掉反向 RPC 时按原始 request id 撤销宿主等待", () => {
    const { ctx } = setup()
    const resolved: (string | number)[] = []
    ctx.onServerRequestResolved = (id) => resolved.push(id)
    handleNotification(ctx, "serverRequest/resolved", { threadId: "cx", requestId: 0 })
    handleNotification(ctx, "serverRequest/resolved", { threadId: "cx", requestId: "req-2" })
    expect(resolved).toEqual([0, "req-2"])
  })

  it("skill 变化通知只发失效信号，不拿空参数冒充新清单", () => {
    const { ctx } = setup()
    const changed = vi.fn()
    ctx.onSkillsChanged = changed
    handleNotification(ctx, "skills/changed", {})
    expect(changed).toHaveBeenCalledOnce()
  })

  it("hook 起止交给会话跟踪器，轮次收工会解掉悬空运行态", () => {
    const { ctx } = setup()
    const hooks = { started: vi.fn(), completed: vi.fn(), settle: vi.fn(), close: vi.fn() }
    ctx.hooks = hooks
    const started = { turnId: "native", run: { id: "h", status: "running" } }
    const completed = { turnId: "native", run: { id: "h", status: "completed" } }
    handleNotification(ctx, "hook/started", started)
    handleNotification(ctx, "hook/completed", completed)
    handleNotification(ctx, "turn/completed", { turn: { id: "native", status: "completed" } })
    expect(hooks.started).toHaveBeenCalledWith(started)
    expect(hooks.completed).toHaveBeenCalledWith(completed)
    expect(hooks.settle).toHaveBeenCalledWith("tn-1", "completed")
  })

  it("异步 hook 的完成通知允许晚于原生轮次终态", () => {
    const { ctx } = setup()
    const completed = vi.fn()
    ctx.codexThread = () => "native-thread"
    ctx.codexTurn = () => "current-turn"
    ctx.settledTurns = new Set(["old-turn"])
    ctx.hooks = { started: vi.fn(), completed, settle: vi.fn(), close: vi.fn() }
    const lifecycle = {
      threadId: "native-thread", turnId: "old-turn", run: { id: "async-hook", status: "completed" },
    }
    handleNotification(ctx, "hook/completed", lifecycle)
    expect(completed).toHaveBeenCalledWith(lifecycle)
  })

  it("运行、安全、配置与弃用提示都进入统一用户出口", () => {
    const { ctx, events } = setup()
    for (const method of ["warning", "guardianWarning", "configWarning", "deprecationNotice"]) {
      handleNotification(ctx, method, method === "deprecationNotice"
        ? { summary: `${method} 原文`, details: "迁移说明" }
        : { message: `${method} 原文` })
    }
    expect(events).toHaveLength(4)
    expect(events.every((event) => event.type === "item.started" && event.item.kind === "notice")).toBe(true)
    expect(events[3]).toMatchObject({ item: { message: "deprecationNotice 原文\n迁移说明" } })
  })

  it("稀疏推送的空值不清额度——源码明确说 null 是本帧缺席", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "account/rateLimits/updated", { rateLimits: {} })
    handleNotification(ctx, "account/rateLimits/updated", { rateLimits: { primary: null, secondary: null } })
    expect(events).toEqual([])
  })

  it("额度报得出就发出去，字段照抄 codex 自己的形状", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "account/rateLimits/updated", {
      rateLimits: { primary: { usedPercent: 82.5, windowDurationMins: 10080, resetsAt: "2026-08-20T00:00:00Z" } },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "limits.updated",
      engine: "codex",
      limits: { primary: { usedPercent: 82.5, windowDurationMins: 10080 } },
    })
  })
})

describe("用量", () => {
  const usageParams = {
    threadId: "cx",
    tokenUsage: {
      last: { totalTokens: 15748 },
      total: { totalTokens: 47529 },
      modelContextWindow: 258400,
    },
  }

  it("取 last 而不是 total——total 是累计账单，会一路涨到远超窗口大小", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "thread/tokenUsage/updated", usageParams)
    expect(events[0]).toEqual({
      type: "usage.updated",
      at: 100,
      threadId: "th-1",
      engine: "codex",
      usage: { contextUsed: 15748, contextWindow: 258400, totalTokens: 47529 },
    })
  })

  it("没有 last 就不发事件，宁可不显示也不显示一个错的数", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "thread/tokenUsage/updated", { tokenUsage: { total: { totalTokens: 1 } } })
    expect(events).toEqual([])
  })

  it("用量与轮次无关——轮次结束后仍然要能报", () => {
    const events: Event[] = []
    const ctx: NotifyContext = {
      threadId: "th-1",
      codexThread: () => undefined,
      emit: (e) => events.push(e),
      turnId: () => undefined,
      inflight: new Map(),
      streamed: new Map(),
      materialized: new Set(),
      mcpSeen: new Map(),
      now: () => 100,
    }
    handleNotification(ctx, "thread/tokenUsage/updated", usageParams)
    expect(events).toHaveLength(1)
  })
})

describe("轮次异常收工时清扫在途工具", () => {
  const exec: WireItem = { type: "commandExecution", id: "e1", command: "sleep 40", status: "inProgress" }

  const withRunning = (): ReturnType<typeof setup> => {
    const h = setup()
    handleNotification(h.ctx, "item/started", lifecycle(exec))
    h.events.length = 0
    return h
  }

  it("中断时把在途工具收成 interrupted——不扫的话它永远停在 running", () => {
    const { ctx, events } = withRunning()
    handleNotification(ctx, "turn/completed", { threadId: "c", turn: { id: "t", status: "interrupted" } })
    expect(events[0]).toMatchObject({ type: "item.updated", item: { id: "e1", status: "interrupted" } })
    expect(events[1]).toMatchObject({ type: "turn.completed", status: "interrupted" })
  })

  it("失败时收成 failed", () => {
    const { ctx, events } = withRunning()
    handleNotification(ctx, "turn/completed", { threadId: "c", turn: { id: "t", status: "failed" } })
    expect(events[0]).toMatchObject({ item: { status: "failed" } })
  })

  it("正常收工仍有 running 工具时明确收成 failed——不能把协议缺口留成永远旋转", () => {
    const { ctx, events } = withRunning()
    handleNotification(ctx, "turn/completed", { threadId: "c", turn: { id: "t", status: "completed" } })
    expect(events[0]).toMatchObject({
      type: "item.updated",
      item: { id: "e1", status: "failed", error: expect.stringContaining("没有报告") },
    })
    expect(events[1]?.type).toBe("turn.completed")
  })

  it("命令输出流到一半被中断，收尾更新保留已经显示的输出", () => {
    const { ctx, events } = withRunning()
    handleNotification(ctx, "item/commandExecution/outputDelta", {
      threadId: "cx",
      turnId: "native",
      itemId: "e1",
      delta: "已经跑到这里\n",
    })
    handleNotification(ctx, "turn/completed", { threadId: "cx", turn: { id: "native", status: "interrupted" } })
    const closed = events.findLast((event) => event.type === "item.updated")
    expect(closed).toMatchObject({ item: { detail: { kind: "shell", output: "已经跑到这里\n" } } })
  })

  it("流式正文没有 item/completed 就失败时，也要收口并保住文字", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "item/started", lifecycle({ type: "agentMessage", id: "m-live", text: "" }))
    handleNotification(ctx, "item/agentMessage/delta", {
      threadId: "cx",
      turnId: "native",
      itemId: "m-live",
      delta: "半句话",
    })
    handleNotification(ctx, "turn/completed", { threadId: "cx", turn: { id: "native", status: "failed" } })
    const closed = events.findLast(
      (event) => event.type === "item.updated" && event.item.kind === "agent_message",
    )
    expect(closed).toMatchObject({ item: { text: "半句话", complete: true } })
  })

  it("没落地过的 item 不补事件——补了就凭空多一条界面上从来没出现过的工具行", () => {
    const { ctx, events } = setup()
    ctx.inflight.set("ghost", exec)
    handleNotification(ctx, "turn/completed", { threadId: "c", turn: { id: "t", status: "interrupted" } })
    expect(events).toHaveLength(1)
  })

  it("扫完清空在途表，下一轮不会重复收尾", () => {
    const { ctx } = withRunning()
    handleNotification(ctx, "turn/completed", { threadId: "c", turn: { id: "t", status: "interrupted" } })
    expect(ctx.inflight.size).toBe(0)
  })
})

describe("重置时刻：codex 给的是 Unix 秒，不是 ISO 字符串", () => {
  const limitsOf = (resetsAt: unknown): Event | undefined => {
    const { ctx, events } = setup()
    handleNotification(ctx, "account/rateLimits/updated", {
      rateLimits: { primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt } },
    })
    return events.find((e) => e.type === "limits.updated")
  }

  it("**数字按秒换算**——上一版只认字符串，于是重置时刻被整个丢掉，一声不响", () => {
    const e = limitsOf(1787196555)
    expect(e?.type === "limits.updated" ? e.limits.primary?.resetsAt : undefined).toBe(
      new Date(1787196555 * 1000).toISOString(),
    )
  })

  it("字符串原样过：万一哪天 codex 改成 ISO，不用再改一次", () => {
    const e = limitsOf("2026-08-20T03:29:15.000Z")
    expect(e?.type === "limits.updated" ? e.limits.primary?.resetsAt : undefined).toBe("2026-08-20T03:29:15.000Z")
  })

  it("**不认毫秒**：1787196555 当毫秒解出来是 1970 年，一个明显错误的时间比没有更糟", () => {
    const e = limitsOf(1787196555)
    const iso = e?.type === "limits.updated" ? e.limits.primary?.resetsAt : undefined
    expect(iso?.startsWith("2026")).toBe(true)
  })

  it("报不上来就缺席，别编一个", () => {
    for (const bad of [undefined, null, 0, -5, "", Number.NaN]) {
      const e = limitsOf(bad)
      expect(e?.type === "limits.updated" ? e.limits.primary?.resetsAt : "缺席").toBeUndefined()
    }
  })
})

describe("MCP 服务器起不来：静默的能力损失必须出声", () => {
  const report = (params: Record<string, unknown>, seen = new Map<string, string>()): Event[] => {
    const { ctx, events } = setup()
    handleNotification({ ...ctx, mcpSeen: seen }, "mcpServer/startupStatus/updated", params)
    return events
  }

  it("`ready` 不出声——平时它是纯噪声", () => {
    expect(report({ name: "doc-manager", status: "ready" })).toEqual([])
  })

  it("`starting` 也不出声：一次启动实测 17 条通知", () => {
    expect(report({ name: "doc-manager", status: "starting" })).toEqual([])
  })

  it("**没见过的 status 一律当失败**——失败态的字面量没实测到，猜错了就是永远不报警", () => {
    const [e] = report({ name: "doc-manager", status: "failed" })
    expect(e).toMatchObject({ type: "engine.status", status: "degraded" })
  })

  it("**`cancelled` 不算失败**——实测一次启动五台同时报它，而那几台后来都好好的", () => {
    expect(report({ name: "codex_apps", status: "cancelled", failureReason: "cancelled" })).toEqual([])
  })

  it("没见过的状态带了原因，就把原因摊出来", () => {
    const [e] = report({ name: "node_repl", status: "boom", failureReason: "命令找不到" })
    expect(e?.type === "engine.status" ? e.detail : "").toContain("命令找不到")
  })

  it("**报 degraded 不报 crashed**：引擎好好的，撒谎会把排查引到错的方向", () => {
    const [e] = report({ name: "x", status: "boom" })
    expect(e?.type === "engine.status" ? e.status : "").toBe("degraded")
  })

  it("说清是哪台服务器、以及后果", () => {
    const [e] = report({ name: "doc-manager", status: "boom" })
    const detail = e?.type === "engine.status" ? (e.detail ?? "") : ""
    expect(detail).toContain("doc-manager")
    expect(detail).toContain("用不了")
  })

  it("**同一个状态只说一次**，翻面才再说——否则不是提示是刷屏", () => {
    const seen = new Map<string, string>()
    expect(report({ name: "x", status: "boom" }, seen)).toHaveLength(1)
    expect(report({ name: "x", status: "boom" }, seen)).toHaveLength(0)
    expect(report({ name: "x", status: "ready" }, seen)).toHaveLength(0)
    expect(report({ name: "x", status: "boom" }, seen)).toHaveLength(1)
  })

  it("没有名字的一律不管——说不出是哪台服务器的警报没有用", () => {
    expect(report({ status: "boom" })).toEqual([])
  })
})

/**
 * **同一条 stdio 上可能跑多条 thread。** 今天 omni 一个进程只开一条，所以判不出区别；
 * 但 app-server 一条连接本来就能带多条，而分叉、子 agent、后台轮次都会往那儿走。
 * 到那时串了不会报错——只会把别的会话的正文画进这一条。
 */
describe("通知的会话归属", () => {
  function ctxOf(mine: string | undefined) {
    const events: Event[] = []
    return {
      events,
      ctx: {
        threadId: "th-1",
        codexThread: () => mine,
        emit: (e: Event) => events.push(e),
        turnId: () => "t-1",
        inflight: new Map(),
        streamed: new Map(),
        materialized: new Set<string>(),
        mcpSeen: new Map(),
        now: () => 0,
      } as unknown as NotifyContext,
    }
  }

  const note = (threadId: string): unknown => ({
    item: { id: "i1", item_type: "agentMessage", text: "喂" },
    threadId,
    turnId: "tn",
  })

  it("是我这条 thread 的才处理", () => {
    const h = ctxOf("cx-1")
    handleNotification(h.ctx, "item/completed", note("cx-1"))
    expect(h.events.length).toBeGreaterThan(0)
  })

  it("**别条 thread 的整条丢掉**——不然它的正文会画进这条会话", () => {
    const h = ctxOf("cx-1")
    handleNotification(h.ctx, "item/completed", note("cx-2"))
    expect(h.events).toEqual([])
  })

  it("自己还不知道 id 时放行——握手完成之前就有通知到，拦掉等于丢开场", () => {
    const h = ctxOf(undefined)
    handleNotification(h.ctx, "item/completed", note("cx-9"))
    expect(h.events.length).toBeGreaterThan(0)
  })

  it("**通知不带 threadId 也放行**：用量和错误那两条它是可选的，拦掉就再也收不到", () => {
    const h = ctxOf("cx-1")
    handleNotification(h.ctx, "thread/tokenUsage/updated", { tokenUsage: { last: { totalTokens: 7 } } })
    expect(h.events.filter((e) => e.type === "usage.updated")).toHaveLength(1)
  })

  it("上一轮迟到的通知不会挂到当前轮", () => {
    const h = ctxOf("cx-1")
    h.ctx.codexTurn = () => "native-current"
    handleNotification(h.ctx, "item/completed", {
      threadId: "cx-1",
      turnId: "native-old",
      item: { type: "agentMessage", id: "late", text: "迟到" },
    })
    expect(h.events).toEqual([])
  })

  it("新轮 start 尚未回包时，已结算旧轮的重复通知也不会收掉新轮", () => {
    const h = ctxOf("cx-1")
    h.ctx.codexTurn = () => undefined
    h.ctx.settledTurns = new Set(["native-old"])
    handleNotification(h.ctx, "turn/completed", {
      threadId: "cx-1",
      turn: { id: "native-old", status: "completed" },
    })
    expect(h.events).toEqual([])
  })

  it("本轮通知先于 start 回包时先认领 native id，随后拒绝别轮事件", () => {
    const h = ctxOf("cx-1")
    let native: string | undefined
    h.ctx.codexTurn = () => native
    h.ctx.adoptCodexTurn = (turnId) => {
      native = turnId
    }
    handleNotification(h.ctx, "item/started", {
      threadId: "cx-1",
      turnId: "native",
      item: { type: "agentMessage", id: "m1", text: "" },
    })
    expect(native).toBe("native")
    handleNotification(h.ctx, "item/completed", {
      threadId: "cx-1",
      turnId: "other",
      item: { type: "agentMessage", id: "m2", text: "不该出现" },
    })
    expect(h.events).toEqual([])
  })

  it("正常收工先清内部轮次，重复的 turn/completed 不会再终结一次", () => {
    const h = ctxOf("cx-1")
    let turn: string | undefined = "t-1"
    let native: string | undefined = "native-1"
    h.ctx.turnId = () => turn
    h.ctx.codexTurn = () => native
    h.ctx.settleTurn = () => {
      turn = undefined
      native = undefined
    }
    const ended = { threadId: "cx-1", turn: { id: "native-1", status: "completed" } }
    handleNotification(h.ctx, "turn/completed", ended)
    handleNotification(h.ctx, "turn/completed", ended)
    expect(h.events.filter((event) => event.type === "turn.completed")).toHaveLength(1)
  })
})
