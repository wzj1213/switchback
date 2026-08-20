import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES, type Event } from "@omni/protocol"
import type { EngineDriver, EngineSession } from "@omni/engine"
import { createHost, type Host } from "./host.js"
import { create, fakeDriver, setupTwoEngines } from "./host-fixture.js"

describe("跨引擎接力", () => {
  const setupTwo = setupTwoEngines

  /**
   * 切引擎 + 发出下一句。两件事在新设计里是分开的：
   *
   * - 点下拉只记一笔 `nextEngine`（见 `Thread.nextEngine`），什么都不动；
   * - **真正的切换发生在下一句话发出去的那一刻**。
   *
   * 中间那条 `turn.completed` 不是凑数：**上一轮还没跑完时不切引擎**——
   * 那时新说的话会排队，切换要等队列被 drain 才发生。
   */
  const handoffTo = async (
    rig: ReturnType<typeof setupTwoEngines>,
    to: string,
  ): Promise<string> => {
    const threadId = await worked(rig)
    await rig.host.dispatch({ type: "thread.handoff", threadId, to })
    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "接着弄" })
    return threadId
  }

  /**
   * 让这条会话**开过工**：发一句话（它就此从临时会话转正）再让那一轮收工。
   *
   * 「下一句生效」那套规则只对开过工的会话成立——还没说过话的临时会话
   * 切引擎是当场切的（见 `Thread.provisional`），所以每条测它的用例
   * 都得先走这一步，否则测的是另一条路。
   */
  /** 起一个只挂这些驱动的宿主。下面几条用例各要一种特殊驱动（起不来的、报模型的、报能力的）。 */
  const hostWith = (drivers: Record<string, EngineDriver>): { host: Host; events: Event[] } => {
    const events: Event[] = []
    const counter = { n: 0 }
    const host = createHost({
      drivers,
      home: "/h",
      emit: (e) => events.push(e),
      newId: (p) => {
        counter.n += 1
        return `${p}-${String(counter.n)}`
      },
      now: () => 0,
    })
    return { host, events }
  }

  /** 一个只报「我叫什么、我能干什么、我有哪些模型」的驱动。 */
  const stub = (id: string, caps: Partial<{ attachments: boolean }> = {}): EngineDriver => ({
    id,
    start: (req) =>
      Promise.resolve({
        threadId: req.threadId,
        prompt: () => Promise.resolve(),
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([{ id: `${id}-model`, label: id }]),
        capabilities: () => ({ ...NO_CAPABILITIES, ...caps }),
        setModel: () => Promise.resolve({}),
        dispose: () => Promise.resolve(),
      } as unknown as EngineSession),
  })

  const worked = async (rig: ReturnType<typeof setupTwoEngines>): Promise<string> => {
    const { host, events, sessions } = rig
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "把 X 改成 Y" })
    const first = sessions[0]
    first?.emit({
      type: "turn.completed",
      at: 0,
      turnId: first.prompts[0]?.turnId ?? "",
      status: "completed",
    })
    return threadId
  }

  it("先停旧的再起新的——两个引擎同时对着一个工作区写是最难查的冲突", async () => {
    const rig = setupTwo()
    const { host, sessions } = rig
    await host.dispatch(create)
    await handoffTo(rig, "other")
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.disposed).toBe(true)
    expect(sessions[1]?.disposed).toBe(false)
  })

  /**
   * **不塞任何文本。** 上一版把 omni 提炼的一段话挂成草稿等用户按回车——
   * 用户否掉了：那是他没打过的话，而历史对话新的引擎自己会读
   *（路径在 `Thread.segments` 里，`/timeline` 看得见）。
   */
  it("**输入框里一个字都不塞**——用户自己那句话直接进新引擎", async () => {
    const rig = setupTwo()
    const { host, events, sessions } = rig
    await host.dispatch(create)
    const threadId = await handoffTo(rig, "other")
    const drafts = events
      .filter((e) => e.type === "thread.updated")
      .filter((e) => e.thread.id === threadId)
      .map((e) => e.thread.draft)
    expect(drafts.every((d) => d === undefined)).toBe(true)
    // 换过去之后他说的那句话原样送到新那家，没有任何 omni 编的前言
    expect((sessions[1]?.prompts ?? []).map((x) => x.text)).toEqual(["接着弄"])
  })

  /**
   * **选了不等于开始用。** 点下拉只记一笔 `nextEngine`：旧进程不停、
   * 新进程不起、模型不清——那一串副作用发生在用户还什么都没说的时候，
   * 看起来就是莫名其妙地变了。
   */
  it("开过工的会话：只点下拉不说话，什么都没变，旧引擎还活着", async () => {
    const rig = setupTwo()
    const { host, events, sessions } = rig
    await host.dispatch(create)
    const threadId = await worked(rig)
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.disposed).toBe(false)
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    const thread = last?.type === "thread.updated" ? last.thread : undefined
    expect(thread?.engine).toBe("fake")
    expect(thread?.nextEngine).toBe("other")
    expect(thread?.engineHistory).toEqual(["fake"])
  })

  /**
   * 「下一句生效」的那个副作用：**换过去之前挑不了新那家的模型**——
   * 清单是引擎起来之后自己报的。所以给一条显式的路，不改默认。
   */
  it("`switchNow`：把已经记下的那笔意向**立刻兑现**", async () => {
    const rig = setupTwo()
    const { host, events, sessions } = rig
    await host.dispatch(create)
    const threadId = await worked(rig)
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    await host.dispatch({ type: "thread.switchNow", threadId })
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.disposed).toBe(true)
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    const thread = last?.type === "thread.updated" ? last.thread : undefined
    expect(thread?.engine).toBe("other")
    expect(thread?.nextEngine).toBeUndefined()
  })

  it("没有待切换的时候 `switchNow` 什么都不做——它兑现意向，不制造意向", async () => {
    const rig = setupTwo()
    const { host, sessions } = rig
    await host.dispatch(create)
    const threadId = await worked(rig)
    await host.dispatch({ type: "thread.switchNow", threadId })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.disposed).toBe(false)
  })

  it("选回当前那家 = 取消待切换", async () => {
    const rig = setupTwo()
    const { host, events } = rig
    await host.dispatch(create)
    const threadId = await worked(rig)
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    await host.dispatch({ type: "thread.handoff", threadId, to: "fake" })
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    expect(last?.type === "thread.updated" ? last.thread.nextEngine : "x").toBeUndefined()
  })

  /**
   * **临时会话反过来：当场切。**
   *
   * 它还什么都没说——没有正在跑的活、没有要保住的上下文，「点错了」的代价是零。
   * 而推迟有个实打实的代价：模型清单要引擎起来才报，不当场切就等于
   * 「你得先说一句话，才能挑这一句用哪个模型」。
   */
  it("**还没说过话的会话：当场切**——新那家起来了，旧那家停了", async () => {
    const { host, events, sessions } = setupTwo()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.disposed).toBe(true)
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    const thread = last?.type === "thread.updated" ? last.thread : undefined
    expect(thread?.engine).toBe("other")
    expect(thread?.nextEngine).toBeUndefined()
    // 还是临时的：切引擎不算「说过话」
    expect(thread?.provisional).toBe(true)
    // **旧那家什么都没发生过，历史里不留一笔**——挑三次就记三条的话，
    // 时间线会被「我点错了」填满
    expect(thread?.engineHistory).toEqual(["other"])
  })

  /**
   * **起不来就原样退回。** 上一版是先 dispose 旧的再 launch 新的，于是
   * 新那家起不来（没装、没登录、版本不对——引擎下拉里那些标着「未安装」的
   * 仍然可选，故意的）时旧进程也已经没了：**那条会话从此发不出任何一句话**，
   * 而界面上看不出为什么。
   */
  it("**新那家起不来就原样退回**——旧那家还活着，下一句照样发得出去", async () => {
    const { driver, session } = fakeDriver()
    const { host, events } = hostWith({
      fake: driver,
      bad: { id: "bad", start: () => Promise.reject(new Error("没装")) },
    })
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await expect(host.dispatch({ type: "thread.handoff", threadId, to: "bad" })).rejects.toThrow(
      "没装",
    )
    expect(session().disposed).toBe(false)
    await host.dispatch({ type: "thread.prompt", threadId, text: "接着弄" })
    expect(session().prompts.map((p) => p.text)).toEqual(["接着弄"])
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    expect(last?.type === "thread.updated" ? last.thread.engine : "").toBe("fake")
  })

  /**
   * 模型清单**带着报它的那家一起走**。不带的话，切过去而新那家一个模型都报不上来时
   * （`models()` 失败就是空数组，那时宿主什么都不发），界面上留着的是上一家的清单
   * ——点一下就拿 claude 的模型 id 去设给 codex。
   */
  it("模型清单报的是哪一家，事件里说得出来", async () => {
    const { host, events } = hostWith({ fake: stub("fake"), other: stub("other") })
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    await new Promise((done) => setTimeout(done, 5))
    const reported = events
      .filter((e) => e.type === "models.updated")
      .map((e) => (e.type === "models.updated" ? [e.engine, e.models.map((m) => m.id).join()] : []))
    expect(reported).toEqual([
      ["fake", "fake-model"],
      ["other", "other-model"],
    ])
  })

  /**
   * **换过去之后界面看到的能力是新那家的。**
   *
   * 上一版发的是局部那份 thread（`launch` 之前拼好的），而引擎能力是 `launch`
   * 期间挂到 `live` 上的——于是换过去之后，贴图入口、改向提示照着**上一家**画。
   * `create` 那边为同一个坑留过一行注释，这条路当初漏了。
   */
  it("换过去之后，界面拿到的是**新那家**的能力", async () => {
    const { host, events } = hostWith({
      fake: stub("fake", { attachments: true }),
      other: stub("other", { attachments: false }),
    })
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    expect(last?.type === "thread.updated" ? last.thread.capabilities?.attachments : "没有").toBe(
      false,
    )
  })

  it("临时会话切过引擎之后，第一句话发给的是新那家", async () => {
    const { host, events, sessions } = setupTwo()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    await host.dispatch({ type: "thread.prompt", threadId, text: "开工" })
    expect((sessions[1]?.prompts ?? []).map((p) => p.text)).toEqual(["开工"])
    expect(sessions[0]?.prompts ?? []).toHaveLength(0)
  })

  it("会话 id 不变，引擎历史往后接一手", async () => {
    const rig = setupTwo()
    const { host, events } = rig
    await host.dispatch(create)
    const threadId = await handoffTo(rig, "other")
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    const thread = last?.type === "thread.updated" ? last.thread : undefined
    expect(thread?.id).toBe(threadId)
    expect(thread?.engineHistory).toEqual(["fake", "other"])
  })

  it("**旧引擎的会话句柄要清掉**——留着的话续跑会拿它去问新的一家", async () => {
    const rig = setupTwo()
    const { host, events, sessions } = rig
    await host.dispatch(create)
    sessions[0]?.handle("old-handle")
    await handoffTo(rig, "other")
    const updates = events.filter((e) => e.type === "thread.updated")
    const afterHandoff = updates.at(-1)
    const thread = afterHandoff?.type === "thread.updated" ? afterHandoff.thread : undefined
    expect(thread?.engineHandle).not.toBe("old-handle")
  })

  it("接力到自己是无操作——不该白白重启一次引擎", async () => {
    const rig = setupTwo()
    const { host, sessions } = rig
    await host.dispatch(create)
    await handoffTo(rig, "fake")
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.disposed).toBe(false)
  })
})

describe("L3 分叉", () => {
  it("原会话不停——这是分叉和接力唯一的区别", async () => {
    const { host, events, sessions } = setupTwoEngines()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "把 X 改成 Y" })
    await host.dispatch({ type: "thread.fork", threadId, to: "other" })
    expect(sessions[0]?.disposed).toBe(false)
    expect(sessions).toHaveLength(2)
  })

  it("新会话是新 id、新引擎历史——不是同一个会话换了家", async () => {
    const { host, events } = setupTwoEngines()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "目标" })
    await host.dispatch({ type: "thread.fork", threadId, to: "other" })
    const started = events.filter((e) => e.type === "thread.started")
    expect(started).toHaveLength(2)
    const forked = started[1]?.type === "thread.started" ? started[1].thread : undefined
    expect(forked?.id).not.toBe(threadId)
    expect(forked?.engineHistory).toEqual(["other"])
  })

  it("分叉出来的那条**一句都没发、一个字都没塞**", async () => {
    const { host, events, sessions } = setupTwoEngines()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "把 X 改成 Y" })
    await host.dispatch({ type: "thread.fork", threadId, to: "other" })
    expect(sessions[1]?.prompts ?? []).toEqual([])
    const forked = events.filter((e) => e.type === "thread.started").at(-1)?.thread.id ?? ""
    const drafts = events
      .filter((e) => e.type === "thread.updated")
      .filter((e) => e.thread.id === forked)
      .map((e) => e.thread.draft)
    expect(drafts.every((d) => d === undefined)).toBe(true)
  })

  it("标题带上引擎名，否则侧栏里两个会话长得一模一样", async () => {
    const { host, events } = setupTwoEngines()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "目标" })
    await host.dispatch({ type: "thread.fork", threadId, to: "other" })
    const started = events.filter((e) => e.type === "thread.started")
    const forked = started[1]?.type === "thread.started" ? started[1].thread : undefined
    expect(forked?.title).toContain("other")
  })
})
