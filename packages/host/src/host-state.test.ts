import { describe, expect, it } from "vitest"
import { type Event, type EngineAxis } from "@omni/protocol"
import { type Host } from "./host.js"
import { setup, create, type Fake } from "./host-fixture.js"

/**
 * 引擎自报的状态**合并进 `Thread.engineState`，绝不碰 `Thread.trust`**。
 *
 * 「绝不碰 trust」那条不是洁癖：`trust` 同时是 omni 本机审批判定器的输入，
 * 引擎报 yolo 就把它写成 full，等于顺手把 omni 自己那层审批也关掉——
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

/**
 * 侧问：问答落进 `Thread.asides`，**不进 transcript**——那是这件事的全部定义。
 * 进了 transcript 它就在正文里，而正文正是模型下一轮要读的东西。
 */
describe("侧问", () => {
  const start = async (): Promise<{ host: Host; events: Event[]; id: string }> => {
    const { host, events } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    return { host, events, id }
  }
  const last = (events: Event[]) => events.filter((e) => e.type === "thread.updated").at(-1)?.thread

  it("问答落进 Thread.asides，按先后排", async () => {
    const { host, events, id } = await start()
    await host.dispatch({ type: "thread.sideQuestion", threadId: id, text: "这个函数干嘛的" })
    await host.dispatch({ type: "thread.sideQuestion", threadId: id, text: "那这个呢" })
    expect(last(events)?.asides?.map((a) => a.question)).toEqual(["这个函数干嘛的", "那这个呢"])
    expect(last(events)?.asides?.[0]?.answer).toBe("答：这个函数干嘛的")
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
    expect(last(events)?.asides).toBeUndefined()
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
