import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { handleNotification, type NotifyContext } from "./notify.js"
import type { WireItem } from "./wire.js"

const setup = (turn = "tn-1"): { ctx: NotifyContext; events: Event[] } => {
  const events: Event[] = []
  const ctx: NotifyContext = {
    threadId: "th-1",
    codexThread: () => undefined,
    emit: (e) => events.push(e),
    turnId: () => turn,
    inflight: new Map<string, WireItem>(),
    streamed: new Map<string, string>(),
    materialized: new Set<string>(),
    mcpSeen: new Map<string, string>(),
    now: () => 100,
  }
  return { ctx, events }
}

/** 从事件里取出 item，取不到给 undefined——断言比窄化更容易把真错误藏起来。 */
const itemOf = (e: Event | undefined): { id: string } | undefined =>
  e?.type === "item.started" || e?.type === "item.updated" ? e.item : undefined

const update = (plan: unknown, extra: Record<string, unknown> = {}): unknown => ({
  threadId: "cx-th",
  turnId: "cx-tn",
  plan,
  ...extra,
})

describe("codex 的计划 → plan item", () => {
  it("翻译整份快照，状态词按 v2 的 camelCase 认", () => {
    const { ctx, events } = setup()
    handleNotification(
      ctx,
      "turn/plan/updated",
      update([
        { step: "读源码", status: "completed" },
        { step: "写翻译", status: "inProgress" },
        { step: "补测试", status: "pending" },
      ]),
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "item.started",
      item: {
        kind: "plan",
        turnId: "tn-1",
        steps: [
          { text: "读源码", status: "done" },
          { text: "写翻译", status: "in_progress" },
          { text: "补测试", status: "pending" },
        ],
      },
    })
  })

  // 同一个枚举在 codex 仓库里有 snake / camel 两份序列化（见 `wire.ts`）。
  // 线上走的是 camel，但两份都在，所以两种都认
  it("snake_case 的 in_progress 也认", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "turn/plan/updated", update([{ step: "a", status: "in_progress" }]))
    expect(events[0]).toMatchObject({ item: { steps: [{ text: "a", status: "in_progress" }] } })
  })

  it("认不出的状态当 pending，不当 done——猜错的方向必须是保守的那一边", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "turn/plan/updated", update([{ step: "a", status: "wat" }, { step: "b" }]))
    expect(events[0]).toMatchObject({
      item: { steps: [{ status: "pending" }, { status: "pending" }] },
    })
  })

  it("同一轮反复更新是同一张卡：第二条起是 item.updated，且 id 不变", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "turn/plan/updated", update([{ step: "a", status: "pending" }]))
    handleNotification(ctx, "turn/plan/updated", update([{ step: "a", status: "completed" }]))
    expect(events.map((e) => e.type)).toEqual(["item.started", "item.updated"])
    expect(itemOf(events[0])?.id).toBe(itemOf(events[1])?.id)
  })

  it("换一轮换 id，所以是新的一张卡", () => {
    const a = setup("tn-1")
    const b = setup("tn-2")
    handleNotification(a.ctx, "turn/plan/updated", update([{ step: "x", status: "pending" }]))
    handleNotification(b.ctx, "turn/plan/updated", update([{ step: "y", status: "pending" }]))
    expect(itemOf(a.events[0])?.id).not.toBe(itemOf(b.events[0])?.id)
  })

  it("空计划不发——codex 轮次开头会推一条空的，发出去就是一张空卡", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "turn/plan/updated", update([]))
    handleNotification(ctx, "turn/plan/updated", update(undefined))
    expect(events).toEqual([])
  })

  it("已经有内容之后再收到空的也不发，不把卡就地清空", () => {
    const { ctx, events } = setup()
    handleNotification(ctx, "turn/plan/updated", update([{ step: "a", status: "pending" }]))
    handleNotification(ctx, "turn/plan/updated", update([]))
    expect(events).toHaveLength(1)
  })

  it("没有在跑的轮次就不发", () => {
    const { ctx, events } = setup()
    const idle: NotifyContext = { ...ctx, turnId: () => undefined }
    handleNotification(idle, "turn/plan/updated", update([{ step: "a", status: "pending" }]))
    expect(events).toEqual([])
  })

  it("引擎写的理由带上；没写或写了空串就没有这个字段", () => {
    const withWhy = setup()
    handleNotification(withWhy.ctx, "turn/plan/updated", update([{ step: "a" }], { explanation: "先把源码读完" }))
    expect(withWhy.events[0]).toMatchObject({ item: { explanation: "先把源码读完" } })

    const withoutWhy = setup()
    handleNotification(withoutWhy.ctx, "turn/plan/updated", update([{ step: "a" }], { explanation: null }))
    expect(withoutWhy.events[0]).toMatchObject({ item: { kind: "plan" } })
    expect(itemOf(withoutWhy.events[0])).not.toHaveProperty("explanation")
  })

  it("别的会话推来的计划不收", () => {
    const { ctx, events } = setup()
    const own: NotifyContext = { ...ctx, codexThread: () => "cx-mine" }
    handleNotification(own, "turn/plan/updated", update([{ step: "a" }], { threadId: "cx-other" }))
    expect(events).toEqual([])
  })
})
