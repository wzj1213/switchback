import { ipcRenderer } from "electron"

/** 只订阅一份已经通过主进程预览边界核验的文件；回调不携带路径或内容。 */
export function watchFile(
  threadId: string,
  cwd: string,
  path: string,
  changed: () => void,
): () => void {
  const id = globalThis.crypto.randomUUID()
  const listener = (_event: unknown, changedId: unknown): void => {
    if (changedId === id) changed()
  }
  ipcRenderer.on("omni:fileChanged", listener)
  ipcRenderer.send("omni:watchFile", { id, threadId, cwd, path })
  return () => {
    ipcRenderer.off("omni:fileChanged", listener)
    ipcRenderer.send("omni:unwatchFile", id)
  }
}
