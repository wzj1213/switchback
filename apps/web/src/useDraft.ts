import { useEffect, useRef, useState } from "react"
import { localDrafts, readDraft, writeDraft } from "./drafts.js"

/** 一段话并进输入框里已有的正文：空着就是它本身，否则另起一行接在后面。 */
export function mergeText(current: string, incoming: string): string {
  if (incoming === "") return current
  if (current.trim() === "") return incoming
  return `${current.replace(/\s+$/, "")}\n${incoming}`
}

export interface DraftOptions {
  threadId: string
  /** 宿主交回输入框的草稿（取回、接不回时退回），带版本。 */
  host: { draft: string | undefined; revision: string | undefined }
  /** 发出去之后被远程上限挡下、还回来的那句（见 `Remote.returned`）。 */
  restore?: { id: number; text: string } | undefined
  onRestored?: ((id: number) => void) | undefined
}

/**
 * 输入框里的字。
 *
 * - 从这台手机上次留下的读起，每改一次存一次（见 `drafts.ts`）：切走再回来、刷新、锁屏被杀都还在
 * - 宿主交回的草稿**每一版只并一次**，并过哪一版和正文存在一起；并是接在后面，不盖掉正在写的字
 * - 被拒还回来的那句也并回来；这期间又打了字的，还回来的那句排在前面——它是先写的
 */
export function useDraft(options: DraftOptions): {
  text: string
  setText: (text: string) => void
  /** 并进来的那一版宿主草稿；发送时带上它，宿主据此消费掉（同桌面端）。 */
  applied: string | undefined
} {
  const { threadId, host, restore, onRestored } = options
  const [saved] = useState(() => readDraft(localDrafts(), threadId))
  const [text, setText] = useState(saved?.text ?? "")
  const applied = useRef(saved?.applied)

  useEffect(() => {
    if (host.draft === undefined) {
      applied.current = undefined
      return
    }
    const identity = host.revision ?? `legacy:${host.draft}`
    if (applied.current === identity) return
    applied.current = identity
    const incoming = host.draft
    setText((current) => mergeText(current, incoming))
  }, [host.draft, host.revision])

  useEffect(() => {
    if (restore === undefined) return
    setText((current) => (current.trim() === "" ? restore.text : `${restore.text}\n${current}`))
    onRestored?.(restore.id)
  }, [restore, onRestored])

  // 字变了、并过的版本变了都存一次。存的是 localStorage：同步、量小，不必攒
  useEffect(() => {
    writeDraft(localDrafts(), threadId, { text, applied: applied.current }, Date.now())
  }, [threadId, text, host.draft, host.revision])

  return { text, setText, applied: applied.current }
}
