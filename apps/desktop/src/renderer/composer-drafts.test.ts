import { describe, expect, it } from "vitest"
import type { SlashCommand } from "@switchback/protocol"
import { createComposerDrafts, recallComposerDraft, type ComposerDraftMemory } from "./composer-drafts.js"
import type { DraftSink } from "./draft-disk.js"
import type { StoredDraft } from "../shared/drafts.js"

const command: SlashCommand = { name: "review", description: "审查", source: "engine" }
const draft = (text: string, engine = "claude"): ComposerDraftMemory => ({
  engine,
  text,
  attachments: [`/${text}.png`],
  blocks: [{ id: "b1", kind: "file", path: `${text}.ts` }],
  command,
  aside: true,
})

describe("按会话保留输入草稿", () => {
  it("文字、图片、命令与侧问模式互不串会话，读写都复制附件数组", () => {
    const drafts = createComposerDrafts()
    const one = draft("a")
    drafts.write("th-a", one)
    drafts.write("th-b", draft("b"))
    expect(drafts.read("th-a")).toEqual(one)
    expect(drafts.read("th-b")).toEqual(draft("b"))
    expect(drafts.read("th-a")?.attachments).not.toBe(one.attachments)
    // 芯片同样要各存各的：共用一个数组的话，一条会话里移除一枚会在另一条也少一枚
    expect(drafts.read("th-a")?.blocks).not.toBe(one.blocks)
  })

  it("发送后写入空草稿会删除旧值", () => {
    const drafts = createComposerDrafts()
    drafts.write("th", draft("old"))
    drafts.write("th", { engine: "claude", text: "", attachments: [], blocks: [], aside: false })
    expect(drafts.read("th")).toBeUndefined()
  })

  it("超过上限淘汰最久没看过的；读取会把会话提到最近", () => {
    const drafts = createComposerDrafts(2)
    drafts.write("old", draft("old"))
    drafts.write("keep", draft("keep"))
    drafts.read("old")
    drafts.write("new", draft("new"))
    expect(drafts.read("keep")).toBeUndefined()
    expect(drafts.read("old")?.text).toBe("old")
  })

  it("回来时引擎已变，旧命令退成可编辑原文，图片、芯片与模式保留", () => {
    const drafts = createComposerDrafts()
    drafts.write("th", draft("src/", "claude"))
    expect(recallComposerDraft(drafts, "th", "codex")).toEqual({
      text: "/review src/",
      attachments: ["/src/.png"],
      // 芯片不跟着命令退：它们是「附上的东西」，和这条命令属于哪家引擎无关
      blocks: [{ id: "b1", kind: "file", path: "src/.ts" }],
      aside: true,
    })
  })
})

describe("宿主交回的草稿每一版只并一次", () => {
  it("记的是并过哪一版，按会话分开；不给版本就是忘掉", () => {
    const drafts = createComposerDrafts()
    drafts.markApplied("th-a", "dr-1")
    drafts.markApplied("th-b", "dr-9")
    expect(drafts.applied("th-a")).toBe("dr-1")
    expect(drafts.applied("th-b")).toBe("dr-9")
    drafts.markApplied("th-a")
    expect(drafts.applied("th-a")).toBeUndefined()
  })

  it("空草稿照样记得并过——清空输入框不等于要再灌一遍", () => {
    const drafts = createComposerDrafts()
    drafts.markApplied("th", "dr-1")
    drafts.write("th", { engine: "claude", text: "", attachments: [], blocks: [], aside: false })
    expect(drafts.applied("th")).toBe("dr-1")
  })

  it("记不了无限多：超过上限先忘最早的那条", () => {
    const drafts = createComposerDrafts(2)
    drafts.markApplied("th-1", "a")
    drafts.markApplied("th-2", "b")
    drafts.markApplied("th-3", "c")
    expect([drafts.applied("th-1"), drafts.applied("th-2"), drafts.applied("th-3")]).toEqual([undefined, "b", "c"])
  })
})

describe("草稿落盘（交给 sink）", () => {
  const stored = (text: string, patch: Partial<StoredDraft> = {}): StoredDraft => ({
    engine: "claude", text, attachments: [], blocks: [], aside: false, at: 1, ...patch,
  })
  function sinkOf(slots: Readonly<Record<string, string | undefined>>, initial: Record<string, StoredDraft> = {}) {
    const store = new Map(Object.entries(initial))
    const saves: (readonly [string, string | undefined])[] = []
    const sink: DraftSink = {
      slotOf: (id) => (id in slots ? slots[id] : id),
      stored: (slot) => store.get(slot),
      save: (slot, draft) => {
        saves.push([slot, draft?.text])
        if (draft === undefined) store.delete(slot)
        else store.set(slot, draft)
      },
      takeMissing: () => undefined,
    }
    return { sink, store, saves }
  }

  it("写一份交给它那一格；发出去写空就是删", () => {
    const { sink, store } = sinkOf({})
    const drafts = createComposerDrafts(40, sink)
    drafts.write("th", draft("写到一半"))
    expect(store.get("th")).toMatchObject({ text: "写到一半", attachments: ["/写到一半.png"] })
    drafts.write("th", { engine: "claude", text: "", attachments: [], blocks: [], aside: false })
    expect(store.has("th")).toBe(false)
  })

  it("重启后内存里没有：读盘上那一份，并过的宿主草稿版本跟着回来，不再并一遍", () => {
    const { sink } = sinkOf({}, { th: stored("取回的那句", { applied: "dr-1" }) })
    const drafts = createComposerDrafts(40, sink)
    expect(drafts.applied("th")).toBe("dr-1")
    expect(drafts.read("th")).toMatchObject({ text: "取回的那句" })
  })

  it("并过一版宿主草稿、字又删光了：也要记下来，不然重启后删掉的字又回来", () => {
    const { sink, store } = sinkOf({})
    const drafts = createComposerDrafts(40, sink)
    drafts.markApplied("th", "dr-2")
    expect(store.get("th")).toMatchObject({ text: "", applied: "dr-2" })
  })

  it("临时会话写进「新会话」那一格；重启后新开的那条读得回来", () => {
    const before = sinkOf({ "th-old": "new" })
    createComposerDrafts(40, before.sink).write("th-old", draft("新会话里打的"))
    const after = sinkOf({ "th-new": "new" }, Object.fromEntries(before.store))
    expect(createComposerDrafts(40, after.sink).read("th-new")).toMatchObject({ text: "新会话里打的" })
  })

  it("分叉出来的临时会话不落盘", () => {
    const { sink, saves } = sinkOf({ "th-fork": undefined })
    const drafts = createComposerDrafts(40, sink)
    drafts.write("th-fork", draft("分叉里打的"))
    expect(saves).toEqual([])
    expect(drafts.read("th-fork")).toMatchObject({ text: "分叉里打的" })
  })
})
