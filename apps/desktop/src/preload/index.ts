import { contextBridge, ipcRenderer } from "electron"
import type { Command, Event } from "@omni/protocol"

/**
 * 渲染层与主进程之间**唯一**的通道：
 *   send(Command)  —— 渲染层请求做事
 *   subscribe(cb)  —— 主进程推事件
 *   pickFolder()   —— 借主进程弹一次系统目录选择框
 *   onMenu(cb)     —— 菜单里那些只有渲染层做得到的动作
 *   find/stopFind  —— 借 Chromium 原生的页内查找
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
  async find(request: { query: string; next?: boolean; forward?: boolean }): Promise<{
    active: number
    total: number
  }> {
    return (await ipcRenderer.invoke("omni:find", request)) as { active: number; total: number }
  },
  stopFind(): void {
    ipcRenderer.send("omni:stopFind")
  },
  copy(text: string): void {
    ipcRenderer.send("omni:copy", text)
  },
  /** 只在开发钩子下用：把查找词直接塞进查找条，见 main/devtools.ts */
  onDevFind(handler: (query: string) => void): () => void {
    const listener = (_e: unknown, query: string): void => {
      handler(query)
    }
    ipcRenderer.on("omni:devFind", listener)
    return () => {
      ipcRenderer.off("omni:devFind", listener)
    }
  },
  onMenu(handler: (action: string) => void): () => void {
    const listener = (_e: unknown, action: string): void => {
      handler(action)
    }
    ipcRenderer.on("omni:menu", listener)
    return () => {
      ipcRenderer.off("omni:menu", listener)
    }
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
