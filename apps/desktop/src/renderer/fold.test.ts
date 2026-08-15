import { describe, expect, it } from "vitest"
import { foldTurns, groupRows } from "./group.js"
import type { Item } from "@omni/protocol"

const item = (id: string, kind: Item["kind"], turnId: string, at: number): Item =>
  ({ id, kind, turnId, at, text: id }) as Item

/** 一轮：提问 → 回答 → 再提问 */
const ITEMS: readonly Item[] = [
  item("q1", "user_message", "t1", 0),
  item("a1", "agent_message", "t1", 5000),
  item("q2", "user_message", "t2", 6000),
  item("a2", "agent_message", "t2", 9000),
]

describe("折起一轮", () => {
  it("折起来之后**提问还在**——人是靠自己问过的话定位的", () => {
    const rows = groupRows(ITEMS)
    const folded = foldTurns(rows, new Set(["t1"]))
    const texts = folded.flatMap((r) => (r.kind === "item" ? [r.item.id] : []))
    expect(texts).toContain("q1")
    expect(texts).not.toContain("a1")
  })

  it("分界线自己留着——不然没有地方点开", () => {
    expect(foldTurns(groupRows(ITEMS), new Set(["t1"])).some((r) => r.kind === "turn")).toBe(true)
  })

  it("只折被点的那一轮，别的轮一条不少", () => {
    const folded = foldTurns(groupRows(ITEMS), new Set(["t1"]))
    expect(folded.flatMap((r) => (r.kind === "item" ? [r.item.id] : []))).toContain("a2")
  })

  it("没折任何一轮时原样返回", () => {
    const rows = groupRows(ITEMS)
    expect(foldTurns(rows, new Set())).toEqual(rows)
  })
})
