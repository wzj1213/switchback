import { useEffect, useMemo, useRef, useState } from "react"
import type { Thread } from "@switchback/protocol"
import { MAX_DRAFTS } from "../shared/drafts.js"
import { createComposerDrafts, type ComposerDrafts } from "./composer-drafts.js"
import { createDraftDisk, draftSlot } from "./draft-disk.js"

/**
 * 输入框草稿的存放处：内存一份，主进程盘上一份（见 `main/drafts.ts`）。
 *
 * **读回来之前不挂输入框**（`hydrated`）：输入框只在挂上的那一刻读一次草稿，
 * 晚到的那一份不会再进去。读本机一个小文件只要几毫秒，界面这时本来也还在等全量。
 */
export function useDraftStore(threads: readonly Thread[]): { drafts: ComposerDrafts; hydrated: boolean } {
  const latest = useRef(threads)
  latest.current = threads
  const disk = useMemo(() => {
    const bridge = typeof window === "undefined" ? undefined : window.switchback
    return createDraftDisk({
      slotOf: (threadId) => draftSlot(latest.current.find((thread) => thread.id === threadId), threadId),
      send: (slot, draft) => {
        bridge?.saveDraft(slot, draft)
      },
    })
  }, [])
  const drafts = useMemo(() => createComposerDrafts(MAX_DRAFTS, disk), [disk])
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.switchback
    if (bridge === undefined) {
      setHydrated(true)
      return undefined
    }
    void bridge.loadDrafts().then(disk.hydrate, () => undefined).finally(() => {
      setHydrated(true)
    })
    // 窗口关掉、页面重载前把攒着的交出去
    const flush = (): void => {
      disk.flush()
    }
    window.addEventListener("beforeunload", flush)
    return () => {
      window.removeEventListener("beforeunload", flush)
    }
  }, [disk])
  return { drafts, hydrated }
}
