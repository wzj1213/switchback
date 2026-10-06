import { describe, expect, it } from "vitest"
import { type EngineGoal, type Event, type EngineAxis } from "@switchback/protocol"
import { type Host } from "./host.js"
import { setup, create, type Fake } from "./host-fixture.js"

/**
 * 引擎自报的状态**合并进 `Thread.engineState`，绝不碰 `Thread.trust`**。
 *
 * 「绝不碰 trust」那条不是洁癖：`trust` 同时是 Switchback 本机审批判定器的输入，
 * 引擎报 yolo 就把它写成 full，等于顺手把 Switchback 自己那层审批也关掉——
 * 一次用户从没点过的放权，而且没有任何地方会报错。
 */
describe("引擎自报的状态", () => {
  const start = async (): Promise<{ events: Event[]; session: () => Fake; id: string }> => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    return { events, session, id }
  }
  const last = (events: Event[]) => events.filter((e) => e.type === "thread.updated").at(-1)?.thread

  const axis = (a: string, id: string): EngineAxis => ({ axis: a, id, match: "diverged" })

  it("落进 Thread，走 thread.updated——**那样它才跟着事件流落盘，⌘R 之后还在**", async () => {
    const { events, session } = await start()
    session().report({ axes: [axis("mode", "plan")] })
    expect(last(events)?.engineState?.axes).toEqual([axis("mode", "plan")])
  })

  it("**多条轴各自更新各自的**——codex 的 approval 与 sandbox 是两个独立旋钮，不该互相清空", async () => {
    const { events, session } = await start()
    session().report({ axes: [axis("approval", "on-request")] })
    session().report({ axes: [axis("sandbox", "workspace-write")] })
    expect(
      last(events)
        ?.engineState?.axes.map((a) => a.axis)
        .sort(),
    ).toEqual(["approval", "sandbox"])
  })

  it("同一条轴后到的赢", async () => {
    const { events, session } = await start()
    session().report({ axes: [axis("mode", "plan")] })
    session().report({ axes: [axis("mode", "default")] })
    expect(last(events)?.engineState?.axes).toEqual([axis("mode", "default")])
  })

  it("**这次没报的那一样沿用上一次**——引擎往往一次只报一件事", async () => {
    const { events, session } = await start()
    session().report({ modelId: "grok-4.6" })
    session().report({ axes: [axis("mode", "plan")] })
    expect(last(events)?.engineState?.modelId).toBe("grok-4.6")
  })

  it("**绝不碰 trust**——那是审批判定器的输入，写进去就是一次静默提权", async () => {
    const { events, session } = await start()
    session().report({ axes: [{ axis: "mode", id: "yolo", match: "diverged" }] })
    expect(last(events)?.trust).toBe("auto-edit")
  })
})

describe("引擎原生目标", () => {
  const goal: EngineGoal = {
    objective: "逐项完成项目审计",
    status: "active",
    tokenBudget: 50_000,
    tokensUsed: 1_200,
    timeUsedSeconds: 9,
  }

  it("完整快照落进 Thread，清空也落盘且重复清空不制造事件", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    session().goal(goal)
    expect(host.live()[0]?.goal).toEqual(goal)
    const before = events.filter((event) => event.type === "thread.updated").length
    session().goal(undefined)
    expect(host.live()[0]?.goal).toBeUndefined()
    session().goal(undefined)
    expect(events.filter((event) => event.type === "thread.updated")).toHaveLength(before + 1)
  })
})

/** 侧问：走 `kind:aside` 的旁路，**不进 transcript**，且等待与失败都看得见。 */
describe("侧问", () => {
  const start = async (): Promise<{ host: Host; events: Event[]; id: string }> => {
    const { host, events } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    return { host, events, id }
  }
  const lanes = (events: Event[]) => events.filter((e) => e.type === "lane.updated").map((e) => e.lane)

  it("每一问先落运行卡，随后以同一 id 原位落成原生答案", async () => {
    const { host, events, id } = await start()
    await host.dispatch({ type: "thread.sideQuestion", threadId: id, text: "这个函数干嘛的" })
    await host.dispatch({ type: "thread.sideQuestion", threadId: id, text: "那这个呢" })
    expect(lanes(events).map((lane) => [lane.title, lane.status])).toEqual([
      ["这个函数干嘛的", "running"], ["这个函数干嘛的", "done"],
      ["那这个呢", "running"], ["那这个呢", "done"],
    ])
    expect(lanes(events)[1]?.summary).toBe("答：这个函数干嘛的")
    expect(lanes(events)[0]?.id).toBe(lanes(events)[1]?.id)
  })

  it("引擎回答前就看得见问题与等待态", async () => {
    let answer!: (text: string) => void
    let entered!: () => void
    const called = new Promise<void>((resolve) => { entered = resolve })
    const waiting = new Promise<string>((resolve) => { answer = resolve })
    const { host, events } = setup({ asideAnswer: () => { entered(); return waiting } })
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    const dispatch = host.dispatch({ type: "thread.sideQuestion", threadId: id, text: "还要多久？" })
    await called
    expect(lanes(events).at(-1)).toMatchObject({ title: "还要多久？", status: "running" })
    answer("马上")
    await dispatch
    expect(lanes(events).at(-1)).toMatchObject({ status: "done", summary: "马上" })
  })

  it("失败原位落下原始错误，不把一次侧问冒充整条引擎崩溃", async () => {
    const { host, events } = setup({ asideAnswer: () => Promise.reject(new Error("侧问接口超时")) })
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await expect(host.dispatch({ type: "thread.sideQuestion", threadId: id, text: "问一句" })).resolves.toBeUndefined()
    expect(lanes(events).at(-1)).toMatchObject({ status: "failed", summary: "侧问接口超时" })
    expect(events.some((event) => event.type === "engine.status" && event.status === "crashed")).toBe(false)
  })

  it("**一条 item 都不产生**——进了 transcript 就不叫侧问了", async () => {
    const { host, events, id } = await start()
    const before = events.filter((e) => e.type === "item.started").length
    await host.dispatch({ type: "thread.sideQuestion", threadId: id, text: "问一句" })
    expect(events.filter((e) => e.type === "item.started").length).toBe(before)
  })

  it("空问题直接不发——省一次真实调用", async () => {
    const { host, events, id } = await start()
    await host.dispatch({ type: "thread.sideQuestion", threadId: id, text: "   " })
    expect(lanes(events)).toHaveLength(0)
  })

  it("**引擎不支持就抛，不静默吞**——界面本来就不该给这个入口，走到这里说明别处有 bug", async () => {
    const { host, events } = setup({ aside: false })
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await expect(
      host.dispatch({ type: "thread.sideQuestion", threadId: id, text: "问" }),
    ).rejects.toThrow(/不支持侧问/)
  })
})
