import { contextBridge, ipcRenderer } from "electron"
import type { Command, Event } from "@omni/protocol"

/**
 * 渲染层与主进程之间**唯一**的通道：
 *   send(Command)  —— 渲染层请求做事
 *   subscribe(cb)  —— 主进程推事件
 *   pickFolder()   —— 借主进程弹一次系统目录选择框
 *
 * 不暴露 fs、不暴露 child_process、不暴露 ipcRenderer 本体。
 * 渲染层新增能力必须先在 Command 联合里加一项，或者像 `pickFolder` 这样
 * 加一个**窄到只能做一件事**的方法——它只回一个用户亲手选的路径，
 * 渲染层拿不到任何遍历文件系统的能力。
 */
const api = {
  send(command: Command): void {
    ipcRenderer.send("omni:command", command)
  },
  /** 用户取消时返回 undefined。 */
  async pickFolder(): Promise<string | undefined> {
    return (await ipcRenderer.invoke("omni:pickFolder")) as string | undefined
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
