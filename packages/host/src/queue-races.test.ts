import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES, type Event } from "@switchback/protocol"
import type { EngineDriver, EngineSession, StartRequest } from "@switchback/engine"
import { createHost, type Host } from "./host.js"

interface Gate { promise: Promise<void>; open: () => void; fail: (error: Error) => void }

function gate(): Gate {
  const slot: { open?: () => void; fail?: (error: Error) => void } = {}
  const promise = new Promise<void>((resolve, reject) => {
    slot.open = resolve
    slot.fail = reject
  })
  return { promise, open: () => slot.open?.(), fail: (error) => slot.fail?.(error) }
}

interface Rig {
  host: Host
  events: Event[]
  prompts: { text: string; turnId: string }[]
  steers: string[]
  req: () => StartRequest
  /** 插话 RPC 由测试放行；不给就立刻成功。 */
  steerGates: Gate[]
  /** 每次开轮前的工作树快照由测试放行；不给就立刻完成。 */
  baselines: Gate[]
}

function rig(options: { holdSteer?: boolean; holdBaseline?: boolean } = {}): Rig {
  const events: Event[] = []
  const prompts: Rig["prompts"] = []
  const steers: string[] = []
  const steerGates: Gate[] = []
  const baselines: Gate[] = []
  const slot: { req?: StartRequest } = {}
  const driver: EngineDriver = {
    id: "fake",
    start: (req) => {
      slot.req = req
      req.onHandle?.("h-1")
      const session: EngineSession = {
        threadId: req.threadId,
        prompt: (text, turnId) => {
          prompts.push({ text, turnId })
          return Promise.resolve()
        },
        steer: (text) => {
          steers.push(text)
          if (options.holdSteer !== true) return Promise.resolve()
          const held = gate()
          steerGates.push(held)
          return held.promise
        },
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([]),
        capabilities: () => ({ ...NO_CAPABILITIES, steer: true, attachments: true }),
        setModel: () => Promise.resolve({}),
        dispose: () => Promise.resolve(),
      }
      return Promise.resolve(session)
    },
  }
  const counter = { n: 0 }
  const host = createHost({
    drivers: { fake: driver },
    home: "/h",
    emit: (event) => events.push(event),
    newId: (prefix) => {
      counter.n += 1
      return `${prefix}-${String(counter.n)}`
    },
    now: () => counter.n,
    captureTurnBaseline: () => {
      if (options.holdBaseline !== true) return Promise.resolve()
      const held = gate()
      baselines.push(held)
      return held.promise
    },
  })
  return { host, events, prompts, steers, steerGates, baselines, req: () => slot.req as StartRequest }
}

const tick = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function created(r: Rig): Promise<string> {
  await r.host.dispatch({ type: "thread.create", cwd: "/w", engine: "fake", trust: "auto-edit" })
  return r.events.find((event) => event.type === "thread.started")?.thread.id ?? ""
}

function complete(r: Rig, status: "completed" | "failed" | "interrupted" = "completed"): void {
  r.req().emit({ type: "turn.completed", at: 9, turnId: r.prompts.at(-1)?.turnId ?? "", status })
}

const said = (r: Rig): string[] => r.prompts.map((prompt) => prompt.text)

describe("停止的边界", () => {
  it("按停止之后、引擎收手之前补的那句不陪着作废：中断收工后接着发", async () => {
    const r = rig()
    const id = await created(r)
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "跑偏了的那轮" })
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "停之前排的" })
    await r.host.dispatch({ type: "thread.interrupt", threadId: id })
    expect(r.host.live()[0]?.queued).toEqual([])
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "改成用另一个文件" })
    complete(r, "interrupted")
    await tick()
    expect(said(r)).toEqual(["跑偏了的那轮", "改成用另一个文件"])
  })

  it("没有轮次在跑时按停止，上一轮失败留下的「待发送」不被删", async () => {
    const r = rig()
    const id = await created(r)
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "会失败的那轮" })
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "失败后要留着的", attachments: ["/tmp/keep.png"] })
    complete(r, "failed")
    await r.host.dispatch({ type: "thread.interrupt", threadId: id })
    expect(r.host.live()[0]).toMatchObject({ queued: ["失败后要留着的"], queuedAttachments: [["/tmp/keep.png"]] })
  })

  it("续发那句卡在工作树快照时按了停止：它随队列一起作废，不再开轮", async () => {
    const r = rig({ holdBaseline: true })
    const id = await created(r)
    const first = r.host.dispatch({ type: "thread.prompt", threadId: id, text: "先跑着" })
    await tick()
    r.baselines[0]?.open()
    await first
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "排队甲" })
    complete(r)
    await tick()
    await r.host.dispatch({ type: "thread.interrupt", threadId: id })
    r.baselines[1]?.open()
    await tick()
    expect(said(r)).toEqual(["先跑着"])
    expect(r.host.live()[0]).toMatchObject({ status: "idle", queued: [] })
  })
})

describe("队列不停摆", () => {
  it("⌘⏎ 插话撞上收工：退回排队后当场接着发，不挂在「待发送」里", async () => {
    const r = rig({ holdSteer: true })
    const id = await created(r)
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "先跑着" })
    const steering = r.host.dispatch({ type: "thread.prompt", threadId: id, text: "插一句", steer: true })
    await tick()
    complete(r)
    r.steerGates[0]?.fail(new Error("expected turn mismatch"))
    await steering
    await tick()
    expect(said(r)).toEqual(["先跑着", "插一句"])
    expect(r.host.live()[0]?.queued).toEqual([])
  })
})

describe("立刻插入", () => {
  it("连点两下只插一遍", async () => {
    const r = rig({ holdSteer: true })
    const id = await created(r)
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "先跑着" })
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "排队甲" })
    const a = r.host.dispatch({ type: "thread.steerQueued", threadId: id })
    const b = r.host.dispatch({ type: "thread.steerQueued", threadId: id })
    await tick()
    r.steerGates[0]?.open()
    await Promise.all([a, b])
    expect(r.steers).toEqual(["排队甲"])
  })

  it("插话在途时新排的那句不跟着消失", async () => {
    const r = rig({ holdSteer: true })
    const id = await created(r)
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "先跑着" })
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "排队甲" })
    const steering = r.host.dispatch({ type: "thread.steerQueued", threadId: id })
    await tick()
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "刚排进来的乙" })
    r.steerGates[0]?.open()
    await steering
    expect(r.steers).toEqual(["排队甲"])
    expect(r.host.live()[0]?.queued).toEqual(["刚排进来的乙"])
  })
})
