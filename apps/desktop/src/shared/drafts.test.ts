import { describe, expect, it } from "vitest"
import { MAX_DRAFTS, parseDrafts, pruneDrafts, type StoredDraft } from "./drafts.js"

const one = (patch: Partial<StoredDraft> = {}): StoredDraft => ({
  engine: "codex", text: "写到一半", attachments: [], blocks: [], aside: false, at: 1, ...patch,
})

describe("盘上的草稿逐条核", () => {
  const cases: readonly { name: string; raw: unknown; want: Record<string, unknown> }[] = [
    { name: "不是对象：当没有", raw: [1, 2], want: {} },
    { name: "好的一条原样留", raw: { a: one() }, want: { a: one() } },
    { name: "坏的那条丢掉，别的照留", raw: { a: one(), b: { text: 3 } }, want: { a: one() } },
    { name: "空草稿不留", raw: { a: one({ text: "" }) }, want: {} },
    { name: "只记着并过哪一版也留：不然重启后删掉的字又回来", raw: { a: one({ text: "", applied: "dr-1" }) }, want: { a: one({ text: "", applied: "dr-1" }) } },
    {
      name: "芯片逐个核：认不出的那个丢掉",
      raw: { a: one({ blocks: [{ id: "1", kind: "file", path: "/w/a.ts" }, { id: "2", kind: "paste" }] as never }) },
      want: { a: one({ blocks: [{ id: "1", kind: "file", path: "/w/a.ts" }] }) },
    },
    { name: "附件只认字符串", raw: { a: one({ attachments: ["/x.png", 7] as never }) }, want: { a: one({ attachments: ["/x.png"] }) } },
    { name: "认不出的命令丢掉，草稿照留", raw: { a: one({ command: { name: 1 } as never }) }, want: { a: one() } },
  ]
  for (const c of cases) {
    it(c.name, () => expect(parseDrafts(c.raw)).toEqual(c.want))
  }

  it("`__proto__` 当普通键，不改原型", () => {
    const parsed = parseDrafts(JSON.parse('{"__proto__": {"engine":"x","text":"t","at":1}}'))
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
  })

  it("只留最近的那些", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_DRAFTS + 3 }, (_, i) => [`t${String(i)}`, one({ at: i })]))
    const kept = pruneDrafts(many)
    expect(Object.keys(kept)).toHaveLength(MAX_DRAFTS)
    expect(kept["t0"]).toBeUndefined()
    expect(kept[`t${String(MAX_DRAFTS + 2)}`]).toBeDefined()
  })
})
