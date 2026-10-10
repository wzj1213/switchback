import { describe, expect, it } from "vitest"
import type { SlashCommand } from "@switchback/protocol"
import { createComposerDrafts, recallComposerDraft, type ComposerDraftMemory } from "./composer-drafts.js"

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
