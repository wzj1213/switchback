import type { EngineId, SlashCommand } from "@switchback/protocol"
import { blankDraft, MAX_DRAFTS, type StoredDraft } from "../shared/drafts.js"
import { applyCommand } from "./slash.js"
import type { DraftBlock } from "./composer-blocks.js"
import type { DraftSink } from "./draft-disk.js"

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
  /** 上次留下的草稿里有几张图已经不在了（重启后读盘时核的）。只报一次。 */
  missing: (threadId: string) => number | undefined
}


function empty(draft: ComposerDraftMemory): boolean {
  return draft.text === "" && draft.attachments.length === 0 && draft.blocks.length === 0 &&
    draft.command === undefined && !draft.aside
}

function copy(draft: ComposerDraftMemory): ComposerDraftMemory {
  return { ...draft, attachments: [...draft.attachments], blocks: [...draft.blocks] }
}

/** 落盘的那一份：正文、附件、芯片、命令、侧问，外加并过的宿主草稿版本。什么都没有就是删。 */
function toStored(draft: ComposerDraftMemory | undefined, applied: string | undefined): StoredDraft | undefined {
  const content = draft === undefined ? { text: "", attachments: [], blocks: [], aside: false } : draft
  const stored = { ...copy({ engine: "", ...content }), ...(applied === undefined ? {} : { applied }), at: Date.now() }
  return blankDraft(stored) ? undefined : stored
}

function fromStored(stored: StoredDraft): ComposerDraftMemory {
  return {
    engine: stored.engine, text: stored.text, attachments: [...stored.attachments], blocks: [...stored.blocks],
    aside: stored.aside, ...(stored.command === undefined ? {} : { command: stored.command }),
  }
}

/**
 * 按会话的输入框草稿。内存里一份（切会话立刻能读回来），盘上一份（重启还在，见 `draft-disk.ts`）；
 * 不给 `sink` 就只在内存里（测试、没有桥的预览）。
 */
export function createComposerDrafts(limit = MAX_DRAFTS, sink?: DraftSink): ComposerDrafts {
  const drafts = new Map<string, ComposerDraftMemory>()
  const applied = new Map<string, string>()
  const slot = (threadId: string): string | undefined => sink?.slotOf(threadId)
  const disk = (threadId: string): StoredDraft | undefined => {
    const where = slot(threadId)
    return where === undefined ? undefined : sink?.stored(where)
  }
  const persist = (threadId: string): void => {
    const where = slot(threadId)
    if (where !== undefined) sink?.save(where, toStored(drafts.get(threadId), applied.get(threadId)))
  }
  return {
    applied: (threadId) => applied.get(threadId) ?? disk(threadId)?.applied,
    markApplied: (threadId, identity) => {
      applied.delete(threadId)
      if (identity !== undefined) applied.set(threadId, identity)
      const oldest = applied.size > limit ? applied.keys().next() : undefined
      if (oldest !== undefined && oldest.done !== true) applied.delete(oldest.value)
      persist(threadId)
    },
    read: (threadId) => {
      const saved = disk(threadId)
      const draft = drafts.get(threadId) ?? (saved === undefined ? undefined : fromStored(saved))
      if (draft === undefined) return undefined
      drafts.delete(threadId)
      drafts.set(threadId, draft)
      if (saved?.applied !== undefined && !applied.has(threadId)) applied.set(threadId, saved.applied)
      return copy(draft)
    },
    write: (threadId, draft) => {
      drafts.delete(threadId)
      if (!empty(draft)) drafts.set(threadId, copy(draft))
      const oldest = drafts.size > limit ? drafts.keys().next() : undefined
      if (oldest !== undefined && oldest.done !== true) drafts.delete(oldest.value)
      persist(threadId)
    },
    missing: (threadId) => {
      const where = slot(threadId)
      return where === undefined ? undefined : sink?.takeMissing(where)
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
