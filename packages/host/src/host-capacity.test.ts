import { describe, expect, it } from "vitest"
import {
  NO_CAPABILITIES,
  type Event,
  type QuestionPrompt,
  type QuestionResponse,
} from "@omni/protocol"
import type { EngineSession } from "@omni/engine"
import { createHost, type Host } from "./host.js"
import { setup, create, setupTwoEngines } from "./host-fixture.js"

const QUESTIONS: readonly QuestionPrompt[] = [
  { id: "one", question: "选哪一个？", options: [{ id: "a", label: "A" }] },
]

describe("活会话上限：闲着的先收掉", () => {
  /**
   * 一个 codex 会话实测 260 MB / 4 个进程，不设上限开五条就是 1.3 GB，
   * 而且全闲着。这里钉的是「收谁」和「绝不收谁」——后者更要紧。
   */
  const rig = (
    maxLive: number,
  ): {
    host: Host
    events: Event[]
    disposed: string[]
    emit: (id: string, e: Event) => void
    question: (id: string) => Promise<QuestionResponse>
  } => {
    const events: Event[] = []
    const disposed: string[] = []
    const emitters = new Map<string, (e: Event) => void>()
    const questioners = new Map<
      string,
      (questions: readonly QuestionPrompt[]) => Promise<QuestionResponse>
    >()
    const counter = { n: 0 }
    const host = createHost({
      drivers: {
        fake: {
          id: "fake",
          start: (req) => {
            // 报个句柄，不然按规则它不该被收（收了回不来）
            req.onHandle?.(`cx-${req.threadId}`)
            emitters.set(req.threadId, req.emit)
            questioners.set(req.threadId, req.askQuestion)
            return Promise.resolve({
              threadId: req.threadId,
              prompt: () => Promise.resolve(),
              interrupt: () => Promise.resolve(),
              setTrust: () => Promise.resolve({ restart: false }),
              models: () => Promise.resolve([]),
              capabilities: () => NO_CAPABILITIES,
              setModel: () => Promise.resolve({}),
              dispose: () => {
                disposed.push(req.threadId)
                return Promise.resolve()
              },
            } as unknown as EngineSession)
          },
        },
      },
      home: "/home/dev",
      maxLive,
      emit: (e) => events.push(e),
      newId: (prefix) => {
        counter.n += 1
        return `${prefix}-${String(counter.n)}`
      },
      now: () => counter.n,
    })
    return {
      host,
      events,
      disposed,
      emit: (id, e) => emitters.get(id)?.(e),
      question: (id) => questioners.get(id)?.(QUESTIONS) ?? Promise.resolve({ dismissed: true }),
    }
  }

  /**
   * 开一条会话，**发一句话让它转正，再让那一轮收工**。
   *
   * 三步缺一不可：一句话都没说的是临时会话，建下一条时本来就会被收掉
   *（见 `session.ts` 的 `dropTemps`），根本轮不到上限这条规则；
   * 而不收工的话它永远「正在跑」，那是另一条规则（正在跑的绝不收）。
   */
  const open = async (r: ReturnType<typeof rig>): Promise<string> => {
    await r.host.dispatch(create)
    const id = r.events.filter((e) => e.type === "thread.started").at(-1)?.thread.id ?? ""
    await r.host.dispatch({ type: "thread.prompt", threadId: id, text: "hi" })
    const turnId = r.events.filter((e) => e.type === "turn.started").at(-1)?.turn.id ?? ""
    r.emit(id, { type: "turn.completed", at: 0, turnId, status: "completed" })
    return id
  }

  it("没到上限不收任何东西", async () => {
    const r = rig(3)
    await open(r)
    await open(r)
    expect(r.disposed).toEqual([])
  })

  it("**超了就收最久没动的那个**", async () => {
    const r = rig(2)
    const first = await open(r)
    await open(r)
    await open(r)
    expect(r.disposed).toEqual([first])
  })

  it("收掉的标成 detached——界面上就是「点继续接回引擎」，那条路本来就有", async () => {
    const r = rig(2)
    const first = await open(r)
    await open(r)
    await open(r)
    const last = r.events
      .filter((e) => e.type === "thread.updated")
      .filter((e) => e.thread.id === first)
      .at(-1)
    expect(last?.thread.detached).toBe(true)
  })

  it("**记录不删**：收起来不是删掉，日志和句柄都还在", async () => {
    const r = rig(2)
    const first = await open(r)
    await open(r)
    await open(r)
    expect(r.events.some((e) => e.type === "thread.removed" && e.threadId === first)).toBe(false)
    const last = r.events
      .filter((e) => e.type === "thread.updated")
      .filter((e) => e.thread.id === first)
      .at(-1)
    expect(last?.thread.engineHandle).toBeDefined()
  })

  it("**正在跑的绝不收**——收掉等于中断用户的活", async () => {
    const r = rig(2)
    const first = await open(r)
    await r.host.dispatch({ type: "thread.prompt", threadId: first, text: "跑着呢" })
    await open(r)
    await open(r)
    expect(r.disposed).not.toContain(first)
  })

  it("上限内没有可收的就不收，宁可超一点也不动正在跑的", async () => {
    const r = rig(1)
    const first = await open(r)
    await r.host.dispatch({ type: "thread.prompt", threadId: first, text: "跑着呢" })
    await open(r)
    expect(r.disposed).toEqual([])
  })

  it("状态虽空闲但还挂着原生问题的绝不收——问题卡必须等得到用户回答", async () => {
    const r = rig(2)
    const first = await open(r)
    void r.question(first)
    await open(r)
    await open(r)
    expect(r.disposed).not.toContain(first)
  })
})

/**
 * 临时会话：**发出第一句话才算数**。
 *
 * 点一下「+」（以及 omni 启动时自动开的那条）先给的是一个临时窗口——
 * 引擎照起（模型清单、斜杠命令都要它才有），但它不进侧栏、不落盘。
 * 「不进侧栏」是渲染层的事，这里钉的是它下面那条契约：`Thread.provisional`
 * 什么时候立、什么时候清、以及没人要的那条怎么收场。
 */
describe("临时会话：发出第一句话才算数", () => {
  const idOf = (events: Event[], at = 0): string => {
    const started = events.filter((e) => e.type === "thread.started")[at]
    return started?.type === "thread.started" ? started.thread.id : ""
  }

  it("新建出来就是临时的", async () => {
    const { host, events } = setup()
    await host.dispatch(create)
    const started = events.find((e) => e.type === "thread.started")
    expect(started?.type === "thread.started" ? started.thread.provisional : undefined).toBe(true)
  })

  it("**发出第一句话就转正**，而且转正那条排在 turn.started 前面（落盘顺序靠它）", async () => {
    const { host, events } = setup()
    await host.dispatch(create)
    await host.dispatch({ type: "thread.prompt", threadId: idOf(events), text: "开工" })
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    expect(last?.type === "thread.updated" ? last.thread.provisional : "还在").toBeUndefined()
    const types = events.map((e) => e.type)
    const turned = events.findIndex(
      (e) => e.type === "thread.updated" && e.thread.provisional === undefined,
    )
    expect(turned).toBeLessThan(types.indexOf("turn.started"))
  })

  /**
   * **再点一次「+」，上一条临时会话就收掉。**
   *
   * 它不在侧栏里，所以一旦你又点了一次「+」或者切去别的会话，它就再也点不回来了
   * ——而背后那个引擎进程还活着（实测一条 codex 会话 260 MB）。
   * 看不见又回不去的东西不该继续占着进程。
   */
  it("**建下一条临时会话时，上一条被收掉**", async () => {
    const { host, events, sessions } = setupTwoEngines()
    await host.dispatch(create)
    const first = idOf(events)
    await host.dispatch(create)
    expect(sessions[0]?.disposed).toBe(true)
    expect(events.some((e) => e.type === "thread.removed" && e.threadId === first)).toBe(true)
    expect(sessions[1]?.disposed).toBe(false)
  })

  it("**开过工的会话不收**——它已经是一条真会话了", async () => {
    const { host, events, sessions } = setupTwoEngines()
    await host.dispatch(create)
    const first = idOf(events)
    await host.dispatch({ type: "thread.prompt", threadId: first, text: "开工" })
    await host.dispatch(create)
    expect(sessions[0]?.disposed).toBe(false)
    expect(events.some((e) => e.type === "thread.removed" && e.threadId === first)).toBe(false)
  })
})
