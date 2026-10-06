import { describe, expect, it } from "vitest"
import { type Event } from "@switchback/protocol"
import type { StoredRule } from "@switchback/journal"
import { createHost, type Host } from "./host.js"
import { create, items, ask, fakeDriver, type Fake } from "./host-fixture.js"

describe("删除会话", () => {
  it("先落定审批、再 dispose、最后删文件——反过来会留下一个卡住的驱动和一个删不掉的文件", async () => {
    const removed: string[] = []
    const stored: Event[] = []
    const { driver, session } = fakeDriver()
    const events: Event[] = []
    const counter = { n: 0 }
    const host = createHost({
      drivers: { fake: driver },
      home: "/h",
      emit: (e) => events.push(e),
      newId: (p) => {
        counter.n += 1
        return `${p}-${String(counter.n)}`
      },
      now: () => 0,
      journal: {
        append: (_id, e) => {
          stored.push(e)
          return Promise.resolve()
        },
        read: () => Promise.resolve(stored),
        list: () => Promise.resolve([]),
        remove: (id) => {
          // 删文件时驱动必须已经处置完
          expect(session().disposed).toBe(true)
          removed.push(id)
          return Promise.resolve()
        },
        flush: () => Promise.resolve(),
      },
    })
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const answer = session().ask(ask)

    await host.dispatch({ type: "thread.delete", threadId })
    expect(removed).toEqual([threadId])
    await expect(answer).resolves.toEqual({ allow: false, remember: "once" })
    expect(events.at(-1)).toEqual({ type: "thread.removed", at: 0, threadId })
  })

  it("删一个只在磁盘上的会话（宿主没登记）同样有效", async () => {
    const removed: string[] = []
    const { driver } = fakeDriver()
    const events: Event[] = []
    const host = createHost({
      drivers: { fake: driver },
      home: "/h",
      emit: (e) => events.push(e),
      newId: (p) => `${p}-1`,
      now: () => 0,
      journal: {
        append: () => Promise.resolve(),
        read: () => Promise.resolve([]),
        list: () => Promise.resolve([]),
        remove: (id) => {
          removed.push(id)
          return Promise.resolve()
        },
        flush: () => Promise.resolve(),
      },
    })
    await host.dispatch({ type: "thread.delete", threadId: "th-from-disk" })
    expect(removed).toEqual(["th-from-disk"])
  })

  it("驱动 dispose 报错也会继续删除本地记录", async () => {
    const { driver } = fakeDriver()
    const removed: string[] = []
    const events: Event[] = []
    const host = createHost({
      drivers: {
        fake: {
          ...driver,
          start: async (request) => ({
            ...(await driver.start(request)),
            dispose: () => Promise.reject(new Error("cleanup failed")),
          }),
        },
      },
      home: "/h",
      emit: (event) => events.push(event),
      newId: (prefix) => `${prefix}-dispose-error`,
      now: () => 0,
      journal: {
        append: () => Promise.resolve(),
        read: () => Promise.resolve([]),
        list: () => Promise.resolve([]),
        remove: (id) => {
          removed.push(id)
          return Promise.resolve()
        },
        flush: () => Promise.resolve(),
      },
    })
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await expect(host.dispatch({ type: "thread.delete", threadId })).resolves.toBeUndefined()
    expect(removed).toEqual([threadId])
    expect(host.live()).toEqual([])
  })
})

describe("审批记忆", () => {
  const setupRules = (): {
    host: Host
    events: Event[]
    session: () => Fake
    saved: { worksite: string; id: string; scope: string }[]
    seed: StoredRule[]
  } => {
    const saved: { worksite: string; id: string; scope: string }[] = []
    const seed: StoredRule[] = []
    const { driver, session } = fakeDriver()
    const events: Event[] = []
    const counter = { n: 0 }
    const host = createHost({
      drivers: { fake: driver },
      home: "/h",
      emit: (e) => events.push(e),
      newId: (p) => {
        counter.n += 1
        return `${p}-${String(counter.n)}`
      },
      now: () => 0,
      rules: {
        read: () => Promise.resolve(seed),
        add: (worksite, r) => {
          saved.push({ worksite, id: r.id, scope: r.scope })
          return Promise.resolve([r])
        },
        remove: () => Promise.resolve([]),
      },
    })
    return { host, events, session, saved, seed }
  }

  const suggested = {
    id: "sig:pnpm test",
    describe: "自动允许 pnpm test",
    pattern: {},
    scope: "project" as const,
  }

  const askWith = { ...ask, suggest: suggested }

  it("开会话时把工作区已有的规则读进来交给驱动", async () => {
    const { host, seed, session } = setupRules()
    seed.push({ id: "old", describe: "旧规则", pattern: {}, scope: "project" })
    await host.dispatch(create)
    expect(
      session()
        .memory()
        .map((r) => r.id),
    ).toEqual(["old"])
  })

  it("勾了「始终允许」才写盘", async () => {
    const { host, events, session, saved } = setupRules()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const answer = session().ask(askWith)
    const card = items(events).find((i) => i.kind === "approval")
    await host.dispatch({
      type: "approval.resolve",
      itemId: card?.id ?? "",
      allow: true,
      remember: "project",
    })
    await answer
    expect(saved).toEqual([{ worksite: "/w", id: "sig:pnpm test", scope: "project" }])
  })

  it("「允许此对话」只进内存不写盘——落盘会让下次启动莫名其妙少几次询问", async () => {
    const { host, events, session, saved } = setupRules()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const answer = session().ask(askWith)
    const card = items(events).find((i) => i.kind === "approval")
    await host.dispatch({
      type: "approval.resolve",
      itemId: card?.id ?? "",
      allow: true,
      remember: "session",
    })
    await answer
    expect(saved).toEqual([])
    // 但**立刻**对后续判定生效——所以 memory 是取值函数不是快照
    expect(
      session()
        .memory()
        .map((r) => r.id),
    ).toEqual(["sig:pnpm test"])
  })

  it("拒绝不记忆——记住一次拒绝没有意义，下次同样的请求还是该问", async () => {
    const { host, events, session, saved } = setupRules()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const answer = session().ask(askWith)
    const card = items(events).find((i) => i.kind === "approval")
    await host.dispatch({
      type: "approval.resolve",
      itemId: card?.id ?? "",
      allow: false,
      remember: "project",
    })
    await answer
    expect(saved).toEqual([])
    expect(session().memory()).toEqual([])
  })

  it("remember:'once' 什么都不留", async () => {
    const { host, events, session, saved } = setupRules()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const answer = session().ask(askWith)
    const card = items(events).find((i) => i.kind === "approval")
    await host.dispatch({
      type: "approval.resolve",
      itemId: card?.id ?? "",
      allow: true,
      remember: "once",
    })
    await answer
    expect(saved).toEqual([])
    expect(session().memory()).toEqual([])
  })

  it("引擎撤销审批时解开等待并把卡片标成失效，不冒充用户拒绝", async () => {
    const { host, events, session } = setupRules()
    await host.dispatch(create)
    const threadId = events[0]?.type === "thread.started" ? events[0].thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "hi" })
    const controller = new AbortController()
    const answer = session().ask(askWith, { signal: controller.signal })
    controller.abort()
    await expect(answer).resolves.toEqual({ allow: false, remember: "once" })
    const card = items(events).filter((item) => item.kind === "approval").at(-1)
    expect(card?.kind === "approval" ? card.status : "").toBe("cancelled")
    await host.dispose()
  })
})
