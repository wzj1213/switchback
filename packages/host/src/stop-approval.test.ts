import { describe, expect, it } from "vitest"
import { ask, create, items, setup } from "./host-fixture.js"

describe("审批卡挂着时按停止", () => {
  it("当场收掉、记成「已失效」：引擎在等这张卡的回音，不回它就收不了这一轮", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "推一下" })
    const answer = session().ask(ask)
    await host.dispatch({ type: "thread.interrupt", threadId: id })
    await expect(answer).resolves.toEqual({ allow: false, remember: "once" })
    const card = items(events).filter((item) => item.kind === "approval").at(-1)
    expect(card?.kind === "approval" ? card.status : "").toBe("cancelled")
  })
})

describe("轮次之外来的审批", () => {
  it("没有轮次可挂卡：按拒绝回，但标明这不是用户的决定", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((event) => event.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "起一个后台 workflow" })
    session().emit({ type: "turn.completed", at: 1, turnId: session().prompts[0]?.turnId ?? "", status: "completed" })
    await expect(session().ask(ask)).resolves.toEqual({ allow: false, remember: "once", unattended: true })
    expect(items(events).filter((item) => item.kind === "approval")).toEqual([])
  })
})
