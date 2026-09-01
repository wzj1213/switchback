import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES, type EngineAxis, type EngineGoal, type Event } from "@omni/protocol"
import type { EngineDriver, EngineSession, StartRequest } from "@omni/engine"
import { createHost, type Host } from "./host.js"

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  const slot: { resolve?: (value: T) => void } = {}
  const promise = new Promise<T>((resolve) => {
    slot.resolve = resolve
  })
  return {
    promise,
    resolve: (value) => {
      slot.resolve?.(value)
    },
  }
}

interface Probe {
  engine: string
  resume?: string
  prompts: { text: string; turnId: string; attachments?: readonly string[] }[]
  disposed: boolean
  emit: (event: Event) => void
  handle: (handle: string) => void
  drift: (model?: string, effort?: string) => void
  report: (patch: { axes?: readonly EngineAxis[]; modelId?: string }) => void
  goal: (goal: EngineGoal | undefined) => void
}

interface Rig {
  host: Host
  events: Event[]
  probes: Probe[]
}

function emitEarly(req: StartRequest, engine: string, enabled: ReadonlySet<string> | undefined): void {
  if (enabled?.has(engine) !== true) return
  req.emit({
    type: "engine.status",
    at: 0,
    threadId: req.threadId,
    status: "starting",
    detail: `early-${engine}`,
  })
}

function probeOf(req: StartRequest, engine: string): Probe {
  return {
    engine,
    ...(req.resume === undefined ? {} : { resume: req.resume }),
    prompts: [],
    disposed: false,
    emit: req.emit,
    handle: (handle) => req.onHandle?.(handle),
    drift: (model, effort) => req.onModel?.(model, effort),
    report: (patch) => req.onEngineState?.(patch),
    goal: (goal) => req.onGoal?.(goal),
  }
}

function rigOf(options: {
  startGate?: Readonly<Record<string, Deferred<undefined>>>
  logGate?: Readonly<Record<string, Deferred<string>>>
  promptGate?: Readonly<Record<string, Deferred<undefined>>>
  rejectPrompt?: ReadonlySet<string>
  failStart?: ReadonlySet<string>
  failCapabilities?: ReadonlySet<string>
  earlyEvent?: ReadonlySet<string>
  earlySignals?: boolean
  noAttachments?: ReadonlySet<string>
  deps?: {
    ensure?: (threadId: string, cwd: string) => Promise<void>
    capture?: (threadId: string, cwd: string) => Promise<void>
    remove?: (threadId: string) => Promise<void>
  }
} = {}): Rig {
  const events: Event[] = []
  const probes: Probe[] = []
  const driver = (engine: string): EngineDriver => ({
    id: engine,
    start: async (req) => {
      const probe = probeOf(req, engine)
      probes.push(probe)
      emitEarly(req, engine, options.earlyEvent)
      if (options.earlySignals === true) {
        req.onModel?.("startup-model", "max")
        req.onEngineState?.({
          axes: [{ axis: "mode", id: "startup-mode", match: "aligned" }],
          modelId: "startup-native",
        })
        req.onTrustApply?.({ result: "applied", at: 7 })
        req.onGoal?.({
          objective: "startup-goal",
          status: "active",
          tokensUsed: 3,
          timeUsedSeconds: 1,
        })
      }
      await options.startGate?.[engine]?.promise
      if (options.failStart?.has(engine) === true) throw new Error(`${engine} start failed`)
      return {
        threadId: req.threadId,
        prompt: (text, turnId, attachments) => {
          probe.prompts.push({
            text,
            turnId,
            ...(attachments === undefined ? {} : { attachments }),
          })
          if (options.rejectPrompt?.has(engine) === true) {
            return Promise.reject(new Error("prompt RPC failed"))
          }
          return options.promptGate?.[text]?.promise ?? Promise.resolve()
        },
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([]),
        capabilities: () => {
          if (options.failCapabilities?.has(engine) === true) throw new Error("capabilities failed")
          return { ...NO_CAPABILITIES, attachments: options.noAttachments?.has(engine) !== true }
        },
        setModel: () => Promise.resolve({}),
        logPath: options.logGate?.[engine] === undefined
          ? undefined
          : () => options.logGate?.[engine]?.promise ?? Promise.resolve(""),
        dispose: () => {
          probe.disposed = true
          return Promise.resolve()
        },
      } as EngineSession
    },
  })
  const counter = { value: 0 }
  const host = createHost({
    drivers: { a: driver("a"), b: driver("b") },
    home: "/home/dev",
    emit: (event) => events.push(event),
    newId: (prefix) => {
      counter.value += 1
      return `${prefix}-${String(counter.value)}`
    },
    now: () => 1,
    ...(options.deps?.ensure === undefined
      ? {}
      : { ensureWorktreeBaseline: options.deps.ensure }),
    ...(options.deps?.capture === undefined
      ? {}
      : { captureTurnBaseline: options.deps.capture }),
    ...(options.deps?.remove === undefined
      ? {}
      : { removeWorktreeBaseline: options.deps.remove }),
  })
  return { host, events, probes }
}

const create = { type: "thread.create", cwd: "/w", engine: "a", trust: "auto-edit" } as const

async function created(rig: Rig): Promise<string> {
  await rig.host.dispatch(create)
  return rig.events.find((event) => event.type === "thread.started")?.thread.id ?? ""
}

function complete(probe: Probe, status: "completed" | "failed" = "completed"): void {
  const turnId = probe.prompts.at(-1)?.turnId ?? ""
  probe.emit({ type: "turn.completed", at: 2, turnId, status })
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe("换引擎的在途竞态", () => {
  it("握手完成前上报的模型、原生状态和权限结果会进入出生快照", async () => {
    const rig = rigOf({ earlySignals: true })
    await created(rig)
    expect(rig.host.live()[0]).toMatchObject({
      model: "startup-model",
      effort: "max",
      engineState: {
        axes: [{ axis: "mode", id: "startup-mode", match: "aligned" }],
        modelId: "startup-native",
      },
      trustApply: { result: "applied", at: 7 },
      goal: { objective: "startup-goal", status: "active", tokensUsed: 3, timeUsedSeconds: 1 },
    })
  })

  it("切到不支持附件的引擎后不会把旧附件误发出去", async () => {
    const rig = rigOf({ noAttachments: new Set(["b"]) })
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "先开过工" })
    complete(rig.probes[0] as Probe)
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })

    await expect(
      rig.host.dispatch({
        type: "thread.prompt",
        threadId: id,
        text: "带图继续",
        attachments: ["/tmp/kept.png"],
      }),
    ).rejects.toThrow("不支持附件")
    expect(rig.probes[1]?.prompts).toEqual([])
    expect(rig.host.live()[0]).toMatchObject({ engine: "b", status: "idle" })
  })

  it("同一拍连点两次分叉只启动一个派生会话", async () => {
    const rig = rigOf()
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "先开过工" })
    complete(rig.probes[0] as Probe)

    await Promise.all([
      rig.host.dispatch({ type: "thread.fork", threadId: id, to: "b" }),
      rig.host.dispatch({ type: "thread.fork", threadId: id, to: "b" }),
    ])
    expect(rig.probes.filter((probe) => probe.engine === "b")).toHaveLength(1)
  })

  it("派生引擎握手期的状态不会排在会话出生之前", async () => {
    const rig = rigOf({ earlyEvent: new Set(["b"]) })
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.fork", threadId: id, to: "b" })
    const derived = rig.host.live().find((thread) => thread.engine === "b")
    const bornAt = rig.events.findIndex(
      (event) => event.type === "thread.started" && event.thread.id === derived?.id,
    )
    const statusAt = rig.events.findIndex(
      (event) => event.type === "engine.status" && event.detail === "early-b",
    )
    expect(bornAt).toBeGreaterThanOrEqual(0)
    expect(statusAt).toBeGreaterThan(bornAt)
  })

  it("分叉握手时新建任务会安静取消旧分叉，不冒伪失败", async () => {
    const gate = deferred<undefined>()
    const rig = rigOf({ startGate: { b: gate } })
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "先开过工" })
    complete(rig.probes[0] as Probe)

    const forking = rig.host.dispatch({ type: "thread.fork", threadId: id, to: "b" })
    await tick()
    await rig.host.dispatch(create)
    gate.resolve(undefined)
    await expect(forking).resolves.toBeUndefined()
    expect(rig.probes.find((probe) => probe.engine === "b")?.disposed).toBe(true)
    expect(rig.host.live().some((thread) => thread.engine === "b")).toBe(false)
  })

  it("新引擎不会继承上一家的原生状态镜像", async () => {
    const rig = rigOf()
    const id = await created(rig)
    rig.probes[0]?.report({ modelId: "a-native" })
    expect(rig.host.live()[0]?.engineState?.modelId).toBe("a-native")
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })
    expect(rig.host.live()[0]?.engineState).toBeUndefined()
  })

  it("新引擎不会继承上一家的长期目标", async () => {
    const rig = rigOf()
    const id = await created(rig)
    rig.probes[0]?.goal({ objective: "A 的目标", status: "active", tokensUsed: 2, timeUsedSeconds: 1 })
    expect(rig.host.live()[0]?.goal?.objective).toBe("A 的目标")
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })
    expect(rig.host.live()[0]?.goal).toBeUndefined()
  })

  it("运行中点立即切换会拒绝，不遗留一个永远 running 的旧 Turn", async () => {
    const rig = rigOf()
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "正在跑" })
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })
    await expect(rig.host.dispatch({ type: "thread.switchNow", threadId: id })).rejects.toThrow(
      "尚未结束",
    )
    expect(rig.probes).toHaveLength(1)
    expect(rig.host.live()[0]?.status).toBe("running")
    complete(rig.probes[0] as Probe)
    expect(rig.host.live()[0]?.status).toBe("idle")
  })

  it("立即切换连点两次只启动一个新引擎", async () => {
    const gate = deferred<undefined>()
    const rig = rigOf({ startGate: { b: gate } })
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "先开过工" })
    complete(rig.probes[0] as Probe)
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })
    const first = rig.host.dispatch({ type: "thread.switchNow", threadId: id })
    const second = rig.host.dispatch({ type: "thread.switchNow", threadId: id })
    await tick()
    expect(rig.probes).toHaveLength(2)
    gate.resolve(undefined)
    await Promise.all([first, second])
    expect(rig.probes.filter((probe) => probe.engine === "b")).toHaveLength(1)
  })

  it("发送消息兑现待切换与立即切换同拍时，也只启动一个新引擎", async () => {
    const rig = rigOf()
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "先开过工" })
    complete(rig.probes[0] as Probe)
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })
    await Promise.all([
      rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "由 B 接着做" }),
      rig.host.dispatch({ type: "thread.switchNow", threadId: id }),
    ])
    expect(rig.probes).toHaveLength(2)
    expect(rig.probes[1]?.prompts.map((prompt) => prompt.text)).toEqual(["由 B 接着做"])
  })

  it("接力握手期间发出的第二句会排队，第一句收工后再送达", async () => {
    const gate = deferred<undefined>()
    const rig = rigOf({ startGate: { b: gate } })
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "先开过工" })
    complete(rig.probes[0] as Probe)
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })

    const switching = rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "切过去的第一句" })
    await tick()
    await rig.host.dispatch({
      type: "thread.prompt",
      threadId: id,
      text: "握手时的第二句",
      attachments: ["/tmp/queued.png"],
    })
    gate.resolve(undefined)
    await switching
    const next = rig.probes[1] as Probe
    expect(next.prompts.map((prompt) => prompt.text)).toEqual(["切过去的第一句"])
    expect(rig.host.live()[0]?.queued).toEqual(["握手时的第二句"])
    expect(rig.host.live()[0]?.queuedAttachments).toEqual([["/tmp/queued.png"]])

    complete(next)
    await tick()
    expect(next.prompts.map((prompt) => prompt.text)).toEqual([
      "切过去的第一句",
      "握手时的第二句",
    ])
    expect(next.prompts[1]?.attachments).toEqual(["/tmp/queued.png"])
  })

  it("接力握手期间取回的文字和附件会跟进新会话，不留在旧过渡壳", async () => {
    const gate = deferred<undefined>()
    const rig = rigOf({ startGate: { b: gate } })
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "先开过工" })
    complete(rig.probes[0] as Probe)
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })

    const switching = rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "触发切换" })
    await tick()
    await rig.host.dispatch({
      type: "thread.prompt",
      threadId: id,
      text: "握手时取回",
      attachments: ["/tmp/take-back-during-switch.png"],
    })
    await rig.host.dispatch({ type: "thread.unqueue", threadId: id })
    gate.resolve(undefined)
    await switching

    expect(rig.probes[1]?.prompts.map((prompt) => prompt.text)).toEqual(["触发切换"])
    expect(rig.host.live()[0]).toMatchObject({
      engine: "b",
      queued: [],
      draft: "握手时取回",
      draftAttachments: ["/tmp/take-back-during-switch.png"],
    })
  })

  it("接力启动失败时，握手期间排入的消息仍在界面队列里", async () => {
    const gate = deferred<undefined>()
    const rig = rigOf({ startGate: { b: gate }, failStart: new Set(["b"]) })
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "先开过工" })
    complete(rig.probes[0] as Probe)
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })

    const switching = rig.host.dispatch({
      type: "thread.prompt",
      threadId: id,
      text: "触发切换",
      attachments: ["/tmp/trigger.png"],
    })
    await tick()
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "不能丢的第二句" })
    gate.resolve(undefined)
    await expect(switching).rejects.toThrow("b start failed")
    expect(rig.host.live()[0]).toMatchObject({
      engine: "a",
      nextEngine: "b",
      queued: ["触发切换", "不能丢的第二句"],
      queuedAttachments: [["/tmp/trigger.png"], []],
    })
  })

  it("队首消息兑现接力失败时原位保留，不会重复排入", async () => {
    const rig = rigOf({ failStart: new Set(["b"]) })
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "先开过工" })
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })
    await rig.host.dispatch({
      type: "thread.prompt",
      threadId: id,
      text: "只留一份",
      attachments: ["/tmp/once.png"],
    })

    complete(rig.probes[0] as Probe)
    await tick()
    await tick()
    expect(rig.host.live()[0]).toMatchObject({
      engine: "a",
      nextEngine: "b",
      queued: ["只留一份"],
      queuedAttachments: [["/tmp/once.png"]],
    })
  })

  it("慢接力期间删除会话，新引擎会自毁且不会用迟到更新复活", async () => {
    const gate = deferred<undefined>()
    const rig = rigOf({ startGate: { b: gate } })
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "先开过工" })
    complete(rig.probes[0] as Probe)
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })
    const switching = rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "触发切换" })
    await tick()
    await rig.host.dispatch({ type: "thread.delete", threadId: id })
    gate.resolve(undefined)
    await expect(switching).rejects.toThrow("已经删除")

    expect(rig.host.live()).toEqual([])
    expect(rig.probes[1]?.disposed).toBe(true)
    const removedAt = rig.events.findLastIndex((event) => event.type === "thread.removed")
    expect(rig.events.slice(removedAt + 1).filter((event) => event.type === "thread.updated")).toEqual([])
  })

  it("旧引擎迟到的句柄、模型、状态和事件都不能覆盖新引擎", async () => {
    const rig = rigOf()
    const id = await created(rig)
    const old = rig.probes[0] as Probe
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })
    const current = rig.probes[1] as Probe
    current.handle("b-handle")
    current.drift("b-model", "high")
    current.report({ modelId: "b-native" })
    current.goal({ objective: "B 的目标", status: "active", tokensUsed: 0, timeUsedSeconds: 0 })
    const before = rig.events.length

    old.handle("late-a-handle")
    old.drift("late-a-model", "low")
    old.report({ modelId: "late-a-native" })
    old.goal({ objective: "迟到的 A 目标", status: "active", tokensUsed: 0, timeUsedSeconds: 0 })
    old.emit({ type: "engine.status", at: 3, threadId: id, status: "degraded", detail: "late" })

    expect(rig.events).toHaveLength(before)
    expect(rig.host.live()[0]).toMatchObject({
      engine: "b",
      engineHandle: "b-handle",
      model: "b-model",
      effort: "high",
      engineState: { modelId: "b-native" },
      goal: { objective: "B 的目标" },
    })
  })

  it("A→B→A 即使 logPath 还没返回，也会续上 A 的旧句柄", async () => {
    const log = deferred<string>()
    const rig = rigOf({ logGate: { a: log } })
    const id = await created(rig)
    const first = rig.probes[0] as Probe
    first.handle("a-handle")
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "A 做事" })
    complete(first)
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })
    await rig.host.dispatch({ type: "thread.switchNow", threadId: id })
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "a" })
    await rig.host.dispatch({ type: "thread.switchNow", threadId: id })

    expect(rig.probes[2]?.resume).toBe("a-handle")
    log.resolve("/logs/a.jsonl")
    await tick()
    expect(rig.host.live()[0]?.segments?.[0]?.logPath).toBe("/logs/a.jsonl")
  })

  /**
   * 上一版只按「这条会话跑过这家没有」去重，于是 A→B→A 只留两段——
   * **切回 A 的那一刻在时间线上不存在**。转录区那条「切换至 A」、
   * 左缘导航的归属、以及「中途换过引擎」的次数全都要从这里读。
   */
  it("A→B→A 记三段，第三段续用 A 的旧句柄但另起时刻", async () => {
    const rig = rigOf({})
    const id = await created(rig)
    const first = rig.probes[0] as Probe
    first.handle("a-handle")
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "A 做事" })
    complete(first)
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })
    await rig.host.dispatch({ type: "thread.switchNow", threadId: id })
    const second = rig.probes[1] as Probe
    second.handle("b-handle")
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "B 做事" })
    complete(second)
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "a" })
    await rig.host.dispatch({ type: "thread.switchNow", threadId: id })
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "A 接着做" })

    expect(rig.host.live()[0]?.segments?.map((seg) => [seg.engine, seg.handle])).toEqual([
      ["a", "a-handle"],
      ["b", "b-handle"],
      ["a", "a-handle"],
    ])
  })

  it("同一家连着跑几轮仍然只记一段", async () => {
    const rig = rigOf({})
    const id = await created(rig)
    const first = rig.probes[0] as Probe
    first.handle("a-handle")
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    complete(first)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第二句" })
    complete(first)
    expect(rig.host.live()[0]?.segments).toHaveLength(1)
  })
})

describe("失败收口与基线生命周期", () => {
  it("首句 prompt RPC 很慢时，第二句立即出现在宿主队列", async () => {
    const gate = deferred<undefined>()
    const rig = rigOf({ promptGate: { "慢首句": gate } })
    const id = await created(rig)
    const first = rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "慢首句" })
    await tick()

    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "马上排队" })
    expect(rig.host.live()[0]?.queued).toEqual(["马上排队"])
    gate.resolve(undefined)
    await first
  })

  it("取回待发内容由宿主恢复文字与附件，不靠界面先复制再清队列", async () => {
    const rig = rigOf()
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    await rig.host.dispatch({
      type: "thread.prompt",
      threadId: id,
      text: "取回这句",
      attachments: ["/tmp/take-back.png"],
    })
    await rig.host.dispatch({ type: "thread.unqueue", threadId: id })
    expect(rig.host.live()[0]).toMatchObject({
      queued: [],
      draft: "取回这句",
      draftAttachments: ["/tmp/take-back.png"],
      draftRevision: expect.stringMatching(/^dr/),
    })
  })

  it("**按下标取回一条**：其余几句原样排着，不会被一起端走", async () => {
    const rig = rigOf()
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "排队甲" })
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "排队乙" })
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "排队丙" })
    await rig.host.dispatch({ type: "thread.unqueue", threadId: id, index: 1 })
    expect(rig.host.live()[0]).toMatchObject({
      queued: ["排队甲", "排队丙"],
      // **只有那一条进草稿**：上一版会把甲乙丙用换行拼成一段，拼完就分不开了
      draft: "排队乙",
    })
  })

  it("按下标取回只带走那一条的附件", async () => {
    const rig = rigOf()
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "甲", attachments: ["/tmp/a.png"] })
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "乙", attachments: ["/tmp/b.png"] })
    // 「第一句」当场就跑了，没进队列——所以乙在队列里的下标是 1
    await rig.host.dispatch({ type: "thread.unqueue", threadId: id, index: 1 })
    expect(rig.host.live()[0]).toMatchObject({ draft: "乙", draftAttachments: ["/tmp/b.png"] })
    expect(rig.host.live()[0]?.queued).toEqual(["甲"])
  })

  it("越界或不是整数的下标一律当没说过——远程也能发这条命令", async () => {
    const rig = rigOf()
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "排队甲" })
    for (const index of [-1, 0.5, 9, 99]) {
      await rig.host.dispatch({ type: "thread.unqueue", threadId: id, index })
    }
    expect(rig.host.live()[0]?.queued).toEqual(["排队甲"])
    expect(rig.host.live()[0]?.draft).toBeUndefined()
  })

  it("下标缺席仍是整队取回：「算了都不发了」也是个真实的动作", async () => {
    const rig = rigOf()
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "甲" })
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "乙" })
    await rig.host.dispatch({ type: "thread.unqueue", threadId: id })
    expect(rig.host.live()[0]).toMatchObject({ queued: [], draft: "甲\n乙" })
  })

  it("正在续发的那一条按下标也取不回——它已经交出去了", async () => {
    const gate = deferred<undefined>()
    const rig = rigOf({ promptGate: { "正在续发": gate } })
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "正在续发" })
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "后面那句" })
    complete(rig.probes[0] as Probe)

    await rig.host.dispatch({ type: "thread.unqueue", threadId: id, index: 0 })
    expect(rig.host.live()[0]?.queued).toEqual(["正在续发", "后面那句"])
    expect(rig.host.live()[0]?.draft).toBeUndefined()
    gate.resolve(undefined)
    await tick()
  })

  it("只有带着当前草稿身份的发送会消费取回内容", async () => {
    const rig = rigOf()
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "取回再改" })
    await rig.host.dispatch({ type: "thread.unqueue", threadId: id })
    const revision = rig.host.live()[0]?.draftRevision
    expect(revision).toBeDefined()

    await rig.host.dispatch({
      type: "thread.prompt",
      threadId: id,
      text: "改好后排队",
      draftRevision: revision,
    })
    expect(rig.host.live()[0]).toMatchObject({ queued: ["改好后排队"] })
    expect(rig.host.live()[0]?.draft).toBeUndefined()
    expect(rig.host.live()[0]?.draftRevision).toBeUndefined()
  })

  it("自动续发已经开始时，取回不会把同一句复制回输入区造成重复发送", async () => {
    const gate = deferred<undefined>()
    const rig = rigOf({ promptGate: { "正在续发": gate } })
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "正在续发" })
    complete(rig.probes[0] as Probe)

    await rig.host.dispatch({ type: "thread.unqueue", threadId: id })
    expect(rig.host.live()[0]).toMatchObject({ queued: ["正在续发"] })
    expect(rig.host.live()[0]?.draft).toBeUndefined()
    gate.resolve(undefined)
    await tick()
    expect(rig.host.live()[0]?.queued).toEqual([])
    expect(rig.probes[0]?.prompts.map((prompt) => prompt.text)).toEqual(["第一句", "正在续发"])
  })

  it("prompt RPC 拒绝会补 failed completion，宿主不再卡在 running", async () => {
    const rig = rigOf({ rejectPrompt: new Set(["a"]) })
    const id = await created(rig)
    await expect(
      rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "发不出去" }),
    ).rejects.toThrow("prompt RPC failed")
    expect(rig.events.filter((event) => event.type === "turn.completed").at(-1)).toMatchObject({
      status: "failed",
    })
    expect(rig.host.live()[0]?.status).toBe("failed")
  })

  it("队列里的下一句只有成功送达才删除，RPC 拒绝后仍可见", async () => {
    const rejecting = new Set<string>()
    const rig = rigOf({ rejectPrompt: rejecting })
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "排队这句" })
    rejecting.add("a")
    complete(rig.probes[0] as Probe)
    await tick()
    expect(rig.host.live()[0]).toMatchObject({ status: "failed", queued: ["排队这句"] })
  })

  it("当前轮次失败时不替用户删除后面排好的文字与附件", async () => {
    const rig = rigOf()
    const id = await created(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    await rig.host.dispatch({
      type: "thread.prompt",
      threadId: id,
      text: "失败后还要保留",
      attachments: ["/tmp/keep.png"],
    })
    complete(rig.probes[0] as Probe, "failed")
    expect(rig.host.live()[0]).toMatchObject({
      status: "failed",
      queued: ["失败后还要保留"],
      queuedAttachments: [["/tmp/keep.png"]],
    })
  })

  it("引擎启动前先完成基线，删除会话时一起回收", async () => {
    const gate = deferred<undefined>()
    const calls: string[] = []
    const rig = rigOf({
      deps: {
        ensure: async (threadId) => {
          calls.push(`ensure:${threadId}`)
          await gate.promise
        },
        remove: (threadId) => {
          calls.push(`remove:${threadId}`)
          return Promise.resolve()
        },
      },
    })
    const opening = rig.host.dispatch(create)
    await tick()
    expect(rig.probes).toHaveLength(0)
    gate.resolve(undefined)
    await opening
    const id = rig.events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "b" })
    await rig.host.dispatch({ type: "thread.delete", threadId: id })
    expect(calls).toEqual([`ensure:${id}`, `remove:${id}`])
  })

  it("新轮次先完成工作树快照，再把提示词交给引擎", async () => {
    const gate = deferred<undefined>()
    const rig = rigOf({ deps: { capture: () => gate.promise } })
    const id = await created(rig)
    const sending = rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "检查这一轮" })
    await tick()
    expect(rig.probes[0]?.prompts).toEqual([])
    gate.resolve(undefined)
    await sending
    expect(rig.probes[0]?.prompts.map((prompt) => prompt.text)).toEqual(["检查这一轮"])
  })

  it("新建启动失败也会回收已经生成的基线", async () => {
    const calls: string[] = []
    const rig = rigOf({
      failStart: new Set(["a"]),
      deps: {
        ensure: (threadId) => {
          calls.push(`ensure:${threadId}`)
          return Promise.resolve()
        },
        remove: (threadId) => {
          calls.push(`remove:${threadId}`)
          return Promise.resolve()
        },
      },
    })
    await expect(rig.host.dispatch(create)).rejects.toThrow("a start failed")
    const id = rig.events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    expect(calls).toEqual([`ensure:${id}`, `remove:${id}`])
  })

  it("session 已启动但能力握手抛错时也会销毁进程", async () => {
    const rig = rigOf({ failCapabilities: new Set(["a"]) })
    await expect(rig.host.dispatch(create)).rejects.toThrow("capabilities failed")
    expect(rig.probes[0]?.disposed).toBe(true)
    expect(rig.host.live()).toEqual([])
  })
})
