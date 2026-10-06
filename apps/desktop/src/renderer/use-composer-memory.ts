import { useEffect, useState } from "react"
import type { EngineId, SlashCommand } from "@switchback/protocol"
import { recallComposerDraft, type ComposerDrafts } from "./composer-drafts.js"
import { useAsideMode } from "./use-aside-mode.js"
import { useAttachments } from "./useAttachments.js"
import { useDraftBlocks, type DraftBlocks } from "./use-draft-blocks.js"
import type { DraftBlock } from "./composer-blocks.js"

/** 侧问只收文字；此时新图片走用户可见的路径引用，不能先收下再锁死发送。 */
export function imageAttachmentsEnabled(canAttach: boolean, aside: boolean): boolean {
  return canAttach && !aside
}

export function useComposerMemory(options: {
  drafts: ComposerDrafts
  threadId: string
  engine: EngineId
  canAttach: boolean
  canAside: boolean
  prefill?: { aside?: boolean; at: number }
  onAsk: ((text: string) => void) | undefined
}): {
  initial: ReturnType<typeof recallComposerDraft>
  attach: ReturnType<typeof useAttachments>
  /** 输入框上方那排芯片：拖进来的文件、折起来的粘贴。 */
  blocks: DraftBlocks
  aside: ReturnType<typeof useAsideMode>
  imageAttachments: boolean
} {
  const [initial] = useState(() => recallComposerDraft(options.drafts, options.threadId, options.engine))
  const aside = useAsideMode({
    can: options.canAside,
    prefill: options.prefill,
    onAsk: options.onAsk,
    initial: initial?.aside,
  })
  const imageAttachments = imageAttachmentsEnabled(options.canAttach, aside.on)
  const attach = useAttachments(imageAttachments, initial?.attachments)
  const blocks = useDraftBlocks(initial?.blocks)
  return { initial, attach, blocks, aside, imageAttachments }
}

export function useRememberComposer(options: {
  drafts: ComposerDrafts
  threadId: string
  engine: EngineId
  text: string
  attachments: readonly string[]
  blocks: readonly DraftBlock[]
  command: SlashCommand | undefined
  aside: boolean
}): void {
  const { drafts, threadId, engine, text, attachments, blocks, command, aside } = options
  useEffect(() => {
    drafts.write(threadId, {
      engine,
      text,
      attachments,
      blocks,
      ...(command === undefined ? {} : { command }),
      aside,
    })
  }, [aside, attachments, blocks, command, drafts, engine, text, threadId])
}
