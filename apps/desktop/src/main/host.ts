import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow, type WebContents } from "electron"
import type { Command, EngineInfo, Event, Thread, ThreadId } from "@omni/protocol"
import { createClaudeDriver, createCodexDriver } from "@omni/engine"
import { createHost, type Host } from "@omni/host"
import { createJournal, createRuleStore } from "@omni/journal"
import { createWorksite, type Worksite } from "@omni/worksite"
import { devEngine, devResume, devTrust } from "./devtools.js"
import { createBatcher } from "./batch.js"
import { createAttention } from "./attention.js"
import { readEngineFile, registerAcpEngines } from "./engines.js"
import { createSequencer, type Sealed } from "./sequence.js"
import type { Logger } from "./log.js"

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
  /** 事件流的序号与补发缓冲。窗口重载时的全量重建要用它对齐游标。 */
  sequencer: ReturnType<typeof createSequencer>
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
 * 把 `@omni/host` 接到窗口上。
 *
 * 事件只往**当前活着的窗口**广播；窗口没了就丢弃——渲染层重开时会重新拉状态
 * （持久化接上之前，重开等于新会话）。
 */
/**
 * 事件出口：合帧 → 编号 → 广播 → 顺带记日志。
 *
 * 合帧的理由见 `batch.ts`，编号与补发的理由见 `sequence.ts`；
 * 记日志只挑 `engine.status`，因为那是唯一**用户看不见却必须留痕**的一类——
 * 其余事件在界面上都有对应的呈现。
 */
function createOutlet(
  windows: () => readonly BrowserWindow[],
  log: Logger,
  seen: { thread: ThreadId | undefined },
): { emit: (event: Event) => void; sequencer: ReturnType<typeof createSequencer> } {
  const sequencer = createSequencer()
  const attention = createAttention(windows)
  const batcher = createBatcher((events) => {
    // 每条出去的事件顺带过一遍「要不要叫人」。放在发 IPC 的同一处，
    // 免得将来多一条出口就漏一处
    for (const event of events) attention.note(event)
    // **编号在合帧之后**：合帧只改变什么时候发，编号定的是发了什么。
    // 反过来（先编号再攒）在批被丢弃时会留下号码空洞，看起来像丢事件
    const sealed = sequencer.seal(events)
    for (const win of windows()) {
      if (!win.isDestroyed()) win.webContents.send("omni:events", sealed)
    }
  })
  return {
    emit: (event) => {
      if (event.type === "thread.started") seen.thread = event.thread.id
      // detail 里可能带 stderr，长度约束在 log.ts 那一层
      if (event.type === "engine.status" && event.status !== "ready") {
        const level = event.status === "crashed" ? "error" : "info"
        log.write(level, "engine", `${event.status} ${event.detail ?? ""}`)
      }
      batcher.push(event)
    },
    sequencer,
  }
}

interface Channels {
  host: Host
  log: Logger
  sequencer: ReturnType<typeof createSequencer>
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
  ipcMain.handle("omni:resync", (_e, after: number): { events: readonly Sealed[] } | { reset: true } => {
    const missed = deps.sequencer.since(after)
    if (missed === undefined) {
      deps.log.write("warn", "ipc", `补发失败：渲染层停在 ${String(after)}，缓冲已覆盖不到，转全量重建`)
      return { reset: true }
    }
    return { events: missed }
  })

  ipcMain.on("omni:command", (_e, command: Command) => {
    // 命令失败不能掐掉主进程：翻成一条状态事件送回界面
    void deps.host.dispatch(command).catch((error: unknown) => {
      deps.report(error, "threadId" in command ? command.threadId : undefined)
    })
  })
}

export function attachHost(
  windows: () => readonly BrowserWindow[],
  log: Logger,
): Attached {
  const seen = { thread: undefined as ThreadId | undefined }

  const { emit, sequencer } = createOutlet(windows, log, seen)

  // userData 而不是自己拼 ~/.omni：这是系统给应用的位置，
  // 用户换机器迁移、清理应用数据时才找得到、才带得走
  const journal = createJournal({ dir: join(app.getPath("userData"), "threads") })
  // 规则和事件分开存：删会话不该把「始终允许」一起删了
  const rules = createRuleStore(join(app.getPath("userData"), "rules"))

  // **这张表就是真源**：界面上能选的引擎从这里来，不在渲染层写第二份。
  // 写两份的下场是下拉里列着 ZCode 和 Kimi，选中直接报「未注册的引擎」。
  //
  // 第三方 ACP 引擎从 `engines.json` 读，默认没有——**不内置一份猜出来的清单**，
  // 理由见 `engines.ts`。装了什么由用户说了算，我们只负责讲协议。
  const acp = registerAcpEngines(readEngineFile(app.getPath("userData"), log))
  const drivers = { claude: createClaudeDriver(), codex: createCodexDriver(), ...acp.drivers }
  const labels: Readonly<Record<string, string>> = {
    claude: "Claude Code",
    codex: "Codex",
    ...acp.labels,
  }

  const host = createHost({
    drivers,
    home: homedir(),
    journal,
    rules,
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

  installBridgeChannels({ host, log, sequencer, report })

  return {
    host,
    journal,
    engines: probeEngines(drivers, labels, log),
    lastThreadId: () => seen.thread,
    sequencer,
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
      if (engine.state === "missing") log.write("warn", "engines", `${engine.id}：${engine.detail ?? ""}`)
    }
    return cached
  }
}

export interface ThreadHistory {
  id: ThreadId
  events: readonly Event[]
}

/**
 * 把「历史 + 活着的会话 + 引擎清单」拼成一份全量。
 *
 * 单独一个纯函数是因为顺序在这里**是正确性问题**，而它不该只能靠起 Electron 来验。
 *
 * ## 为什么要反着喂
 *
 * `journal.list()` 给的是**最近写过的在前**（那是一个列表 API 该有的样子），
 * 而归约器 `reduce.ts` 是 `order: [id, ...order]`——**往前插**。
 * 顺着喂，最新的那个会被后来的旧会话一路顶到底下，侧栏变成最旧在前。
 *
 * 这个 bug 一直都在，只是以前看不见：启动时最后总会新建一个会话，
 * 它往前一插就盖住了顺序不对这件事。重载时不新建会话，才露出来。
 */
export function replayEvents(
  engines: readonly EngineInfo[],
  threads: readonly ThreadHistory[],
  alive: ReadonlyMap<ThreadId, Thread>,
  now: number,
): readonly Event[] {
  const events: Event[] = [{ type: "engines.available", at: now, engines }]
  // 反着喂：归约器往前插，所以最旧的先进去，最新的才会落在侧栏顶上
  for (const thread of [...threads].reverse()) {
    if (thread.events.length === 0) continue
    // **一句话都没说过的会话不算历史。**
    //
    // omni 每次启动都会开一个默认会话，用不用它是另一回事——于是每启动一次
    // 侧栏就多一行「新会话」。跑一周下来那一列全是空壳，把真正的历史挤没了。
    //
    // 这种会话也确实没有可续的东西：续跑要靠引擎侧的句柄接上一段对话，
    // 而它压根没有对话。活着的那个例外——它正开着，用户随时会在里面打字。
    if (alive.get(thread.id) === undefined && !thread.events.some((e) => e.type === "item.started" && e.item.kind === "user_message")) {
      continue
    }
    events.push(...thread.events)
    const live = alive.get(thread.id)
    if (live !== undefined) {
      // 用宿主手上那份当前状态收尾：journal 里最后一条可能停在轮次中间
      events.push({ type: "thread.updated", at: now, thread: live })
      continue
    }
    const last = [...thread.events]
      .reverse()
      .find((e) => e.type === "thread.started" || e.type === "thread.updated")
    if (last === undefined || (last.type !== "thread.started" && last.type !== "thread.updated")) continue
    // 回放出来的会话背后没有引擎进程，补一条 `detached` 让界面关掉输入框——
    // 一个能打字却答非所问的输入框比没有输入框糟得多
    events.push({ type: "thread.updated", at: now, thread: { ...last.thread, status: "idle", detached: true } })
  }
  return events
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
export async function rebuild(attached: Attached, target: WebContents): Promise<ThreadId | undefined> {
  // **活着的会话不能标 detached。** 它们和历史在 journal 里长得一模一样，
  // 但背后还有引擎进程。混为一谈的话，重载之后整个应用变成只读，
  // 而引擎其实还在跑——重载验证第一次跑出来的就是这个
  const alive = new Map(attached.host.live().map((thread) => [thread.id, thread]))
  // **先把在途写入落完再读。** 宿主发事件不等落盘，所以「发出去了」和
  // 「在文件里了」之间有个窗口；在窗口里读到的是残缺的一份，而回放会按
  // 「resumeAt 之前的都已经在全量里」把那些事件全丢掉——
  // 表现是会话还在、里面的消息全没了。实测复现过：开机自动建的那个会话
  // 跑完一整轮，界面上却是空的
  await attached.journal.flush().catch(() => undefined)
  const ids = await attached.journal.list().catch((): readonly ThreadId[] => [])
  const threads = await Promise.all(
    ids.map(async (id) => ({ id, events: await attached.journal.read(id).catch((): readonly Event[] => []) })),
  )
  const events = replayEvents(await attached.engines(), threads, alive, Date.now())
  const resumeAt = attached.sequencer.latest()
  if (!target.isDestroyed()) target.send("omni:replay", { events, resumeAt })
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
  if (prompt !== undefined) await attached.host.dispatch({ type: "thread.prompt", threadId, text: prompt })
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
  if (prompt === undefined || threadId === undefined) return
  await attached.host.dispatch({ type: "thread.prompt", threadId, text: prompt })
}
