import { describe, expect, it } from "vitest"
import type { Event, Item, Thread } from "@switchback/protocol"
import { nativeTurns } from "./native-turns.js"

const turn = (id: string, engine: string, at: number): Event => ({
  type: "turn.started", at, turn: { id, threadId: "th", engine, status: "running", startedAt: at },
})
const said = (turnId: string, at: number): Item => ({ id: `u-${turnId}`, turnId, at, kind: "user_message", text: turnId })
const seg = (engine: string, handle: string, startedAt: number): NonNullable<Thread["segments"]>[number] => ({ engine, handle, startedAt })

function thread(engine: string, handle: string, segments: Thread["segments"]): Thread {
  return {
    id: "th", title: "t", cwd: "/w", engine, trust: "auto-edit", status: "idle", createdAt: 0, updatedAt: 0,
    engineHistory: [engine], engineHandle: handle, ...(segments === undefined ? {} : { segments }),
  }
}

describe("从这里重来时只数这条原生会话自己的轮次", () => {
  const cases: readonly {
    name: string
    events: readonly Event[]
    thread: Thread
    turns: readonly string[]
    keep: number
    want: { before: number; after: number }
  }[] = [
    {
      name: "一家从头跑到尾：照常数",
      events: [turn("a1", "a", 1), turn("a2", "a", 2), turn("a3", "a", 3)],
      thread: thread("a", "hA", [seg("a", "hA", 1)]),
      turns: ["a1", "a2", "a3"], keep: 1,
      want: { before: 1, after: 2 },
    },
    {
      name: "换家后的第一轮：之前都是别家的，这一家一轮都没有",
      events: [turn("a1", "a", 1), turn("a2", "a", 2), turn("b1", "b", 3)],
      thread: thread("b", "hB", [seg("a", "hA", 1), seg("b", "hB", 3)]),
      turns: ["a1", "a2", "b1"], keep: 2,
      want: { before: 0, after: 1 },
    },
    {
      name: "A→B→A 后在 B 那一轮重来：只砍 A 自己后来那一轮",
      events: [turn("a1", "a", 1), turn("a2", "a", 2), turn("b1", "b", 3), turn("a3", "a", 4)],
      thread: thread("a", "hA", [seg("a", "hA", 1), seg("b", "hB", 3), seg("a", "hA", 4)]),
      turns: ["a1", "a2", "b1", "a3"], keep: 2,
      want: { before: 2, after: 1 },
    },
    {
      name: "同一家换过一条新原生会话：旧会话的轮次不在新会话里",
      events: [turn("a1", "a", 1), turn("a2", "a", 5), turn("a3", "a", 6)],
      thread: thread("a", "hA2", [seg("a", "hA1", 1), seg("a", "hA2", 5)]),
      turns: ["a1", "a2", "a3"], keep: 2,
      want: { before: 1, after: 1 },
    },
    {
      name: "认不出是谁跑的（旧记录没有 turn.started）：照旧算在当前这条上",
      events: [],
      thread: thread("a", "hA", undefined),
      turns: ["x1", "x2", "x3"], keep: 1,
      want: { before: 1, after: 2 },
    },
    {
      name: "抄过来的历史早于这家第一段：归第一段",
      events: [turn("c1", "a", 1), turn("c2", "a", 2), turn("f3", "a", 9)],
      thread: thread("a", "hF", [seg("a", "hF", 9)]),
      turns: ["c1", "c2", "f3"], keep: 2,
      want: { before: 2, after: 1 },
    },
  ]
  for (const one of cases) {
    it(one.name, () => {
      const all = one.turns.map((id, index) => said(id, index))
      expect(nativeTurns(one.events, one.thread, all, all.slice(0, one.keep))).toEqual(one.want)
    })
  }
})
