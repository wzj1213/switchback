import { ipcRenderer } from "electron"
import type { LoadedDrafts, StoredDraft } from "../shared/drafts.js"

/** 输入框里没发出去的话。主进程存在数据目录的 `drafts.json`（见 `main/drafts.ts`）。 */
export const draftsBridge = {
  /** 存着的全部；启动读盘时发现已经不在了的附件数只报一次。 */
  async loadDrafts(): Promise<LoadedDrafts> {
    return (await ipcRenderer.invoke("switchback:drafts/load")) as LoadedDrafts
  },
  /** 存一份；不给就是删。主进程再攒一会儿才落盘。 */
  saveDraft(key: string, draft: StoredDraft | undefined): void {
    ipcRenderer.send("switchback:drafts/save", { key, draft })
  },
}
