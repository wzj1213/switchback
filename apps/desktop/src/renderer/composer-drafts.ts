import type { EngineId, SlashCommand } from "@switchback/protocol"
import { applyCommand } from "./slash.js"
import type { DraftBlock } from "./composer-blocks.js"

export interface ComposerDraftMemory {
  engine: EngineId
  text: string
  attachments: readonly string[]
  /**
   * 输入框上方那排芯片（拖进来的文件、折起来的粘贴）。
   * **必须跟着草稿一起记**：不记的话切走一条会话再回来，正文还在、
   * 附上的东西没了——而那正是这一版把它们从正文里挪出来换到的代价。
   */
  blocks: readonly DraftBlock[]
  command?: SlashCommand
  aside: boolean
}

export interface ComposerDrafts {
  read: (threadId: string) => ComposerDraftMemory | undefined
  write: (threadId: string, draft: ComposerDraftMemory) => void
  /**
   * 宿主交回输入框的草稿（取回、接回失败退回、改一改再发），这个窗口已经并进输入框的是哪一版。
   *
   * 不记在组件里：换会话时 `Workspace` 按 thread id 重挂，组件里的记号跟着归零，
   * 同一版草稿就会再灌一遍，盖掉你在输入框里改过的内容（见 `use-host-draft.ts`）。
   */
  applied: (threadId: string) => string | undefined
  /** 不给就是忘掉：宿主草稿随发送消费掉之后，下一份从头算。 */
  markApplied: (threadId: string, identity?: string) => void
}

const MAX_DRAFTS = 40

function empty(draft: ComposerDraftMemory): boolean {
  return draft.text === "" && draft.attachments.length === 0 && draft.blocks.length === 0 &&
    draft.command === undefined && !draft.aside
}

function copy(draft: ComposerDraftMemory): ComposerDraftMemory {
  return { ...draft, attachments: [...draft.attachments], blocks: [...draft.blocks] }
}

export function createComposerDrafts(limit = MAX_DRAFTS): ComposerDrafts {
  const drafts = new Map<string, ComposerDraftMemory>()
  const applied = new Map<string, string>()
  return {
    applied: (threadId) => applied.get(threadId),
    markApplied: (threadId, identity) => {
      applied.delete(threadId)
      if (identity === undefined) return
      applied.set(threadId, identity)
      const oldest = applied.size > limit ? applied.keys().next() : undefined
      if (oldest !== undefined && oldest.done !== true) applied.delete(oldest.value)
    },
    read: (threadId) => {
      const draft = drafts.get(threadId)
      if (draft === undefined) return undefined
      drafts.delete(threadId)
      drafts.set(threadId, draft)
      return copy(draft)
    },
    write: (threadId, draft) => {
      drafts.delete(threadId)
      if (empty(draft)) return
      drafts.set(threadId, copy(draft))
      if (drafts.size <= limit) return
      const oldest = drafts.keys().next()
      if (!oldest.done) drafts.delete(oldest.value)
    },
  }
}

export function recallComposerDraft(
  drafts: ComposerDrafts,
  threadId: string,
  engine: EngineId,
): Omit<ComposerDraftMemory, "engine"> | undefined {
  const saved = drafts.read(threadId)
  if (saved === undefined || saved.command === undefined || saved.engine === engine) return saved
  return {
    text: `${applyCommand(saved.command).text}${saved.text}`,
    attachments: saved.attachments,
    blocks: saved.blocks,
    aside: saved.aside,
  }
}
