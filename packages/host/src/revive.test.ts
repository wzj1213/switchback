import { describe, expect, it } from "vitest"
import type { EngineDriver } from "@switchback/engine"
import type { Event, Thread } from "@switchback/protocol"
import { setupTwoEngines } from "./host-fixture.js"

/**
 * 历史会话（宿主手上没有、背后没有进程）**发话就接回来**，不再要人先点「继续」。
 * 见 `revive.ts`。
 */

const OLD = "th-old"

function record(patch: Partial<Thread> = {}): Thread {
  return {
    id: OLD,
    title: "旧会话",
    cwd: "/w",
    engine: "fake",
    trust: "auto-edit",
    status: "idle",
    createdAt: 0,
    updatedAt: 0,
    engineHistory: ["fake"],
    engineHandle: "h-old",
    segments: [{ engine: "fake", handle: "h-old", startedAt: 0 }],
    ...patch,
  }
}

/** 磁盘上留着一条历史会话的宿主。`extra` 原样补进宿主依赖。 */
function history(patch: Partial<Thread> = {}, extra: Parameters<typeof setupTwoEngines>[0] = {}): ReturnType<typeof setupTwoEngines> {
  const rig = setupTwoEngines(extra)
  const thread = record(patch)
  rig.stored.push({ type: "thread.started", at: 0, thread })
  // 原来那家真跑过一轮：历史会话的记录里一定有它（`reattached` 靠它分辨有没有上下文可接）
  rig.stored.push({ type: "turn.started", at: 0, turn: { id: "tn-old", threadId: OLD, engine: thread.engine, status: "running", startedAt: 0 } })
  return rig
}

function last(events: readonly Event[]): Thread | undefined {
  const found = events.findLast((event) => event.type === "thread.updated")
  return found?.type === "thread.updated" ? found.thread : undefined
}

const prompt = (text: string, attachments?: readonly string[]) => ({
  type: "thread.prompt" as const,
  threadId: OLD,
  text,
  ...(attachments === undefined ? {} : { attachments }),
})

describe("历史会话发话即接回", () => {
  it("原来那家还在：续它自己那条原生会话，再把这句话发出去", async () => {
    const { host, sessions } = history()
    await host.dispatch(prompt("接着做"))
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.resume).toBe("h-old")
    expect(sessions[0]?.prompts.map((p) => p.text)).toEqual(["接着做"])
    expect(host.live()[0]).toMatchObject({ id: OLD, engine: "fake", detached: false })
  })

  it("历史状态下改过的名字接回之后还在", async () => {
    const { host, stored } = history()
    stored.push({ type: "thread.renamed", at: 1, threadId: OLD, title: "改分页那条" })
    await host.dispatch(prompt("接着做"))
    expect(host.live()[0]).toMatchObject({ title: "改分页那条", named: true })
  })

  it("挑过别家：直接起那一家，不先把原来那家拉起来", async () => {
    const { host, sessions, events } = history()
    await host.dispatch({ type: "thread.handoff", threadId: OLD, to: "other" })
    // 挑引擎只改记录，不起进程
    expect(sessions).toHaveLength(0)
    expect(last(events)).toMatchObject({ engine: "fake", nextEngine: "other", detached: true })

    await host.dispatch(prompt("换一家接着做"))
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.resume).toBeUndefined()
    expect(host.live()[0]).toMatchObject({ engine: "other", engineHistory: ["fake", "other"] })
    expect(host.live()[0]?.nextEngine).toBeUndefined()
  })

  it("换家后的第一句照样附交接说明（开着的话）", async () => {
    const { host, sessions } = history({}, { handoffBrief: () => Promise.resolve("交接说明") })
    await host.dispatch({ type: "thread.handoff", threadId: OLD, to: "other" })
    await host.dispatch(prompt("换一家接着做"))
    expect(sessions[0]?.prompts.map((p) => p.text)).toEqual(["交接说明\n\n换一家接着做"])
  })

  it("切回以前跑过的那家：续它自己那一段，不新开", async () => {
    const segments = [
      { engine: "other", handle: "h-other", startedAt: 0 },
      { engine: "fake", handle: "h-old", startedAt: 1 },
    ]
    const { host, sessions } = history({ engineHistory: ["other", "fake"], segments, nextEngine: "other" })
    await host.dispatch(prompt("回到 other"))
    expect(sessions[0]?.resume).toBe("h-other")
  })

  it("在历史会话上选回原来那家 = 取消待换", async () => {
    const { host, events } = history({ nextEngine: "other" })
    await host.dispatch({ type: "thread.handoff", threadId: OLD, to: "fake" })
    expect(last(events)?.nextEngine).toBeUndefined()
  })

  it("原来那家被删了也能取消待换；挑一家没注册的照样报错", async () => {
    const { host, events } = history({ engine: "gone", engineHistory: ["gone"], nextEngine: "other" })
    await host.dispatch({ type: "thread.handoff", threadId: OLD, to: "gone" })
    expect(last(events)).toMatchObject({ engine: "gone", detached: true })
    expect(last(events)?.nextEngine).toBeUndefined()
    await expect(host.dispatch({ type: "thread.handoff", threadId: OLD, to: "nope" })).rejects.toThrow("未注册的引擎")
  })

  it("「现在就切」：记着要换的那家就当场接回，没记就什么都不做", async () => {
    const idle = history()
    await idle.host.dispatch({ type: "thread.switchNow", threadId: OLD })
    expect(idle.sessions).toHaveLength(0)

    const pending = history({ nextEngine: "other" })
    await pending.host.dispatch({ type: "thread.switchNow", threadId: OLD })
    expect(pending.sessions).toHaveLength(1)
    expect(pending.host.live()[0]).toMatchObject({ engine: "other" })
  })

  it("改档位只改记录，而且仍标着 detached——不然界面会把它当成活会话", async () => {
    const { host, events, sessions } = history()
    await host.dispatch({ type: "thread.setTrust", threadId: OLD, trust: "read-only" })
    expect(sessions).toHaveLength(0)
    expect(last(events)).toMatchObject({ trust: "read-only", detached: true, status: "idle" })
  })
})

const broken: EngineDriver = { id: "broken", start: () => Promise.reject(new Error("起不来")) }

describe("接不回来：说清楚，那句话退回输入框", () => {
  const cases: {
    name: string
    patch: Partial<Thread>
    drivers?: Record<string, EngineDriver>
    error: string
  }[] = [
    { name: "原来那家被删了", patch: { engine: "gone", engineHistory: ["gone"] }, error: "已经不在了" },
    { name: "挑的那家也不在了", patch: { nextEngine: "gone" }, error: "已经不在了" },
    { name: "没有留下句柄（旧版本记录）", patch: { engineHandle: undefined, segments: [] }, error: "句柄" },
    {
      name: "进程起不来",
      patch: { engine: "broken", engineHistory: ["broken"] },
      drivers: { broken },
      error: "起不来",
    },
  ]
  for (const c of cases) {
    it(c.name, async () => {
      const { host, events } = history(c.patch, c.drivers === undefined ? {} : { drivers: c.drivers })
      await expect(host.dispatch(prompt("别丢了这句", ["/tmp/a.png"]))).rejects.toThrow(c.error)
      expect(host.live()).toHaveLength(0)
      const back = last(events)
      expect(back).toMatchObject({ detached: true, status: "idle", draft: "别丢了这句", draftAttachments: ["/tmp/a.png"] })
      expect(back?.draftRevision).toBeDefined()
    })
  }

  it("换过来还没开口就停了（Claude 开轮之后才报句柄）：这一家一轮没跑过，新起一条", async () => {
    const rig = setupTwoEngines()
    rig.stored.push({ type: "thread.started", at: 0, thread: record({ engine: "fake", engineHistory: ["fake"] }) })
    rig.stored.push({ type: "turn.started", at: 0, turn: { id: "tn-old", threadId: OLD, engine: "fake", status: "running", startedAt: 0 } })
    rig.stored.push({ type: "thread.updated", at: 1, thread: record({
      engine: "other", engineHistory: ["fake", "other"], engineHandle: undefined,
      segments: [{ engine: "fake", handle: "h-old", startedAt: 0 }],
    }) })
    await rig.host.dispatch(prompt("接着做"))
    expect(rig.sessions).toHaveLength(1)
    expect(rig.sessions[0]?.resume).toBeUndefined()
    expect(rig.sessions[0]?.prompts.map((p) => p.text)).toEqual(["接着做"])
  })

  it("没有句柄时换一家照样接得上——那是明确的动作，不算冒充", async () => {
    const { host, sessions } = history({ engineHandle: undefined, segments: [], nextEngine: "other" })
    await host.dispatch(prompt("换一家"))
    expect(sessions).toHaveLength(1)
    expect(host.live()[0]?.engine).toBe("other")
  })

  it("磁盘上没有这条会话：报错，不凭空新建", async () => {
    const { host, sessions } = setupTwoEngines()
    await expect(host.dispatch({ ...prompt("hi"), threadId: "没有这条" })).rejects.toThrow("找不到")
    expect(sessions).toHaveLength(0)
  })
})

describe("历史会话直接分叉：不必先把原来那家拉起来", () => {
  it("换一家分叉：只起新那家，岔出来的是一条临时会话、记着来路", async () => {
    const { host, sessions, events } = history()
    await host.dispatch({ type: "thread.fork", threadId: OLD, to: "other" })
    expect(sessions).toHaveLength(1)
    const born = events.find((event) => event.type === "thread.started")
    expect(born?.type === "thread.started" ? born.thread : undefined).toMatchObject({
      engine: "other",
      forkedFrom: OLD,
      provisional: true,
    })
    expect(host.live().map((thread) => thread.engine)).toEqual(["other"])
  })

  it("原来那家被删了也分得出来——那正是最想换一家再试的时候", async () => {
    const { host, sessions } = history({ engine: "gone", engineHistory: ["gone"], pendingQuestions: [] })
    await host.dispatch({ type: "thread.fork", threadId: OLD, to: "other" })
    expect(sessions).toHaveLength(1)
    expect(host.live()[0]).toMatchObject({ engine: "other", forkedFrom: OLD })
  })

  it("磁盘上没有这条：照旧报会话不存在", async () => {
    const { host } = setupTwoEngines()
    await expect(host.dispatch({ type: "thread.fork", threadId: "没有这条", to: "other" })).rejects.toThrow("会话不存在")
  })
})
