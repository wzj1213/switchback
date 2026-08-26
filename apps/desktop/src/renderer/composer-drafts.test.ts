import { describe, expect, it } from "vitest"
import type { SlashCommand } from "@omni/protocol"
import { createComposerDrafts, recallComposerDraft, type ComposerDraftMemory } from "./composer-drafts.js"

const command: SlashCommand = { name: "review", description: "审查", source: "engine" }
const draft = (text: string, engine = "claude"): ComposerDraftMemory => ({
  engine,
  text,
  attachments: [`/${text}.png`],
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
  })

  it("发送后写入空草稿会删除旧值", () => {
    const drafts = createComposerDrafts()
    drafts.write("th", draft("old"))
    drafts.write("th", { engine: "claude", text: "", attachments: [], aside: false })
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

  it("回来时引擎已变，旧命令退成可编辑原文，图片与模式保留", () => {
    const drafts = createComposerDrafts()
    drafts.write("th", draft("src/", "claude"))
    expect(recallComposerDraft(drafts, "th", "codex")).toEqual({
      text: "/review src/",
      attachments: ["/src/.png"],
      aside: true,
    })
  })
})
