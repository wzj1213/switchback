import { useEffect, useState } from "react"
import type { EngineId, SlashCommand } from "@omni/protocol"
import { recallComposerDraft, type ComposerDrafts } from "./composer-drafts.js"
import { useAsideMode } from "./use-aside-mode.js"
import { useAttachments } from "./useAttachments.js"

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
  return { initial, attach, aside, imageAttachments }
}

export function useRememberComposer(options: {
  drafts: ComposerDrafts
  threadId: string
  engine: EngineId
  text: string
  attachments: readonly string[]
  command: SlashCommand | undefined
  aside: boolean
}): void {
  const { drafts, threadId, engine, text, attachments, command, aside } = options
  useEffect(() => {
    drafts.write(threadId, {
      engine,
      text,
      attachments,
      ...(command === undefined ? {} : { command }),
      aside,
    })
  }, [aside, attachments, command, drafts, engine, text, threadId])
}
