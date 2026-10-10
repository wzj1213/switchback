import type { Thread } from "@switchback/protocol"

export interface QueuedPrompt {
  text: string
  attachments?: readonly string[]
}

export function queuedTexts(queued: readonly QueuedPrompt[]): string[] {
  return queued.map((prompt) => prompt.text)
}

/** 把宿主的完整队列投影到协议 Thread；附件与文字始终按下标对齐。 */
export function withQueue(thread: Thread, queued: readonly QueuedPrompt[], updatedAt = thread.updatedAt): Thread {
  const next = { ...thread }
  delete next.queuedAttachments
  const attachments = queued.map((prompt) => [...(prompt.attachments ?? [])])
  return {
    ...next,
    queued: queuedTexts(queued),
    ...(attachments.some((paths) => paths.length > 0) ? { queuedAttachments: attachments } : {}),
    updatedAt,
  }
}

/** 交回之后的那份记录：队列只剩 `rest`，草稿换成取回的几句和它们的附件，换一个新身份。 */
export function handedBack(
  thread: Thread,
  picked: { rest: readonly QueuedPrompt[]; taken: readonly QueuedPrompt[] },
  revision: string,
  at: number,
): Thread {
  const attachments = [...new Set(picked.taken.flatMap((prompt) => prompt.attachments ?? []))]
  const next = {
    ...withQueue(thread, picked.rest, at),
    draft: picked.taken.map((prompt) => prompt.text).join("\n"),
    draftRevision: revision,
  }
  delete next.draftAttachments
  if (attachments.length > 0) next.draftAttachments = attachments
  return next
}

export function promptsOf(thread: Thread): QueuedPrompt[] {
  return (thread.queued ?? []).map((text, index) => {
    const attachments = thread.queuedAttachments?.[index]
    return {
      text,
      ...(attachments === undefined || attachments.length === 0 ? {} : { attachments }),
    }
  })
}
