import { contextBridge, ipcRenderer } from "electron"
import type { Command, Event } from "@omni/protocol"

/**
 * 渲染层与主进程之间**唯一**的通道，故意只有两个方向：
 *   send(Command)  —— 渲染层请求做事
 *   subscribe(cb)  —— 主进程推事件
 *
 * 不暴露 fs、不暴露 child_process、不暴露 ipcRenderer 本体。
 * 渲染层新增能力必须先在 Command 联合里加一项，改不了这条边界。
 */
const api = {
  send(command: Command): void {
    ipcRenderer.send("omni:command", command)
  },
  subscribe(onEvent: (event: Event) => void): () => void {
    const listener = (_e: unknown, event: Event): void => {
      onEvent(event)
    }
    ipcRenderer.on("omni:event", listener)
    return () => {
      ipcRenderer.off("omni:event", listener)
    }
  },
}

export type OmniBridge = typeof api

contextBridge.exposeInMainWorld("omni", api)
