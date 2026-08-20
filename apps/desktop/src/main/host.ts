import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow } from "electron"
import type { Command, EngineInfo, Event, Thread, ThreadId } from "@omni/protocol"
import { createLedger, type Ledger, type Sealed } from "@omni/wire"
import { createHost, type Host } from "@omni/host"
import { coalesce } from "@omni/store"
import { createJournal, createRuleStore } from "@omni/journal"
import { createWorksite, type Worksite } from "@omni/worksite"
import { devEngine, devMaxLive, devModel, devResume, devTrust } from "./devtools.js"
import { createBatcher } from "./batch.js"
import { createAttention, type Attention, type Relay } from "./attention.js"
import { createAwake, type Awake } from "./awake.js"
import { buildRegistry } from "./registry.js"
import type { Sink, Sinks } from "./sink.js"
import { REMOTE_THREAD_CHARS, replayEvents, scopeReplay } from "./scope.js"
import type { Logger } from "./log.js"
import { readBuildInfo } from "./build-info.js"

export interface Attached {
  host: Host
  /** 回放磁盘上的历史用得到 */
  journal: ReturnType<typeof createJournal>
  /**
   * 这台机器上注册了哪些引擎。界面据此渲染选择器。
   *
   * **异步**，因为每一家还要回答「装了吗」——那要起一次 `which` 甚至 `--version`。
   * 结果缓存：探测在启动时做一次就够，用户装引擎的频率远低于开窗的频率。
   */
  engines: () => Promise<readonly EngineInfo[]>
  /** 最近建好的会话 id。`dispatch` 不回传 id，所以在事件流上截。 */
  lastThreadId: () => ThreadId | undefined
  /** 事件流的序号与保留缓冲。（重）连接时的全量重建要用它对齐游标。 */
  ledger: Ledger
  /** 客户端注册表。远程服务端把连接注册进来，就自动收到广播。 */
  sinks: Sinks
  /** 有活在跑时挡住闲置待机。退出前要 `release()`，否则断言留在系统里。 */
  awake: Awake
  /** 记一行。分级 replay 要说出「省了多少」。 */
  log: Logger
  /**
   * 把一次失败翻成界面看得见的东西。
   *
   * **每一条通往 `dispatch` 的路都必须经过它。** 之前只有 IPC 那条有 catch，
   * 开机自动建会话那条是裸的 `void promise`——引擎起不来时它变成一条未处理拒绝，
   * 界面就永远停在「正在打开工作区…」，没有报错、没有超时、什么都没有。
   */
  report: (error: unknown, threadId?: ThreadId) => void
}

/**
 * 事件出口：合帧 → 编号 → 广播给**每一个客户端** → 顺带记日志。
 *
 * 合帧的理由见 `batch.ts`，编号与保留的理由见 `@omni/wire`；
 * 记日志只挑 `engine.status`，因为那是唯一**用户看不见却必须留痕**的一类——
 * 其余事件在界面上都有对应的呈现。
 *
 * 「客户端」不再等于「窗口」（见 `sink.ts`）：桌面窗口和浏览器端拿的是
 * **同一份编号、同一条流**，所以「我收到第几号」在哪一端说的都是同一件事。
 */
interface OutletDeps {
  sinks: Sinks
  attention: Attention
  /**
   * 有活在跑的时候别让机器空闲待机。**远程的全部前提是这台机器还醒着。**
   *
   * 判据不是计数器而是「现在还有没有活着的活」——见 `awake.ts`。
   */
  awake: Awake
  /** 现在有哪些会话活着。**传函数不传值**：outlet 比 host 先建。 */
  live: () => readonly Thread[]
  log: Logger
  seen: { thread: ThreadId | undefined }
}

function createOutlet(deps: OutletDeps): { emit: (event: Event) => void; ledger: Ledger } {
  // **每次运行换一个代号。** 序号是「本次运行内」的计数，而远程客户端
  // 活得比宿主久——它停在 50 号，宿主重启之后新一轮的 51 号和它手上那 50 条
  // 根本不是同一串事件。代号让「补得上吗」这个判断第一步就问对问题
  const ledger = createLedger(randomUUID())
  const batcher = createBatcher((events) => {
    // 每条出去的事件顺带过一遍「要不要叫人」。放在发出去的同一处，
    // 免得将来多一条出口就漏一处。
    // **用的是合并前那份**：叫人和挡休眠认的是「发生了什么」，不是「发了几帧」
    for (const event of events) deps.attention.note(event)
    // 同一处顺带重算一次「现在还有没有活在跑」——**每次都重算，不记计数器**：
    // 漏一条 `turn.completed` 的代价从「永远不睡」降成「这一帧算错了」
    deps.awake.sync(deps.live())
    // **相邻的同 id delta 合成一条再编号。**
    //
    // 省的不是模型吐字那一路（按 token 出，一个 16ms 窗口里往往就一条，合不动），
    // 而是**命令输出**：`rpc.ts` 的 feed 把一次 stdout chunk 按行在同一个 tick 里
    // 全派发，于是 `pnpm build` 的输出是几百条同 id delta 落进同一批——
    // `MAX_BATCH` 那个 500 正是为它存在的。
    //
    // 真正的收益也不在字节上，在**账本的保留窗口**：一次构建就能刷满 5000 条，
    // 而那正是 `@omni/wire` 自己写下的失败模式——出隧道时缺口已经被自己的
    // 构建日志挤出缓冲，只能在信号最差的时候做最贵的那件事（全量重建）。
    // 合并之后同样 5000 条覆盖的墙钟时间长一到两个数量级。
    //
    // 安全性来自 `coalesce` 自己那段论证：只合挨着的同 id delta，
    // 字符串拼接满足结合律，语义和逐条应用完全等价。
    //
    // **编号在合帧之后**：合帧只改变什么时候发，编号定的是发了什么。
    // 反过来（先编号再攒）在批被丢弃时会留下号码空洞，看起来像丢事件
    const sealed = ledger.seal(coalesce(events))
    for (const sink of deps.sinks.list()) sink.send({ channel: "omni:events", sealed })
  })
  return {
    emit: (event) => {
      if (event.type === "thread.started") deps.seen.thread = event.thread.id
      // detail 里可能带 stderr，长度约束在 log.ts 那一层
      if (event.type === "engine.status" && event.status !== "ready") {
        const level = event.status === "crashed" ? "error" : "info"
        deps.log.write(level, "engine", `${event.status} ${event.detail ?? ""}`)
      }
      batcher.push(event)
    },
    ledger,
  }
}

interface Channels {
  host: Host
  log: Logger
  ledger: Ledger
  report: (error: unknown, threadId?: ThreadId) => void
}

/**
 * 渲染层要用、但只有主进程做得到的那几件事。
 *
 * 都是**窄到只能做一件事**的通道，不是把 fs 或 ipcRenderer 交出去。
 */
function installBridgeChannels(deps: Channels): void {
  // 目录选择必须在主进程弹：渲染层没有、也不该有触碰文件系统的能力。
  // 回给渲染层的只是一个用户亲手选中的路径。
  ipcMain.handle("omni:pickFolder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "选择工作区",
    })
    return result.canceled ? undefined : result.filePaths[0]
  })

  // 剪贴板走主进程：渲染层加载的是 file://，那里的 navigator.clipboard
  // 不算安全上下文，写入会被静默拒绝
  ipcMain.on("omni:copy", (_e, text: string) => {
    clipboard.writeText(text)
  })

  // 只定位不打开：`showItemInFolder` 在访达里选中它，不会执行任何东西
  ipcMain.on("omni:reveal", (_e, path: string) => {
    if (typeof path === "string" && path !== "") shell.showItemInFolder(path)
  })

  // 一个工作区一份索引，按 cwd 复用：同一目录开好几个会话不该各扫一遍
  const worksites = new Map<string, Worksite>()
  ipcMain.handle("omni:searchFiles", async (_e, req: { cwd: string; query: string }) => {
    const site = worksites.get(req.cwd) ?? createWorksite(req.cwd)
    worksites.set(req.cwd, site)
    return (await site.search(req.query)).map((h) => h.path)
  })

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

export function attachHost(
  sinks: Sinks,
  windows: () => readonly BrowserWindow[],
  log: Logger,
  ports?: { relay?: Relay },
): Attached {
  const relay = ports?.relay
  const seen = { thread: undefined as ThreadId | undefined }
  // 叫人这件事认窗口（`isFocused` / `show` / `focus` 是窗口才有的动作），
  // 但**同一个出口再送一份到手机上**——`relay` 就是那条路。
  // 「窗口在前台就不出声」这条判据两边共用；「有人正看着这条会话」
  // 那条判在远程那一层，因为只有它知道谁在看什么
  const attention = createAttention(windows, relay)
  const awake = createAwake()
  // **迟绑定**：outlet 比 host 先建，而它要问 host「现在有几条在跑」。
  // 传函数而不是值，读到的才是当下那一份
  const holder: { host: Host | undefined } = { host: undefined }
  const live = (): readonly Thread[] => holder.host?.live() ?? []

  const { emit, ledger } = createOutlet({ sinks, attention, awake, live, log, seen })

  const journal = openJournal(log, emit)
  // 规则和事件分开存：删会话不该把「始终允许」一起删了
  const rules = createRuleStore(join(app.getPath("userData"), "rules"))

  const { drivers, labels } = buildRegistry(
    app.getPath("userData"),
    log,
    readBuildInfo(app.getAppPath()).claudeExecutable,
  )

  const host = createHost({
    drivers,
    home: homedir(),
    journal,
    rules,
    ...(devMaxLive() === undefined ? {} : { maxLive: devMaxLive() }),
    emit,
    newId: (prefix) => `${prefix}-${randomUUID()}`,
    now: () => Date.now(),
  })

  const report = (error: unknown, threadId?: ThreadId): void => {
    emit({
      type: "engine.status",
      at: Date.now(),
      threadId: threadId ?? "",
      status: "crashed",
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  holder.host = host
  installBridgeChannels({ host, log, ledger, report })

  return {
    host,
    awake,
    journal,
    engines: probeEngines(drivers, labels, log),
    lastThreadId: () => seen.thread,
    ledger,
    sinks,
    log,
    report,
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
 * `engines.available` 也放在这份里，不走增量：它描述的是「现在有哪些引擎」，
 * 属于世界的样子，不是一次变化。走增量的话，重载后的窗口会把它当成
 * `resumeAt` 之前的旧消息丢掉，然后引擎选择器就空了。
 */
/**
 * 问每一家「装了吗」，只问一次。
 *
 * 缓存放在闭包里而不是每次重算：`which` + `--version` 要起真的子进程，
 * 而窗口每次重载都会来要一遍引擎清单。
 *
 * 没实现 `probe` 的驱动落 `unknown`——不是 `ok`。**猜不出来就别猜**。
 */
function probeEngines(
  drivers: Readonly<Record<string, { probe?: () => Promise<{ state: string; detail: string }> }>>,
  labels: Readonly<Record<string, string>>,
  log: Logger,
): () => Promise<readonly EngineInfo[]> {
  let cached: readonly EngineInfo[] | undefined
  return async () => {
    if (cached !== undefined) return cached
    cached = await Promise.all(
      Object.entries(drivers).map(async ([id, driver]) => {
        const probe = await driver.probe?.().catch(() => undefined)
        return {
          id,
          label: labels[id] ?? id,
          state: (probe?.state ?? "unknown") as EngineInfo["state"],
          ...(probe?.detail === undefined ? {} : { detail: probe.detail }),
        }
      }),
    )
    // 「这台机器上装了什么」是支持渠道的第一个问题，日志里必须留一行
    log.write("info", "engines", cached.map((e) => `${e.id}=${e.state ?? "?"}`).join(" "))
    for (const engine of cached) {
      if (engine.state === "missing")
        log.write("warn", "engines", `${engine.id}：${engine.detail ?? ""}`)
    }
    return cached
  }
}

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
 * `engines.available` 也放在这份里，不走增量：它描述的是「现在有哪些引擎」，
 * 属于世界的样子，不是一次变化。走增量的话，重载后的窗口会把它当成
 * `resumeAt` 之前的旧消息丢掉，然后引擎选择器就空了。
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
      engines: await attached.engines(),
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
