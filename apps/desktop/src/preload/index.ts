import { contextBridge, ipcRenderer } from "electron"
import type { Command, Event } from "@omni/protocol"
import type { Settings } from "../shared/settings.js"
import type { ProjectDoc } from "../main/projectdoc.js"
import type { EngineVersion, UpdateResult } from "../main/enginever.js"

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
  /** 各家引擎装的是哪版、有没有新版。查不到就返回空数组（不打扰）。 */
  async engineVersions(): Promise<readonly EngineVersion[]> {
    return (await ipcRenderer.invoke("omni:engineVersions")) as readonly EngineVersion[]
  },

  /** 真的去更新一家引擎。跑的命令和界面上摆出来的那条逐字相同。 */
  async updateEngine(engine: string): Promise<UpdateResult> {
    return (await ipcRenderer.invoke("omni:updateEngine", engine)) as UpdateResult
  },

  /** 这个项目的说明文件在不在、两家是不是读的同一份。 */
  async projectDoc(cwd: string): Promise<ProjectDoc> {
    return (await ipcRenderer.invoke("omni:projectDoc", cwd)) as ProjectDoc
  },
  /** 缺什么补什么：建 `AGENTS.md`，并让 `CLAUDE.md` 指过去。 */
  async ensureProjectDoc(cwd: string): Promise<ProjectDoc> {
    return (await ipcRenderer.invoke("omni:ensureProjectDoc", cwd)) as ProjectDoc
  },
  /** 用系统默认编辑器打开说明文件。 */
  openProjectDoc(cwd: string): void {
    void ipcRenderer.invoke("omni:openProjectDoc", cwd)
  },

  /** 给一条不属于任何项目的对话要一个目录（主进程自动建在 `~/Documents/omni/` 下）。 */
  async chatDir(): Promise<string> {
    return (await ipcRenderer.invoke("omni:chatDir")) as string
  },
  /**
   * 把剪贴板里的图片落到盘上，返回路径。类型不认或太大时返回 undefined。
   *
   * 传 `ArrayBuffer` 而不是 base64 字符串：后者体积涨三分之一，
   * 而这条通道每贴一张图就走一次。
   */
  async stashImage(mime: string, bytes: ArrayBuffer): Promise<string | undefined> {
    return (await ipcRenderer.invoke("omni:stashImage", { mime, bytes })) as string | undefined
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
  /** 版本与数据目录。设置面板要显示它们，而渲染层拿不到 `app`。 */
  async appInfo(): Promise<{ version: string; dataDir: string }> {
    return (await ipcRenderer.invoke("omni:appInfo")) as { version: string; dataDir: string }
  },
  /** 用系统编辑器打开引擎注册表。和菜单里那一项**是同一条路**，不是复制一份实现。 */
  openEngines(): void {
    ipcRenderer.send("omni:openEngines")
  },
  /** 导出诊断报告。同上，走的是菜单那条路。 */
  diagnose(): void {
    ipcRenderer.send("omni:diagnose")
  },
  /** 工作区在哪个分支、脏不脏。不是 git 仓库时返回空对象。 */
  async worksite(cwd: string): Promise<{ branch?: string; dirty?: boolean }> {
    return (await ipcRenderer.invoke("omni:worksite", cwd)) as { branch?: string; dirty?: boolean }
  },
  /** 读偏好；传 patch 就是写（合并），两种都返回合并后的完整值。 */
  async settings(patch?: Partial<Settings>): Promise<Settings> {
    return (await ipcRenderer.invoke("omni:settings", patch)) as Settings
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
  /**
   * 「我准备好了，把世界给我。」
   *
   * **全量重建必须由渲染层来要，不能由主进程猜时机。** 主进程原来是在
   * `did-finish-load` 时推一份过来——那一刻页面是加载完了，但 React 还没跑完
   * 第一轮 effect，`onReplay` 的监听还没挂上，于是那份全量发进了空气里。
   * 首次启动看不出来，因为紧接着的种子会话是走增量到达的；
   * **重载就原形毕露：侧栏空的、正文卡在「正在打开工作区…」，而磁盘上会话都在。**
   */
  hello(): void {
    ipcRenderer.send("omni:hello")
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
