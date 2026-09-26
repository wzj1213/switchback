import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import { app, dialog, ipcMain, shell, type BrowserWindow } from "electron"
import type { Command, Event, Thread, ThreadId } from "@omni/protocol"
import type { Ledger, Sealed } from "@omni/wire"
import { createHost, type Host } from "@omni/host"
import { createJournal, createRuleStore } from "@omni/journal"
import { AcpAuthRequired } from "@omni/engine"
import { devEngine, devMaxLive, devModel, devResume, devTrust } from "./devtools.js"
import { createAttention, type Relay } from "./attention.js"
import { createOutlet } from "./outlet.js"
import type { NotifyMode } from "../shared/settings.js"
import { createAwake } from "./awake.js"
import { buildRegistry } from "./registry.js"
import type { Sink, Sinks } from "./sink.js"
import { REMOTE_THREAD_CHARS, replayEvents, scopeReplay } from "./scope.js"
import type { Logger } from "./log.js"
import { createWorktreeBaselines, type WorktreeBaselines } from "./worktree-baseline.js"
import { readBuildInfo } from "./build-info.js"
import type { TouchedFiles } from "./touched.js"
import { createEngineCatalog, type EngineCatalog } from "./engine-catalog.js"
import type { AttachmentFiles } from "./attachment-files.js"
import type { Attached, RescanReport } from "./attached.js"
import type { WorksiteSearch } from "./worksite-search.js"
import { installClipboardChannel } from "./system-clipboard.js"
import { egressFor } from "./guard-channel.js"
import { baselineDeps, handoffDeps } from "./host-deps.js"

export type { Attached, RescanReport } from "./attached.js"


interface Channels {
  host: Host
  log: Logger
  ledger: Ledger
  report: (error: unknown, threadId?: ThreadId) => void
  worksiteSearch: WorksiteSearch
}

/**
 * 渲染层要用、但只有主进程做得到的那几件事。
 *
 * 都是**窄到只能做一件事**的通道，不是把 fs 或 ipcRenderer 交出去。
 */
function installBridgeChannels(deps: Channels): void {
  installClipboardChannel(deps.log)
  // 目录选择必须在主进程弹：渲染层没有、也不该有触碰文件系统的能力。
  // 回给渲染层的只是一个用户亲手选中的路径。
  ipcMain.handle("omni:pickFolder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "选择工作区",
    })
    return result.canceled ? undefined : result.filePaths[0]
  })

  // 只定位不打开：`showItemInFolder` 在访达里选中它，不会执行任何东西
  ipcMain.on("omni:reveal", (_e, path: string) => {
    if (typeof path === "string" && path !== "") shell.showItemInFolder(path)
  })

  ipcMain.handle("omni:searchFiles", (_e, req: unknown) => deps.worksiteSearch.search(req))

  // 渲染层发现自己漏了事件时来补。补不了就明说，由它走全量重建——
  // **绝不返回一个不完整的片段**，那会让界面安静地显示错误内容
  ipcMain.handle(
    "omni:resync",
    (
      _e,
      req: { after: number; epoch: string },
    ): { events: readonly Sealed[] } | { reset: true } => {
      const after = typeof req?.after === "number" ? req.after : Number.NaN
      const missed = Number.isNaN(after) ? undefined : deps.ledger.since(after, req.epoch)
      if (missed === undefined) {
        deps.log.write(
          "warn",
          "ipc",
          `补发失败：渲染层停在 ${String(after)}，缓冲已覆盖不到，转全量重建`,
        )
        return { reset: true }
      }
      return { events: missed }
    },
  )

  ipcMain.on("omni:command", (_e, command: Command) => {
    // 命令失败不能掐掉主进程：翻成一条状态事件送回界面
    void deps.host.dispatch(command).catch((error: unknown) => {
      deps.report(error, "threadId" in command ? command.threadId : undefined)
    })
  })
}

/**
 * 落盘。
 *
 * userData 而不是自己拼 `~/.omni`：这是系统给应用的位置，
 * 用户换机器迁移、清理应用数据时才找得到、才带得走。
 */
function openJournal(log: Logger, emit: (event: Event) => void): ReturnType<typeof createJournal> {
  return createJournal({
    dir: join(app.getPath("userData"), "threads"),
    // **写满了要说出来。** 停笔本身是对的（无声地把磁盘写满更糟），
    // 但停得一声不响就成了「你以为还在记，其实早就不记了」——
    // 等重启之后发现历史断在半个月前，已经补不回来了
    onFull: (threadId) => {
      log.write("warn", "journal", `会话 ${threadId} 的记录写满了，之后的内容不再落盘`)
      emit({
        type: "engine.status",
        at: Date.now(),
        threadId,
        status: "degraded",
        detail:
          "这个会话的本地记录写满了（单个会话上限 32 MB），**之后说的话不会再落盘**。" +
          "对话本身照常进行，但重启之后看不到接下来这些。要留存的话，新开一个会话继续。",
      })
    },
  })
}

function openStores(log: Logger, emit: (event: Event) => void): {
  journal: ReturnType<typeof createJournal>
  rules: ReturnType<typeof createRuleStore>
  baselines: WorktreeBaselines
} {
  return {
    journal: openJournal(log, emit),
    rules: createRuleStore(join(app.getPath("userData"), "rules")),
    baselines: createWorktreeBaselines(join(app.getPath("userData"), "worktree-baselines")),
  }
}

/**
 * 宿主要向外借的那几件事。
 *
 * **偏好那几条全是函数，不是值**：它们背后是用户偏好，而偏好随时会改——
 * 传值的话，改完要等到重启才生效。`touched` / `worksiteSearch` 例外：它们不是偏好，
 * 而是通道与宿主事件出口必须共享的**有状态服务**（见 `index.ts`）。
 */
export interface HostPorts {
  touched: TouchedFiles
  attachmentFiles: AttachmentFiles
  worksiteSearch: WorksiteSearch
  relay?: Relay
  engineVisible?: (id: string) => boolean
  dshProfile?: () => string
  notify?: () => NotifyMode
  /** 「换引擎自动交接」开着没有。不给＝关着。 */
  handoffBrief?: () => boolean
  /** 「批量外发时停掉」开着没有。不给＝开着：守卫宁可多停一次，也不放一个仓库出去。 */
  egressStop?: () => boolean
}

/** 一次失败翻成界面看得见的东西；每一条通往 `dispatch` 的路都要经过它。 */
function reporter(emit: (event: Event) => void): (error: unknown, threadId?: ThreadId) => void {
  return (error, threadId) => {
    emit({
      type: "engine.status",
      at: Date.now(),
      threadId: threadId ?? "",
      // 引擎明确要先登录时不是故障：报成故障会把人引去查一个没坏的东西
      status: error instanceof AcpAuthRequired ? "unauthenticated" : "crashed",
      detail: error instanceof Error ? error.message : String(error),
      ...(error instanceof AcpAuthRequired ? { engine: error.engine } : {}),
    })
  }
}

/**
 * 重探一遍再广播。
 *
 * **不给 id 就全部重探**：DSH 改 profile 时只需要它自己（那是我们确知的变化），
 * 而「刚装完一家」「用户点了重新探测」时我们并不知道变的是哪一家——
 * 用户可能在终端里装的，也可能一次装了两家。
 */
function refresherOf(deps: {
  reload: ReturnType<typeof buildRegistry>["reload"]
  engines: EngineCatalog
  emit: (event: Event) => void
  labels: Readonly<Record<string, string>>
  live: () => readonly Thread[]
}): (id?: string) => Promise<RescanReport> {
  return async (id) => {
    // **全量重探时先重读 `engines.json`。** 给了 id 的那种是「这一家的配置变了」
    //（目前只有 DSH 改 profile），和注册表没关系，不必去读盘。
    // 改过或删掉的那几家，**此刻没有会话在用**才当场换（见 `mergeAcpEngines`）
    const inUse = (engine: string): boolean => deps.live().some((thread) => thread.engine === engine)
    const reloaded = id === undefined ? deps.reload(inUse) : undefined
    deps.engines.invalidate(id)
    deps.emit({ type: "engines.available", at: Date.now(), engines: await deps.engines() })
    return { needsRestart: (reloaded?.needsRestart ?? []).map((one) => deps.labels[one] ?? one) }
  }
}

/** 每条事件都先进名册再广播：预览工作区外的文件凭它放行（见 `touched.ts`）。 */
function noting(touched: TouchedFiles, attachments: AttachmentFiles,
  worksites: WorksiteSearch, publish: (event: Event) => void): (event: Event) => void {
  return (event) => {
    touched.note(event)
    attachments.note(event)
    worksites.note(event)
    if (event.type === "thread.removed") void attachments.removeThread(event.threadId)
    publish(event)
  }
}

export function attachHost(
  sinks: Sinks,
  windows: () => readonly BrowserWindow[],
  log: Logger,
  ports: HostPorts,
): Attached {
  const relay = ports?.relay
  const seen = { thread: undefined as ThreadId | undefined }
  // 叫人这件事认窗口（`isFocused` / `show` / `focus` 是窗口才有的动作），
  // 但**同一个出口再送一份到手机上**——`relay` 就是那条路。
  // 桌面正在看哪条由 `omni:viewing` 报给 attention；远程正在看哪条还要由 relay
  // 自己再判，因为只有那一层知道每台远程设备停在哪儿。
  const attention = createAttention(windows, relay, ports?.notify)
  const awake = createAwake()
  const worksiteSearch = ports.worksiteSearch
  // **迟绑定**：outlet 比 host 先建，而它要问 host「现在有几条在跑」。
  // 传函数而不是值，读到的才是当下那一份
  const holder: { host: Host | undefined } = { host: undefined }
  const live = (): readonly Thread[] => holder.host?.live() ?? []

  const { emit: publish, ledger } = createOutlet({ sinks, attention, awake, live, log, seen })
  // 挂在**唯一那个出口**上，不是各个驱动里——漏一处就是某类会话的文件点不开
  const emit = noting(ports.touched, ports.attachmentFiles, worksiteSearch, publish)

  // 规则和事件分开存；对话基线也有独立生命周期。
  const { journal, rules, baselines } = openStores(log, emit)

  const { drivers, labels, reload } = buildRegistry(app.getPath("userData"), log,
    readBuildInfo(app.getAppPath()).claudeExecutable, ports?.dshProfile)

  const host = createHost({
    drivers,
    home: homedir(),
    journal,
    rules,
    ...baselineDeps(log, baselines),
    ...handoffDeps({ journal, labels, log, userData: app.getPath("userData"), enabled: ports.handoffBrief }),
    ...(devMaxLive() === undefined ? {} : { maxLive: devMaxLive() }),
    emit,
    newId: (prefix) => `${prefix}-${randomUUID()}`,
    now: () => Date.now(),
  })

  const report = reporter(emit)
  const egress = egressFor({ host, emit, log, stop: ports.egressStop, labels })

  holder.host = host
  installBridgeChannels({ host, log, ledger, report, worksiteSearch })

  const engines = createEngineCatalog(drivers, labels, log, {
    visible: ports?.engineVisible,
    profile: (id) => id === "dsh" ? (ports?.dshProfile?.() ?? "acp") : undefined,
  })
  const refreshEngines = refresherOf({ reload, engines, emit, labels, live: () => host.live() })

  return {
    host,
    baselines,
    awake,
    touched: ports.touched,
    attachmentFiles: ports.attachmentFiles,
    worksiteSearch,
    journal,
    engines,
    refreshEngines,
    lastThreadId: () => seen.thread,
    ledger,
    sinks,
    log,
    report,
    egress,
  }
}

/**
 * 把磁盘上的历史 + 当前引擎清单凑成一份「世界现在长什么样」，直接发给某一个窗口。
 *
 * ## 为什么是**发给一个窗口**，不是广播
 *
 * 这份东西是给刚（重）加载完的那个窗口补课用的。广播出去，其他早就同步好的
 * 窗口会把整段历史再应用一遍——item 直接翻倍。
 *
 * ## 为什么 `resumeAt` 一定要在读完 journal **之后**取
 *
 * 渲染层收到全量之后，会丢掉所有 `seq <= resumeAt` 的增量。
 * 读 journal 期间引擎完全可能又产出事件：
 *
 * - 这些事件会被写进 journal（可能被这次读到），也会以增量广播出去
 * - 读完之后才取 `resumeAt`，就保证「journal 里有的」全都 `<= resumeAt`，
 *   于是增量那份被丢掉——**不重**
 * - 而读完之后才发生的事件 `> resumeAt`，会被应用——**不漏**
 *
 * 反过来先取 `resumeAt` 再读 journal，中间那段就会既在全量里又在增量里，
 * 被应用两次。顺序就是正确性本身。
 *
 * `engines.available` 一定放在全量里：它描述的是「现在有哪些引擎」。DSH 接入开关变化时
 * 也会增量推一份让所有客户端立即收敛，但不能**只**靠那次增量——重载窗口会把
 * `resumeAt` 之前的消息丢掉，清单必须从全量重建回来。
 */
export interface ThreadHistory {
  id: ThreadId
  events: readonly Event[]
}

/**
 * 把磁盘上的历史 + 当前引擎清单凑成一份「世界现在长什么样」，直接发给某一个窗口。
 *
 * ## 为什么是**发给一个窗口**，不是广播
 *
 * 这份东西是给刚（重）加载完的那个窗口补课用的。广播出去，其他早就同步好的
 * 窗口会把整段历史再应用一遍——item 直接翻倍。
 *
 * ## 为什么 `resumeAt` 一定要在读完 journal **之后**取
 *
 * 渲染层收到全量之后，会丢掉所有 `seq <= resumeAt` 的增量。
 * 读 journal 期间引擎完全可能又产出事件：
 *
 * - 这些事件会被写进 journal（可能被这次读到），也会以增量广播出去
 * - 读完之后才取 `resumeAt`，就保证「journal 里有的」全都 `<= resumeAt`，
 *   于是增量那份被丢掉——**不重**
 * - 而读完之后才发生的事件 `> resumeAt`，会被应用——**不漏**
 *
 * 反过来先取 `resumeAt` 再读 journal，中间那段就会既在全量里又在增量里，
 * 被应用两次。顺序就是正确性本身。
 *
 * `engines.available` 一定放在全量里：它描述的是「现在有哪些引擎」。DSH 接入开关变化时
 * 也会增量推一份让所有客户端立即收敛，但不能**只**靠那次增量——重载窗口会把
 * `resumeAt` 之前的消息丢掉，清单必须从全量重建回来。
 */
export async function rebuild(
  attached: Attached,
  target: Sink,
  /**
   * 正文的总条数预算。**只有远程那条路会给**——同机 IPC 上一份几 MB 的全量
   * 只是一次结构化克隆，而在蜂窝网上那是十几秒的「正在连接…」。
   */
  budget?: number,
): Promise<ThreadId | undefined> {
  // **活着的会话不能标 detached。** 它们和历史在 journal 里长得一模一样，
  // 但背后还有引擎进程。混为一谈的话，重载之后整个应用变成只读，
  // 而引擎其实还在跑——重载验证第一次跑出来的就是这个
  // **先记下游标，再读磁盘。** 读 journal 是一串跨多次 I/O 的异步操作
  //（实测 20 个大文件、页缓存已热也要 147ms），而引擎在这期间照样产出事件。
  // 那些事件会落进两头都不留的缝里：`readFile` 一开始就按当时的大小定好缓冲区，
  // 所以「读开始之后追加的」进不了这一份；而它们的序号又 `<= resumeAt`，
  // 于是客户端把增量那份也丢掉。表现最狠的是 `item.started`——归约器的
  // `patchItem` 在 owner 缺失时原样返回，于是这条 item 之后所有 delta 全成空操作，
  // **一张在这个窗口里诞生的审批卡在手机上压根不会出现**。
  const before = attached.ledger.latest()
  const alive = new Map(attached.host.live().map((thread) => [thread.id, thread]))
  // **先把在途写入落完再读。** 宿主发事件不等落盘，所以「发出去了」和
  // 「在文件里了」之间有个窗口；在窗口里读到的是残缺的一份，而回放会按
  // 「resumeAt 之前的都已经在全量里」把那些事件全丢掉——
  // 表现是会话还在、里面的消息全没了。实测复现过：开机自动建的那个会话
  // 跑完一整轮，界面上却是空的
  await attached.journal.flush().catch(() => undefined)
  const ids = await attached.journal.list().catch((): readonly ThreadId[] => [])
  const threads = await Promise.all(
    ids.map(async (id) => ({
      id,
      events: await attached.journal.read(id).catch((): readonly Event[] => []),
    })),
  )
  // 磁盘上的历史也要进名册：重启之后打开一条老会话，侧栏列的文件同样要点得开
  // （名册按会话与路径两级淘汰，见 `touched.ts` 的已知限制）
  for (const thread of threads) {
    attached.touched.noteHistory(thread.id, thread.events)
    attached.attachmentFiles.noteHistory(thread.id, thread.events)
    attached.worksiteSearch.noteHistory(thread.events)
  }
  const pruned = await attached.attachmentFiles.pruneOnce(Date.now()).catch(() => 0)
  if (pruned > 0) attached.log.write("info", "attachments", `清理了 ${String(pruned)} 个过期孤立图片`)
  // 读磁盘期间被封号的那些。它们保证**晚于快照、且还在保留缓冲里**，
  // 所以拼在最后就补上了那条缝。和磁盘那份的重叠是必然的，靠归约器的
  // 幂等去重（`@omni/store` 的 `appendItem`），不在这里判——
  // 判它需要给每条事件一个身份，那是把复杂度推给每一个产生事件的地方。
  const missed = attached.ledger.since(before, attached.ledger.epoch) ?? []
  const scoped = scopeReplay(threads, budget)
  if (scoped.deferred > 0 || scoped.trimmed > 0) {
    const parts = [
      scoped.deferred > 0 ? `${String(scoped.deferred)} 条先发头` : "",
      scoped.trimmed > 0 ? `${String(scoped.trimmed)} 条只带了尾巴` : "",
    ].filter((s) => s !== "")
    attached.log.write("info", "remote", `全量按大小收窄了：${parts.join("，")}`)
  }
  const events = [
    ...replayEvents({
      engines: attached.engines.current(),
      threads,
      alive,
      now: Date.now(),
      ...(budget === undefined ? {} : { bodies: scoped.bodies, cap: REMOTE_THREAD_CHARS }),
    }),
    // **不落盘的那些现状要补在最后。** 斜杠命令和额度都不进 journal
    //（现问引擎的东西落盘只会在重放时塞回一份过期的），于是全量里没有它们；
    // 而它们作为增量发出去的那一次又 `seq <= resumeAt`，被渲染层当旧消息丢掉。
    // 两头都不留，就永久没了——实测去掉这一行，重载之后 `/` 面板里
    // 22 条技能一条不剩，只剩 omni 自己那 8 条
    ...attached.host.liveState(),
    ...missed.map((sealed) => sealed.event),
  ]
  const resumeAt = attached.ledger.latest()
  const epoch = attached.ledger.epoch
  // `bodies` 只在分级时带：缺省的含义是「全都带」，而那正是同机 IPC 那条路
  const bodies =
    budget === undefined ? {} : { bodies: [...scoped.bodies], trimmed: [...scoped.trimmedIds] }
  if (target.alive())
    target.send({ channel: "omni:replay", replay: { events, resumeAt, epoch, ...bodies } })
  // 有活的就回活的：重载之后应该落在用户正在用的那个会话上，不是列表第一条
  return [...alive.keys()][0] ?? ids[0]
}

/**
 * 开一个默认会话，指向应用当前工作目录，让界面一进来就能用。
 * `prompt` 只在开发钩子（`OMNI_DEV_PROMPT`）下传入，正常启动不会自动发消息。
 */
export async function seedDefaultThread(
  attached: Attached,
  cwd: string,
  prompt?: string,
  resumeId?: ThreadId,
): Promise<void> {
  try {
    if (resumeId !== undefined && devResume()) await resumeInto(attached, resumeId, prompt)
    else await seed(attached, cwd, prompt)
  } catch (error) {
    // 引擎起不来是最常见的开箱故障（没装、没登录、版本不对），
    // 它必须变成界面上的一条横幅，而不是一条没人看的未处理拒绝
    attached.report(error)
  }
}

/** 开发钩子：续跑磁盘上最近那个会话，再往里发一句话。 */
async function resumeInto(attached: Attached, threadId: ThreadId, prompt?: string): Promise<void> {
  await attached.host.dispatch({ type: "thread.resume", threadId })
  if (prompt !== undefined)
    await attached.host.dispatch({ type: "thread.prompt", threadId, text: prompt })
}

async function seed(attached: Attached, cwd: string, prompt?: string): Promise<void> {
  await attached.host.dispatch({
    type: "thread.create",
    cwd,
    engine: devEngine(),
    trust: devTrust(),
    title: cwd.split("/").pop() ?? "工作区",
  })
  const threadId = attached.lastThreadId()
  if (threadId === undefined) return
  // 换模型要在发消息**之前**：`turn/start` 时带的才是这一轮真正用的那个
  const picked = devModel()
  if (picked !== undefined) {
    await attached.host.dispatch({ type: "thread.setModel", threadId, ...picked })
  }
  if (prompt === undefined) return
  await attached.host.dispatch({ type: "thread.prompt", threadId, text: prompt })
}
