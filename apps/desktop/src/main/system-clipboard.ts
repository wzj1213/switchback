import { clipboard, ipcMain } from "electron"
import type { Logger } from "./log.js"

interface ClipboardWriter {
  writeText: (text: string) => void
}

/** 只在系统剪贴板真正接住字符串后回成功，异常和畸形 IPC 一律显式失败。 */
export function writeClipboard(writer: ClipboardWriter, text: unknown): boolean {
  if (typeof text !== "string") return false
  try {
    writer.writeText(text)
    return true
  } catch {
    return false
  }
}

export function installClipboardChannel(log: Logger): void {
  ipcMain.handle("omni:copy", (_event, text: unknown) => {
    const copied = writeClipboard(clipboard, text)
    if (!copied) log.write("warn", "ipc", "系统剪贴板写入失败")
    return copied
  })
}
