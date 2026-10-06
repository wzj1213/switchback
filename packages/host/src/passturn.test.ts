import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES } from "@switchback/protocol"
import type { Event, Item } from "@switchback/protocol"
import type { ApprovalAnswer, ApprovalAsk, EngineDriver, EngineSession } from "@switchback/engine"
import { createHost, type Host } from "./host.js"

/**
 * 「本轮剩下的都放行」。
 *
 * 这个按钮**省掉的是打断，不是判定**，所以三条边界一条都不能松：
 * 红线照问、下一轮失效、拒绝时不 arm。三条错了都不会报错——
 * 只会在某一天变成「我以为只放行了那一轮」。
 */

interface Fake {
  ask: (a: ApprovalAsk) => Promise<ApprovalAnswer>
  /** 冒充引擎发事件（用来把一轮真的跑完）。 */
  emit: (e: Event) => void
  /** 宿主铸的轮次 id。 */
  turns: string[]
}

function setup(): { host: Host; events: Event[]; session: () => Fake } {
  const holder: { fake: Fake | undefined } = { fake: undefined }
  const driver: EngineDriver = {
    id: "fake",
    start: (req) => {
      const fake: Fake = { ask: req.askUser, emit: req.emit, turns: [] }
      holder.fake = fake
      const session: EngineSession = {
        threadId: req.threadId,
        prompt: (_text, turnId) => {
          fake.turns.push(turnId)
          return Promise.resolve()
        },
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([]),
        capabilities: () => NO_CAPABILITIES,
        setModel: () => Promise.resolve({}),
        dispose: () => Promise.resolve(),
      }
      return Promise.resolve(session)
    },
  }
  const events: Event[] = []
  const counter = { n: 0 }
  const host = createHost({
    drivers: { fake: driver },
    home: "/home/dev",
    emit: (e) => events.push(e),
    newId: (prefix) => {
      counter.n += 1
      return `${prefix}-${String(counter.n)}`
    },
    now: () => 0,
  })
  return {
    host,
    events,
    session: () => {
      if (holder.fake === undefined) throw new Error("会话还没建")
      return holder.fake
    },
  }
}

const create = { type: "thread.create", cwd: "/w", engine: "fake", trust: "auto-edit" } as const
const items = (events: Event[]): Item[] =>
  events.filter((e) => e.type === "item.started" || e.type === "item.updated").map((e) => e.item)
const cards = (events: Event[]): Item[] => items(events).filter((i) => i.kind === "approval")

const plain: ApprovalAsk = { toolCallId: "t1", tool: "Bash", summary: "npm run build", reason: "要跑命令" }
const redline: ApprovalAsk = { ...plain, toolCallId: "t2", summary: "cat ~/.aws/credentials", reason: "读凭据", redline: "credentials" }

async function armed(): Promise<{ host: Host; events: Event[]; session: () => Fake; threadId: string }> {
  const rig = setup()
  await rig.host.dispatch(create)
  const started = rig.events[0]
  const threadId = started?.type === "thread.started" ? started.thread.id : ""
  await rig.host.dispatch({ type: "thread.prompt", threadId, text: "开工" })
  void rig.session().ask(plain)
  await Promise.resolve()
  const first = cards(rig.events)[0]
  await rig.host.dispatch({
    type: "approval.resolve",
    itemId: first?.id ?? "",
    allow: true,
    remember: "once",
    passTurn: true,
  })
  return { ...rig, threadId }
}

describe("本轮剩下的都放行", () => {
  it("armed 之后普通请求直接放行，**连卡都不发**", async () => {
    const rig = await armed()
    const before = cards(rig.events).length
    const answer = await rig.session().ask({ ...plain, toolCallId: "t9" })
    expect(answer.allow).toBe(true)
    expect(cards(rig.events)).toHaveLength(before)
  })

  it("放行是 `once`：它省的是打断，不该顺手记下一条规则", async () => {
    const rig = await armed()
    expect((await rig.session().ask({ ...plain, toolCallId: "t9" })).remember).toBe("once")
  })

  it("**红线照旧发卡**——那 8 条正是最不该被一次点击盖掉的", async () => {
    const rig = await armed()
    const before = cards(rig.events).length
    void rig.session().ask(redline)
    await Promise.resolve()
    expect(cards(rig.events).length).toBeGreaterThan(before)
  })

  it("**下一轮失效**：记的是轮次 id，不是布尔", async () => {
    const rig = await armed()
    // 先把这一轮真的跑完——不跑完的话第二句只会进队列，根本没有「下一轮」
    rig.session().emit({ type: "turn.completed", at: 0, turnId: rig.session().turns[0] ?? "", status: "completed" })
    await rig.host.dispatch({ type: "thread.prompt", threadId: rig.threadId, text: "第二轮" })
    const before = cards(rig.events).length
    void rig.session().ask({ ...plain, toolCallId: "t9" })
    await Promise.resolve()
    expect(cards(rig.events).length).toBeGreaterThan(before)
  })

  it("拒绝时不 arm：「拒绝并且本轮都放行」不是一个说得通的意图", async () => {
    const rig = setup()
    await rig.host.dispatch(create)
    const started = rig.events[0]
    const threadId = started?.type === "thread.started" ? started.thread.id : ""
    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "开工" })
    void rig.session().ask(plain)
    await Promise.resolve()
    const first = cards(rig.events)[0]
    await rig.host.dispatch({
      type: "approval.resolve",
      itemId: first?.id ?? "",
      allow: false,
      remember: "once",
      passTurn: true,
    })
    const before = cards(rig.events).length
    void rig.session().ask({ ...plain, toolCallId: "t9" })
    await Promise.resolve()
    expect(cards(rig.events).length).toBeGreaterThan(before)
  })

  it("不点它的时候一切照旧：还是逐条发卡", async () => {
    const rig = setup()
    await rig.host.dispatch(create)
    const started = rig.events[0]
    const threadId = started?.type === "thread.started" ? started.thread.id : ""
    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "开工" })
    void rig.session().ask(plain)
    await Promise.resolve()
    const first = cards(rig.events)[0]
    await rig.host.dispatch({ type: "approval.resolve", itemId: first?.id ?? "", allow: true, remember: "once" })
    const before = cards(rig.events).length
    void rig.session().ask({ ...plain, toolCallId: "t9" })
    await Promise.resolve()
    expect(cards(rig.events).length).toBeGreaterThan(before)
  })
})
