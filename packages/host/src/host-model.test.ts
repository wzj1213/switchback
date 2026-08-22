import { describe, expect, it } from "vitest"
import { type Event } from "@omni/protocol"
import { type Host } from "./host.js"
import { setup, create, type Fake } from "./host-fixture.js"

function deferred(): { promise: Promise<void>; resolve: () => void } {
  const slot: { resolve?: () => void } = {}
  return {
    promise: new Promise((resolve) => {
      slot.resolve = resolve
    }),
    resolve: () => slot.resolve?.(),
  }
}

describe("换模型时的推理强度", () => {
  const pick = async (): Promise<{ host: Host; events: Event[]; id: string }> => {
    const { host, events } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.setModel", threadId: id, model: "a", effort: "high" })
    return { host, events, id }
  }
  const effortOf = (events: Event[]): string | undefined =>
    events.filter((e) => e.type === "thread.updated").at(-1)?.thread.effort

  it("新建时也记录引擎真正采用的强度", async () => {
    const { host, events } = setup({ effort: () => ({ effort: "max" }) })
    await host.dispatch({ ...create, model: "a", effort: "low" })
    expect(events.filter((e) => e.type === "thread.updated").at(-1)?.thread).toMatchObject({
      model: "a",
      effort: "max",
    })
  })

  it("新建时模型设置失败就回到默认，不显示一个没设上的选择", async () => {
    const { host, events } = setup({ effort: () => Promise.reject(new Error("不支持")) })
    await host.dispatch({ ...create, model: "bad", effort: "high" })
    const thread = events.filter((e) => e.type === "thread.updated").at(-1)?.thread
    expect(thread?.model).toBeUndefined()
    expect(thread?.effort).toBeUndefined()
  })

  it("选了就记下", async () => {
    const { events } = await pick()
    expect(effortOf(events)).toBe("high")
  })

  it("**引擎拒了那一档时，记下的是引擎还在用的那个**——不是你点的那个", async () => {
    // 实测 ZCode：桥把 `thought` 报成可选，设进去必然 Internal error。
    // 那一步失败不算换模型失败（模型确实换了），但记录里要是请求值的话，
    // 输入区会显示「轻度」而引擎在 max——**界面在说一件没发生的事**
    const { host, events } = setup({ effort: () => ({ effort: "max" }) })
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.setModel", threadId: id, model: "a", effort: "low" })
    expect(effortOf(events)).toBe("max")
  })

  it("**换到不报强度的模型时要清掉**——留着的话界面会画一个引擎根本没在用的档位", async () => {
    const { host, events, id } = await pick()
    await host.dispatch({ type: "thread.setModel", threadId: id, model: "b" })
    expect(effortOf(events)).toBeUndefined()
  })

  it("快速连选时按点击顺序设置，慢回包不能反盖最后一次选择", async () => {
    const slow = deferred()
    const calls: string[] = []
    const { host, events } = setup({
      effort: async (effort) => {
        calls.push(effort ?? "")
        if (effort === "slow") await slow.promise
        return effort === undefined ? {} : { effort }
      },
    })
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    const first = host.dispatch({ type: "thread.setModel", threadId: id, model: "a", effort: "slow" })
    const second = host.dispatch({ type: "thread.setModel", threadId: id, model: "b", effort: "fast" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual(["slow"])
    slow.resolve()
    await Promise.all([first, second])
    expect(calls).toEqual(["slow", "fast"])
    expect(events.filter((e) => e.type === "thread.updated").at(-1)?.thread).toMatchObject({
      model: "b",
      effort: "fast",
    })
  })
})

/**
 * 换模型有两个发起方：用户点下拉，和 **agent 自己换**。
 * 后者以前只走到 `models.updated`——那条换的是**清单**，不是**选中项**，
 * 于是清单更新了而 `Thread.model` 还是旧值，输入区照着它画一个引擎已经不在跑的模型。
 */
describe("agent 自己换了模型", () => {
  const start = async (): Promise<{ events: Event[]; session: () => Fake; id: string }> => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.setModel", threadId: id, model: "a", effort: "high" })
    return { events, session, id }
  }
  const last = (events: Event[]) => events.filter((e) => e.type === "thread.updated").at(-1)?.thread

  it("引擎报上来的新模型要落到会话记录上", async () => {
    const { events, session } = await start()
    session().drift("b", "low")
    expect(last(events)?.model).toBe("b")
    expect(last(events)?.effort).toBe("low")
  })

  it("**没报的那一项不动原值**——「引擎没报」不等于「引擎报了个空」", async () => {
    const { events, session } = await start()
    session().drift("b", undefined)
    expect(last(events)?.model).toBe("b")
    // 用户选过的 high 不该被这条只带模型的通知悄悄清掉
    expect(last(events)?.effort).toBe("high")
  })

  it("跟原值一样就不发事件——一条什么都没变的 `thread.updated` 只会让界面白重画", async () => {
    const { events, session } = await start()
    const before = events.filter((e) => e.type === "thread.updated").length
    session().drift("a", "high")
    expect(events.filter((e) => e.type === "thread.updated").length).toBe(before)
  })
})
