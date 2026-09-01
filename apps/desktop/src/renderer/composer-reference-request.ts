const EVENT = "omni:composer-reference"

interface Detail {
  threadId: string
  path: string
}

/**
 * 「把这条路径填进输入框」的一次请求。
 *
 * 走窗口事件而不是穿一条 props 链：**发起点分散**（斜杠命令在 `Workspace` 里、
 * 快捷键在 `App` 那层的菜单接线里），而接收点只有一个（`ThreadScreen` 持有
 * 那份 `composerReference`）。同一个理由、同一套写法见 `file-preview-request.ts`。
 */
export function requestComposerReference(threadId: string, path: string): void {
  if (threadId === "" || path.trim() === "" || typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<Detail>(EVENT, { detail: { threadId, path } }))
}

export function onComposerReference(take: (detail: Detail) => void): () => void {
  const receive = (event: Event): void => {
    const detail = (event as CustomEvent<Detail | undefined>).detail
    if (detail === undefined || detail.threadId === "" || detail.path.trim() === "") return
    take(detail)
  }
  window.addEventListener(EVENT, receive)
  return () => {
    window.removeEventListener(EVENT, receive)
  }
}
