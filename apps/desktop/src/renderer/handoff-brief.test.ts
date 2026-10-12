import { describe, expect, it } from "vitest"
import type { UserMessageItem } from "@switchback/protocol"
import type { Row } from "./group.js"
import { withHandoffBriefs } from "./handoff-brief.js"

const stint = { engine: "kimi", at: 10 } as Extract<Row, { kind: "engine" }>["stint"]
const engine: Row = { kind: "engine", stint }
const msg = (id: string, origin?: "handoff"): Row => ({
  kind: "item",
  item: { kind: "user_message", id, turnId: "t", at: 10, text: id, ...(origin ? { origin } : {}) } as UserMessageItem,
})

const cases: { name: string; rows: Row[]; want: string[] }[] = [
  { name: "分界线后紧跟说明：收进分界线", rows: [engine, msg("b", "handoff"), msg("q")], want: ["engine+b", "q"] },
  { name: "说明在分界线前：同样收", rows: [msg("b", "handoff"), engine, msg("q")], want: ["engine+b", "q"] },
  { name: "隔着别的行：不收", rows: [engine, msg("q"), msg("b", "handoff")], want: ["engine", "q", "b"] },
  { name: "没有分界线：照常一条消息", rows: [msg("b", "handoff"), msg("q")], want: ["b", "q"] },
  { name: "一条分界线只收一条说明", rows: [engine, msg("b", "handoff"), msg("c", "handoff")], want: ["engine+b", "c"] },
]

const shape = (row: Row): string =>
  row.kind === "engine"
    ? row.brief === undefined
      ? "engine"
      : `engine+${row.brief.id}`
    : row.kind === "item"
      ? row.item.id
      : row.kind

describe("withHandoffBriefs", () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(withHandoffBriefs(c.rows).map(shape)).toEqual(c.want)
    })
  }
})
