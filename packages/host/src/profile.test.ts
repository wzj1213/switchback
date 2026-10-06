import { describe, expect, it } from "vitest"
import type { EngineDriver, EngineSession, StartRequest } from "@switchback/engine"
import { NO_CAPABILITIES, type Event, type Thread } from "@switchback/protocol"
import { createHost } from "./host.js"

interface Seen {
  profile?: string
  resume?: string
}

function driver(starts: Seen[], reported?: string, id = "dsh"): EngineDriver {
  return {
    id,
    start: (req: StartRequest) => {
      starts.push({
        ...(req.profile === undefined ? {} : { profile: req.profile }),
        ...(req.resume === undefined ? {} : { resume: req.resume }),
      })
      req.onHandle?.(req.resume ?? "native-new")
      return Promise.resolve({
        threadId: req.threadId,
        ...(reported === undefined && req.profile === undefined
          ? {}
          : { profile: reported ?? req.profile }),
        prompt: (_text, turnId) => {
          req.emit({ type: "turn.completed", at: 0, turnId, status: "completed" })
          return Promise.resolve()
        },
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([]),
        capabilities: () => NO_CAPABILITIES,
        setModel: () => Promise.resolve({}),
        dispose: () => Promise.resolve(),
      } as EngineSession)
    },
  }
}

function baseHost(
  dsh: EngineDriver,
  events: Event[],
  journal?: readonly Event[],
  others: Readonly<Record<string, EngineDriver>> = {},
) {
  const ids = { value: 0 }
  return createHost({
    drivers: { dsh, ...others },
    home: "/home/dev",
    emit: (event) => events.push(event),
    newId: (prefix) => `${prefix}-${String(++ids.value)}`,
    now: () => ids.value,
    ...(journal === undefined ? {} : {
      journal: {
        append: () => Promise.resolve(),
        flush: () => Promise.resolve(),
        read: () => Promise.resolve(journal),
        list: () => Promise.resolve(["th-old"]),
        remove: () => Promise.resolve(),
      },
    }),
  })
}

describe("引擎 profile 会话归属", () => {
  it("新会话采用驱动实际报告的 profile，并把它记进引擎段", async () => {
    const starts: Seen[] = []
    const events: Event[] = []
    const host = baseHost(driver(starts, "team"), events)
    await host.dispatch({ type: "thread.create", cwd: "/w", engine: "dsh", trust: "auto-edit" })
    const thread = host.live()[0]
    expect(starts).toEqual([{}])
    expect(thread?.engineProfile).toBe("team")
    await host.dispatch({ type: "thread.prompt", threadId: thread?.id ?? "", text: "开始" })
    expect(host.live()[0]?.segments).toMatchObject([
      { engine: "dsh", profile: "team", handle: "native-new" },
    ])
  })

  it("接管原生历史时把那一行自报的 profile 原样送回驱动", async () => {
    const starts: Seen[] = []
    const events: Event[] = []
    const host = baseHost(driver(starts), events)
    await host.dispatch({
      type: "thread.adopt", engine: "dsh", profile: "team", handle: "native-team",
      cwd: "/w", title: "团队会话",
    })
    expect(starts).toEqual([{ profile: "team", resume: "native-team" }])
    expect(host.live()[0]?.engineProfile).toBe("team")
  })

  it("重启后续跑仍使用落盘 profile，不跟随后来改过的默认值", async () => {
    const starts: Seen[] = []
    const events: Event[] = []
    const thread: Thread = {
      id: "th-old", title: "旧会话", cwd: "/w", engine: "dsh", engineProfile: "old",
      engineHandle: "native-old", trust: "auto-edit", status: "idle", createdAt: 1,
      updatedAt: 1, engineHistory: ["dsh"],
    }
    const disk: Event[] = [{ type: "thread.started", at: 1, thread }]
    const host = baseHost(driver(starts), events, disk)
    await host.dispatch({ type: "thread.resume", threadId: "th-old" })
    expect(starts).toEqual([{ profile: "old", resume: "native-old" }])
    expect(host.live()[0]?.engineProfile).toBe("old")
  })

  it("接力到别家再切回时恢复原 profile 与原生句柄", async () => {
    const dshStarts: Seen[] = []
    const otherStarts: Seen[] = []
    const events: Event[] = []
    const host = baseHost(
      driver(dshStarts, "team"),
      events,
      undefined,
      { other: driver(otherStarts, undefined, "other") },
    )
    await host.dispatch({ type: "thread.create", cwd: "/w", engine: "dsh", trust: "auto-edit" })
    const threadId = host.live()[0]?.id ?? ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "先做" })
    await host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    await host.dispatch({ type: "thread.prompt", threadId, text: "换一家" })
    await host.dispatch({ type: "thread.handoff", threadId, to: "dsh" })
    await host.dispatch({ type: "thread.prompt", threadId, text: "切回来" })

    expect(dshStarts).toEqual([{}, { profile: "team", resume: "native-new" }])
    expect(otherStarts).toEqual([{}])
    expect(host.live()[0]).toMatchObject({ engine: "dsh", engineProfile: "team" })
  })
})
