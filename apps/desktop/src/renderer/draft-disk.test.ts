import { describe, expect, it, vi } from "vitest"
import type { Thread } from "@switchback/protocol"
import type { StoredDraft } from "../shared/drafts.js"
import { createDraftDisk, draftSlot } from "./draft-disk.js"

vi.stubGlobal("window", { setTimeout, clearTimeout })

const draft = (text: string, at = 1): StoredDraft => ({ engine: "codex", text, attachments: [], blocks: [], aside: false, at })
const thread = (patch: Partial<Thread>): Thread => ({
  id: "th", title: "t", cwd: "/w", engine: "codex", trust: "auto-edit", status: "idle",
  createdAt: 0, updatedAt: 0, engineHistory: ["codex"], ...patch,
})

describe("草稿落在哪一格", () => {
  const cases = [
    { name: "正式的会话：按自己的 id", thread: thread({}), want: "th" },
    { name: "点「+」或启动时开的临时会话：共用「新会话」那一格", thread: thread({ provisional: true }), want: "new" },
    { name: "分叉、重来出来的临时会话：不落盘", thread: thread({ provisional: true, forkedFrom: "th-0" }), want: undefined },
    { name: "认不出是哪条：按 id", thread: undefined, want: "th" },
  ]
  for (const c of cases) it(c.name, () => expect(draftSlot(c.thread, "th")).toBe(c.want))
})

describe("盘上那一份", () => {
  it("内容没变不重交（时刻不算）；攒着的 flush 立刻交出去", () => {
    const sent: [string, StoredDraft | undefined][] = []
    const disk = createDraftDisk({ slotOf: (id) => id, send: (slot, d) => sent.push([slot, d]), delayMs: 10_000 })
    disk.save("th", draft("a", 1))
    disk.save("th", draft("a", 2))
    disk.save("gone", undefined)
    expect(sent).toEqual([])
    disk.flush()
    expect(sent).toEqual([["th", draft("a", 1)]])
    expect(disk.stored("th")).toEqual(draft("a", 1))
  })

  it("启动读回来的：内容一样的不再交；不在了的图只报一次", () => {
    const sent: string[] = []
    const disk = createDraftDisk({ slotOf: (id) => id, send: (slot) => sent.push(slot), delayMs: 10_000 })
    disk.hydrate({ drafts: { th: draft("a") }, missing: { th: 2 } })
    disk.save("th", draft("a", 9))
    disk.flush()
    expect(sent).toEqual([])
    expect(disk.takeMissing("th")).toBe(2)
    expect(disk.takeMissing("th")).toBeUndefined()
  })
})
