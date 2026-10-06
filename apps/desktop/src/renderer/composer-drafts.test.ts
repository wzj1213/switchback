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
