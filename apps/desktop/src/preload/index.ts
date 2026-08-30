import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { Command } from "@omni/protocol"
import type { Replay, Sealed } from "@omni/wire"
import type { Settings } from "../shared/settings.js"
import type { ProjectDoc } from "../main/projectdoc.js"
import type { EngineVersion, UpdateResult } from "../main/enginever.js"
import type { EngineDoor } from "../main/enginedoors.js"
import type { DshProfileCatalog } from "../main/dsh-profiles.js"
import type { SelfUpdate, SelfUpdateRun } from "../main/selfupdate.js"
import type { RemoteStatus } from "../main/remote/install.js"
import type { ReviewFile, ReviewPatch, ReviewScope } from "../shared/review.js"
import type { ContentHit } from "../shared/search.js"
import type { EnvConfig } from "../shared/hooks.js"
import type { ActivityDigest } from "../shared/activity.js"
import type { FilePreview } from "../shared/file-preview.js"
import type { PickedFiles } from "../shared/attachments.js"
import { watchFile } from "./file-watch.js"

/**
 * 线上的两种形状。**从 `@omni/wire` 转出，不在这里再抄一份。**
 *
 * 这个文件曾经手写过一份 `Sealed` / `Replay`，于是它们可以和真正发出去的东西
 * 对不上而编译器一言不发——`env.d.ts` 顶上那段记的就是同一类事故。
 * 现在少一个字段会在**用它的地方**编译不过。
 */
export type { Replay, Sealed }

/**
 * 渲染层与主进程之间**唯一**的通道：
 *   send(Command)  —— 渲染层请求做事
 *   subscribe(cb)  —— 主进程推**带序号**的增量（成批，见 main/batch.ts）
 *   onReplay(cb)   —— 全量重建，窗口每次加载来一次
 *   resync(after)  —— 发现漏了就来补；补不了会回 `{reset:true}`
 *   pickFolder()   —— 借主进程弹一次系统目录选择框
 *   viewing(id)    —— 只报当前正文会话，给系统通知去噪
 *   onMenu(cb)     —— 菜单里那些只有渲染层做得到的动作
 *   find/stopFind  —— 借 Chromium 原生的页内查找
 *
 * 不暴露 fs、不暴露 child_process、不暴露 ipcRenderer 本体。
 * 渲染层新增能力必须先在 Command 联合里加一项，或者像 `pickFolder` 这样
 * 加一个**窄到只能做一件事**的方法——它只回一个用户亲手选的路径，
 * 渲染层拿不到任何遍历文件系统的能力。
 */
interface Review {
  root: string
  cwd: string
  files: readonly ReviewFile[]
  /** 被截掉了多少个。列表有上限，不说等于假装那是全部。 */
  more?: number
  ignored?: readonly string[]
  baseline?: true
  failed?: true
  turnMissing?: true
  /** 这张清单是跨几个仓库并起来的（工作区自己不是仓库）。见 `main/workdiff-multi.ts`。 */
  spread?: true
  scope?: ReviewScope
}

const api = {
  send(command: Command): void {
    ipcRenderer.send("omni:command", command)
  },
  /** 当前正文正在看哪条会话；只给系统通知做去噪，不改变会话状态。 */
  viewing(threadId?: string): void {
    ipcRenderer.send("omni:viewing", threadId)
  },
  /** 用户取消时返回 undefined。 */
  async pickFolder(): Promise<string | undefined> {
    return (await ipcRenderer.invoke("omni:pickFolder")) as string | undefined
  },
  /**
   * 各家引擎装的是哪版、有没有新版。查不到就返回空数组（不打扰）。
   *
   * 主进程那边**缓存 6 小时、启动时预热**：这件事原来挂在设置面板挂载上，
   * 每开一次设置就 spawn 一次 `npm view`（见 `main/enginever.ts`）。
   * `refresh` 是面板上那颗「重新检查」，无视缓存重探一遍。
   */
  async installEngine(engine: string): Promise<UpdateResult> {
    return (await ipcRenderer.invoke("omni:installEngine", engine)) as UpdateResult
  },
  async engineVersions(refresh?: boolean): Promise<readonly EngineVersion[]> {
    return (await ipcRenderer.invoke("omni:engineVersions", refresh)) as readonly EngineVersion[]
  },
  /**
   * 重探「这台机器上装了哪几家」。装完引擎、或者用户手点时走这条。
   *
   * **返回的是「哪几家变了」**，不是全量清单：全量会由 `engines.available`
   * 事件推过来（那是唯一真源）。这里要的只是那句反馈——按下去什么都不说的
   * 按钮，用户只会按第二遍。
   */
  async rescanEngines(): Promise<readonly { id: string; label: string; state?: string }[]> {
    return (await ipcRenderer.invoke("omni:rescanEngines")) as readonly {
      id: string
      label: string
      state?: string
    }[]
  },
  /** 各家引擎自己的设置在哪儿。**omni 只把门指出来**，见 `main/enginedoors.ts`。 */
  async engineDoors(cwd?: string, dshProfile?: string): Promise<readonly EngineDoor[]> {
    return (await ipcRenderer.invoke("omni:engineDoors", { cwd, dshProfile })) as readonly EngineDoor[]
  },
  /** DSH 的 profile 与直接插件清单；只来自各 profile 的 package.json。 */
  async dshProfiles(): Promise<DshProfileCatalog> {
    return (await ipcRenderer.invoke("omni:dshProfiles")) as DshProfileCatalog
  },
  /** 用系统编辑器打开设置页刚列出的原生配置；主进程会再次核对路径。 */
  openEngineFile(path: string): void {
    ipcRenderer.send("omni:openEngineFile", path)
  },

  /**
   * 「环境」那一页：**各家引擎自己读的配置里，钩子有哪些、生效没有。**
   *
   * 传当前会话的工作区——钩子是按项目叠加的，不传就只有用户级那几份。
   */
  async envConfig(cwd?: string): Promise<EnvConfig> {
    return (await ipcRenderer.invoke("omni:envConfig", cwd)) as EnvConfig
  },
  /**
   * 用系统默认编辑器打开一份配置文件。
   *
   * **只认这一页刚发出去的那几个路径**（主进程那边核对，见 `main/envconfig.ts`）——
   * 渲染层拿不到一个能打开任意文件的口子。
   */
  openEnvFile(path: string): void {
    ipcRenderer.send("omni:openEnvFile", path)
  },

  /** 真的去更新一家引擎。跑的命令和界面上摆出来的那条逐字相同。 */
  async updateEngine(engine: string): Promise<UpdateResult> {
    return (await ipcRenderer.invoke("omni:updateEngine", engine)) as UpdateResult
  },

  /**
   * omni 自己要不要更新——**从本机源码重建**，不是查远端（见 `main/selfupdate.ts`）。
   * 这台机器上没有源码时 `can` 是 false，界面据此什么都不画。
   */
  async selfUpdateStatus(): Promise<SelfUpdate> {
    return (await ipcRenderer.invoke("omni:selfUpdateStatus")) as SelfUpdate
  },
  /** 真的去重建 + 换包 + 重开。成功的话应用会自己退出，这个 Promise 的结果只在失败时有意义。 */
  async selfUpdate(): Promise<SelfUpdateRun> {
    return (await ipcRenderer.invoke("omni:selfUpdate")) as SelfUpdateRun
  },

  /** 这个项目的说明文件在不在、两家是不是读的同一份。 */
  async projectDoc(threadId: string, cwd: string): Promise<ProjectDoc> {
    return (await ipcRenderer.invoke("omni:projectDoc", { threadId, cwd })) as ProjectDoc
  },
  /** 缺什么补什么：建 `AGENTS.md`，并让 `CLAUDE.md` 指过去。 */
  async ensureProjectDoc(threadId: string, cwd: string): Promise<ProjectDoc> {
    return (await ipcRenderer.invoke("omni:ensureProjectDoc", { threadId, cwd })) as ProjectDoc
  },
  /** 用系统默认编辑器打开说明文件。 */
  openProjectDoc(threadId: string, cwd: string): void {
    void ipcRenderer.invoke("omni:openProjectDoc", { threadId, cwd })
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
  /** 只会删除 omni 自己复制、且没有会话历史引用的图片；原文件路径会被主进程拒绝。 */
  discardImages(paths: readonly string[]): void {
    ipcRenderer.send("omni:discardImages", paths)
  },
  /** 用系统选择器挑文件；主进程标出哪些路径符合原生图片附件条件。 */
  async pickFiles(): Promise<PickedFiles> {
    return (await ipcRenderer.invoke("omni:pickFiles")) as PickedFiles
  },
  /**
   * 拖进来的这个 `File` 在盘上的真实路径。图片会进原生附件；其他文件只把这条路径
   * 作为用户可见、可编辑的引用放进输入框，不在 preload 读取内容。
   *
   * **Electron 32 起 `File.path` 那个增补被移除了**（类型定义里的原话：
   * `getPathForFile` superseded 了它），而 omni 用的是 43——于是拖放收附件那条路
   * 一直是死的：读到 undefined，`add()` 根本不被调用，界面没反应也不报错。
   * 粘贴那条走的是另一套（`stashImage`），一直好着，正好把这个洞盖住了。
   *
   * 这条通道**只回一个路径，不读内容**：渲染层拿不到任何遍历文件系统的能力。
   */
  pathForFile(file: File): string {
    const path = webUtils.getPathForFile(file)
    if (path !== "") ipcRenderer.send("omni:allowAttachmentPaths", [path])
    return path
  },
  /**
   * 把盘上的一张图缩到边长 `max` 以内，取回 data URL。取不到（文件没了、
   * 不是图片）返回 undefined——调用方据此退回只显示文件名。
   */
  async thumb(path: string, max: number): Promise<string | undefined> {
    return (await ipcRenderer.invoke("omni:thumb", { path, max })) as string | undefined
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
  async copy(text: string): Promise<boolean> {
    return (await ipcRenderer.invoke("omni:copy", text)) === true
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
  async worksite(
    threadId: string,
    cwd: string,
  ): Promise<{ branch?: string; detached?: boolean; dirty?: boolean; dirtyCount?: number }> {
    return (await ipcRenderer.invoke("omni:worksite", { threadId, cwd })) as {
      branch?: string
      detached?: boolean
      dirty?: boolean
      dirtyCount?: number
    }
  },
  /**
   * 审核面板的文件清单：工作区里所有变了的文件 + 各自的增删数与状态。
   *
   * 和 `workChanges` 的区别是**它带着足够审核的信息**（新建/删除/改名、进没进
   * 暂存区、增删数），而那个只回路径。两条并存是有意的：变更汇总卡只需要路径，
   * 让它去付这份代价不划算。
   */
  async workReview(
    cwd: string,
    threadId: string,
    wanted?: readonly string[],
    scope?: ReviewScope,
  ): Promise<Review | undefined> {
    return (await ipcRenderer.invoke("omni:workReview", { cwd, threadId, wanted, scope })) as
      | Review
      | undefined
  },
  /**
   * 一个文件的补丁。**按需取**——一个 200 文件的改动全量取可能是几十 MB，
   * 而人一次只看得了一个。
   */
  async workPatch(cwd: string, rel: string, query: {
    context?: number
    threadId: string
    scope?: ReviewScope
  }): Promise<ReviewPatch> {
    return (await ipcRenderer.invoke("omni:workPatch", { cwd, rel, ...query })) as ReviewPatch
  },
  /**
   * 在所有会话的**正文**里找一句话。侧栏那个筛选框只搜标题/首句/目录，
   * 而人记得住的往往是中间某一句。**只搜说过的话，不搜工具调用**——
   * 把命令原文算进来的话，搜什么都会命中跑过命令的那几条（见 `main/search.ts`）。
   */
  async searchThreads(query: string): Promise<{ hits: readonly ContentHit[]; skipped: number }> {
    return (await ipcRenderer.invoke("omni:searchThreads", query)) as {
      hits: readonly ContentHit[]
      skipped: number
    }
  },
  /**
   * 「活动」那一页：**把磁盘上的 journal 整个走一遍**，折成一份按天分桶的统计。
   *
   * 只在真的点进那一页时才调——它要读几十 MB（见 `main/activity.ts`）。
   * `refresh` 无视 30 秒缓存重扫一遍。
   */
  async activity(refresh?: boolean): Promise<ActivityDigest> {
    return (await ipcRenderer.invoke("omni:activity", refresh)) as ActivityDigest
  },
  /** 读偏好；传 patch 就是写（合并），两种都返回合并后的完整值。 */
  async settings(patch?: Partial<Settings>): Promise<Settings> {
    return (await ipcRenderer.invoke("omni:settings", patch)) as Settings
  },
  async searchFiles(cwd: string, query: string, refresh?: boolean): Promise<readonly string[]> {
    return (await ipcRenderer.invoke("omni:searchFiles", { cwd, query, refresh })) as readonly string[]
  },
  /**
   * 读一份文件给侧栏预览。
   *
   * 主进程核对两道门：工作区内的照读；工作区外的只有**这条会话自己读过或改过**
   * 才放行（名册在主进程里按事件流记，见 `main/touched.ts`）。
   */
  async filePreview(threadId: string, cwd: string, path: string): Promise<FilePreview> {
    return (await ipcRenderer.invoke("omni:filePreview", { threadId, cwd, path })) as FilePreview
  },
  watchFile,

  /**
   * 远程访问（浏览器端）的四条窄通道。
   *
   * **每一条都回一份完整状态**，而不是各自回各自的结果：配对之后设备表变了、
   * 吊销之后连接数变了、开关一动端口就变了——各回各的会让界面必须再问一次，
   * 而那一次问和这一次改之间的状态是不确定的。
   */
  remote: {
    async status(): Promise<RemoteStatus> {
      return (await ipcRenderer.invoke("omni:remote/status")) as RemoteStatus
    },
    /** 按当前设置起停服务端。改完 `settings.remote` 必须调一次，否则改了不生效。 */
    async sync(): Promise<RemoteStatus> {
      return (await ipcRenderer.invoke("omni:remote/sync")) as RemoteStatus
    },
    /** 开一次配对，返回带配对码的状态。**新的一开，上一个就作废**。 */
    async pair(): Promise<RemoteStatus> {
      return (await ipcRenderer.invoke("omni:remote/pair")) as RemoteStatus
    },
    /** 吊销一台设备。**正连着的那条会当场断开**，之后也认不出它的令牌。 */
    async revoke(id: string): Promise<RemoteStatus> {
      return (await ipcRenderer.invoke("omni:remote/revoke", id)) as RemoteStatus
    },
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
    // 重载期间清掉上一份页面留下的选中项；同一拍的 renderer effect 会再报当前值。
    ipcRenderer.send("omni:viewing", undefined)
    ipcRenderer.send("omni:hello")
  },

  /**
   * 补 `after` 之后漏掉的。补不了返回 `{reset:true}`，调用方必须等下一次全量。
   *
   * **`epoch` 必须一起报**：序号是「本次主进程运行内」的计数，只报数字的话
   * 主进程分不出这个游标是不是上一次运行留下的（见 `@omni/wire` 的 `Replay.epoch`）。
   */
  async resync(after: number, epoch: string): Promise<{ events: readonly Sealed[] } | { reset: true }> {
    return (await ipcRenderer.invoke("omni:resync", { after, epoch })) as
      | { events: readonly Sealed[] }
      | { reset: true }
  },
}

export type OmniBridge = typeof api

contextBridge.exposeInMainWorld("omni", api)
