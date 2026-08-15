import { contextBridge, ipcRenderer } from "electron"
import type { Command, Event } from "@omni/protocol"

/** 带序号的增量。序号是**本次主进程运行内**的传输层计数，见 main/sequence.ts。 */
export interface Sealed {
  seq: number
  event: Event
}

/**
 * 全量重建。窗口（重）加载时来一次。
 *
 * `resumeAt` 之后的增量才需要应用——之前的要么已经在 `events` 里，
 * 要么发生在还没订阅的时候。这条规则是防重的关键。
 */
export interface Replay {
  events: readonly Event[]
  resumeAt: number
}

/**
 * 渲染层与主进程之间**唯一**的通道：
 *   send(Command)  —— 渲染层请求做事
 *   subscribe(cb)  —— 主进程推**带序号**的增量（成批，见 main/batch.ts）
 *   onReplay(cb)   —— 全量重建，窗口每次加载来一次
 *   resync(after)  —— 发现漏了就来补；补不了会回 `{reset:true}`
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
  /**
   * 在访达里定位一个路径。
   *
   * **只定位，不打开、不执行**（主进程走 `showItemInFolder`）。
   * 这条通道拿到的路径始终来自宿主发过的会话数据，渲染层自己造不出新的；
   * 即便造得出，最坏的后果也只是访达里跳出一个窗口。
   */
  reveal(path: string): void {
    ipcRenderer.send("omni:reveal", path)
  },
  async searchFiles(cwd: string, query: string): Promise<readonly string[]> {
    return (await ipcRenderer.invoke("omni:searchFiles", { cwd, query })) as readonly string[]
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
  subscribe(onEvents: (sealed: readonly Sealed[]) => void): () => void {
    const listener = (_e: unknown, sealed: readonly Sealed[]): void => {
      onEvents(sealed)
    }
    ipcRenderer.on("omni:events", listener)
    return () => {
      ipcRenderer.off("omni:events", listener)
    }
  },
  onReplay(handler: (replay: Replay) => void): () => void {
    const listener = (_e: unknown, replay: Replay): void => {
      handler(replay)
    }
    ipcRenderer.on("omni:replay", listener)
    return () => {
      ipcRenderer.off("omni:replay", listener)
    }
  },
  /** 补 `after` 之后漏掉的。补不了返回 `{reset:true}`，调用方必须等下一次全量。 */
  async resync(after: number): Promise<{ events: readonly Sealed[] } | { reset: true }> {
    return (await ipcRenderer.invoke("omni:resync", after)) as
      | { events: readonly Sealed[] }
      | { reset: true }
  },
}

export type OmniBridge = typeof api

contextBridge.exposeInMainWorld("omni", api)
