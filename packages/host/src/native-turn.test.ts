import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES, type Event } from "@switchback/protocol"
import type { EngineDriver, EngineSession } from "@switchback/engine"
import { createHost } from "./host.js"
import { create } from "./host-fixture.js"

describe("引擎主动轮次", () => {
  it("实时流在激活阶段就触发时，先转正并建宿主轮，再完整收口", async () => {
    const events: Event[] = []
    const stored: Event[] = []
    const ids = { next: 0 }
    const driver: EngineDriver = {
      id: "fake",
      start: (req) => {
        const session: EngineSession = {
          threadId: req.threadId,
          activate: () => {
            const turnId = req.onNativeTurn?.({
              at: 7,
              prompt: "检查部署",
              origin: {
                kind: "scheduled",
                taskId: "job-1",
                schedule: "7 * * * *",
                recurring: true,
                coalescedCount: 1,
                stale: false,
              },
            })
            if (turnId !== undefined) {
              req.emit({
                type: "item.started",
                at: 8,
                item: {
                  id: "native-answer",
                  turnId,
                  at: 8,
                  kind: "agent_message",
                  text: "正常",
                  complete: true,
                },
              })
              req.emit({ type: "turn.completed", at: 9, turnId, status: "completed" })
            }
            const externalTurn = req.onNativeTurn?.({ at: 10, prompt: "原生端追加" })
            if (externalTurn !== undefined) {
              req.emit({ type: "turn.completed", at: 11, turnId: externalTurn, status: "completed" })
            }
            const continuation = req.onNativeTurn?.({
              at: 12,
              prompt: "",
              origin: { kind: "goal_continuation" },
            })
            if (continuation !== undefined) {
              req.emit({ type: "turn.completed", at: 13, turnId: continuation, status: "completed" })
            }
            return Promise.resolve()
          },
          prompt: () => Promise.resolve(),
          interrupt: () => Promise.resolve(),
          setTrust: () => Promise.resolve({ restart: false }),
          setModel: () => Promise.resolve({}),
          models: () => Promise.resolve([]),
          capabilities: () => NO_CAPABILITIES,
          dispose: () => Promise.resolve(),
        }
        return Promise.resolve(session)
      },
    }
    const host = createHost({
      drivers: { fake: driver },
      home: "/h",
      emit: (event) => events.push(event),
      now: () => 10,
      newId: (prefix) => `${prefix}-${String(++ids.next)}`,
      journal: {
        append: (_threadId, event) => {
          stored.push(event)
          return Promise.resolve()
        },
        read: () => Promise.resolve([]),
        list: () => Promise.resolve([]),
        remove: () => Promise.resolve(),
        flush: () => Promise.resolve(),
      },
    })

    await host.dispatch(create)

    const committed = events.findIndex(
      (event) => event.type === "thread.updated" && event.thread.provisional === undefined,
    )
    const started = events.findIndex((event) => event.type === "turn.started")
    expect(committed).toBeGreaterThan(-1)
    expect(committed).toBeLessThan(started)
    expect(
      events.find((event) => event.type === "item.started" && event.item.kind === "user_message"),
    ).toMatchObject({ item: { text: "检查部署", origin: { kind: "scheduled", taskId: "job-1" } } })
    const external = events
      .find(
        (event) =>
          event.type === "item.started" &&
          event.item.kind === "user_message" &&
          event.item.text === "原生端追加",
      )
    expect(external).toMatchObject({
      type: "item.started",
      at: 10,
      item: { kind: "user_message", at: 10, text: "原生端追加" },
    })
    expect(external).not.toHaveProperty("item.origin")
    expect(
      events.find(
        (event) =>
          event.type === "item.started" &&
          event.item.kind === "user_message" &&
          typeof event.item.origin === "object" &&
          event.item.origin.kind === "goal_continuation",
      ),
    ).toMatchObject({ item: { text: "", origin: { kind: "goal_continuation" } } })
    expect(stored.some((event) => event.type === "turn.completed")).toBe(true)
    expect(host.live()[0]).toMatchObject({ status: "idle" })
    expect(host.live()[0]).not.toHaveProperty("provisional")
    await host.dispose()
  })
})
