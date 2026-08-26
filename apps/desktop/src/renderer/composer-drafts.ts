import type { EngineId, SlashCommand } from "@omni/protocol"
import { applyCommand } from "./slash.js"

export interface ComposerDraftMemory {
  engine: EngineId
  text: string
  attachments: readonly string[]
  command?: SlashCommand
  aside: boolean
}

export interface ComposerDrafts {
  read: (threadId: string) => ComposerDraftMemory | undefined
  write: (threadId: string, draft: ComposerDraftMemory) => void
}

const MAX_DRAFTS = 40

function empty(draft: ComposerDraftMemory): boolean {
  return draft.text === "" && draft.attachments.length === 0 && draft.command === undefined && !draft.aside
}

function copy(draft: ComposerDraftMemory): ComposerDraftMemory {
  return { ...draft, attachments: [...draft.attachments] }
}

export function createComposerDrafts(limit = MAX_DRAFTS): ComposerDrafts {
  const drafts = new Map<string, ComposerDraftMemory>()
  return {
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
    aside: saved.aside,
  }
}
