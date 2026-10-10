import type { Event, ThreadId } from "@switchback/protocol"
import type { AttachmentFiles } from "./attachment-files.js"
import type { ThreadTrust } from "./thread-trust.js"
import type { TouchedFiles } from "./touched.js"
import type { WorksiteSearch } from "./worksite-search.js"

/** 事件出口上记的几本账。挂在**唯一那个出口**上，不是各个驱动里——漏一处就是某类会话的账对不上。 */
export interface Ledgers {
  touched: TouchedFiles
  attachmentFiles: AttachmentFiles
  worksiteSearch: WorksiteSearch
  /** 每条会话开在哪一档（远程策略要查，见 `thread-trust.ts`）。 */
  trust: ThreadTrust
  /** 没发出去的草稿：会话删了它的那份一起删。 */
  drafts?: { forget: (threadId: ThreadId) => void } | undefined
}

/** 每条事件都先进名册再广播：预览工作区外的文件凭它放行（见 `touched.ts`）。 */
export function noting(ledgers: Ledgers, publish: (event: Event) => void): (event: Event) => void {
  return (event) => {
    ledgers.touched.note(event)
    ledgers.attachmentFiles.note(event)
    ledgers.worksiteSearch.note(event)
    ledgers.trust.note(event)
    if (event.type === "thread.removed") {
      void ledgers.attachmentFiles.removeThread(event.threadId)
      ledgers.drafts?.forget(event.threadId)
    }
    publish(event)
  }
}
