import { useCallback, useEffect, useState } from "react"
import type { ComposerDrafts } from "./composer-drafts.js"

/**
 * 要并进输入框的一段话。`lead` 为真时放在已有正文前面（「问一句」：引文在前，你的问题在后），
 * 否则接在后面。`at` 递增：连着点同一条两次，文本一样但它是新的一次要求。
 */
export interface Prefill {
  text: string
  attachments: readonly string[]
  at: number
  /** 填回去之后**顺手进侧问模式**（选中转录区一段话之后那颗「问一句」）。 */
  aside?: boolean
  lead?: boolean
}

/**
 * 输入框里要并进来的话。两个来源：
 *
 * - **宿主交回的草稿**：从待发队列取回、接不回时退回、「改一改再发」岔出来的新会话
 * - **`reuse`**：转录区里「改一改再发」、选中一段话之后「问一句」
 *
 * 宿主草稿**每一版只并一次**，记在 `drafts` 里而不是组件里：换会话时 `Workspace` 重挂，
 * 组件里的记号会归零，同一版就会再灌一遍，盖掉你改过的内容、还把侧栏的焦点抢走。
 * 并是接在已有正文后面（见 `use-composer-draft.ts` 的 `mergeDraft`），逐条取回几句都在。
 */
export function useHostDraft(
  threadId: string,
  host: { draft: string | undefined; attachments: readonly string[] | undefined; revision: string | undefined },
  drafts: ComposerDrafts,
): {
  prefill: Prefill
  reuse: (text: string, attachments?: readonly string[], aside?: boolean) => void
} {
  const [prefill, setPrefill] = useState<Prefill>({ text: "", attachments: [], at: 0 })
  const { draft, attachments, revision } = host
  useEffect(() => {
    if (draft === undefined) {
      drafts.markApplied(threadId)
      return
    }
    // 新宿主会给每次取回独立身份；旧记录没有身份时退回文本，保持向后兼容。
    // 不能只认文本：清空与再次取回同一句若被 React 合并，文字没变但它确实是新草稿。
    const identity = revision ?? `legacy:${draft}`
    if (drafts.applied(threadId) === identity) return
    drafts.markApplied(threadId, identity)
    setPrefill((prev) => ({ text: draft, attachments: attachments ?? [], at: prev.at + 1 }))
  }, [threadId, draft, attachments, revision, drafts])
  // **必须 useCallback**：它一路传到 `Transcript`，而那块是 memo 的。
  // 行内箭头每次渲染换身份，memo 立刻静默失效——和 `onResolve` 同一条理由
  const reuse = useCallback((text: string, paths: readonly string[] = [], aside = false) => {
    setPrefill((prev) => ({ text, attachments: paths, at: prev.at + 1, aside, lead: aside }))
  }, [])
  return { prefill, reuse }
}
