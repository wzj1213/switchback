import type { PreviewTarget } from "./workbench.js"

const EVENT = "omni:preview-file"

/** 工具行不穿透整条 memo props 链，只发一个纯视图请求给外壳。 */
export function requestFilePreview(threadId: string, cwd: string, path: string,
  location: Pick<PreviewTarget, "line" | "column" | "fragment"> = {}): void {
  if (threadId === "" || cwd === "" || path.trim() === "" || typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<PreviewTarget>(EVENT, { detail: { ...location, threadId, cwd, path } }))
}

export function onFilePreviewRequest(pick: (target: PreviewTarget) => void): () => void {
  const receive = (event: Event): void => {
    const detail = (event as CustomEvent<PreviewTarget | undefined>).detail
    if (detail === undefined || detail.threadId === "" || detail.cwd === "" || detail.path.trim() === "") return
    pick(detail)
  }
  window.addEventListener(EVENT, receive)
  return () => {
    window.removeEventListener(EVENT, receive)
  }
}
