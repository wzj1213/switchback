import { describe, expect, it } from "vitest"
import type { Event, Thread, TurnPace } from "@switchback/protocol"
import { initial, latestPaceOf, pacesOf } from "./state.js"
import { reduceAll, reduceHistory } from "./reduce.js"

const thread = (id: string): Thread => ({
  id, title: id, cwd: "/w", engine: "claude", trust: "auto-edit", status: "idle",
  createdAt: 0, updatedAt: 0, engineHistory: ["claude"],
})
const started = (id: string): Event => ({ type: "thread.started", at: 0, thread: thread(id) })
const turn = (threadId: string, turnId: string): Event => ({
  type: "turn.started", at: 0, turn: { id: turnId, threadId, engine: "claude", status: "running", startedAt: 0 },
})
const done = (turnId: string, pace?: TurnPace): Event =>
  ({ type: "turn.completed", at: 1, turnId, status: "completed", ...(pace === undefined ? {} : { pace }) })
const pace = (tps: number): TurnPace => ({ firstMs: 600, tps, tokens: 300, exact: true })

describe("每一轮的出字节奏", () => {
  it("收工时带来的节奏按会话、按轮次留下——**跑完的轮次也留着**，分界线要印", () => {
    const s = reduceAll(initial(), [started("a"), turn("a", "r1"), done("r1", pace(40)), turn("a", "r2"), done("r2", pace(55))])
    expect(pacesOf(s, "a")).toEqual({ r1: pace(40), r2: pace(55) })
    expect(latestPaceOf(s, "a")).toEqual(pace(55))
  })

  it("没带节奏的收工（抄过来的历史、一个字都没写）不占位", () => {
    const s = reduceAll(initial(), [started("a"), turn("a", "r1"), done("r1")])
    expect(pacesOf(s, "a")).toEqual({})
    expect(latestPaceOf(s, "a")).toBeUndefined()
  })

  it("新一轮开了之后旧轮才迟到的收工不记：归约器已经不认得它属于谁，宿主那边也早扔了它的账", () => {
    const s = reduceAll(initial(), [started("a"), turn("a", "r1"), turn("a", "r2"), done("r1", pace(40))])
    expect(pacesOf(s, "a")).toEqual({})
  })

  it("一轮都没有时给同一个空表：引用稳定，界面的 memo 才认得住", () => {
    expect(pacesOf(initial(), "a")).toBe(pacesOf(initial(), "b"))
  })

  it("删会话一起删；补历史时先清掉再按历史铺", () => {
    const base = reduceAll(initial(), [started("a"), turn("a", "r1"), done("r1", pace(40))])
    const removed = reduceAll(base, [{ type: "thread.removed", at: 2, threadId: "a" }])
    expect(removed.paces["a"]).toBeUndefined()
    const replayed = reduceHistory(base, "a", [turn("a", "r9"), done("r9", pace(70))])
    expect(pacesOf(replayed, "a")).toEqual({ r9: pace(70) })
  })
})
