import type { ChildProcess } from "node:child_process"
import type { EngineAccount, EngineCapabilities, EngineStatus, EngineThread, ModelOption, SlashCommand, Trust, TurnId, TurnStatus } from "@omni/protocol"
import type { EngineDriver, EngineSession, StartRequest } from "../contract.js"
import { createProcessOwner, type ProcessOwner, type ReclaimConfig } from "../subprocess.js"
import { probeCommand } from "../probe.js"
import { createRpc, type RpcPeer, type ServerCall } from "../rpc.js"
import { skillsToCommands, toAccount, toEngineThreads, toModelOption, type WireModel } from "./catalog.js"
import { handleNotification, sweepInflight, type NotifyContext } from "./notify.js"
import { reportAccount } from "./account.js"
import { answerApproval } from "./approve.js"
import type { WireApprovalPolicy, WireItem, WireSandbox } from "./wire.js"

/**
 * codex 驱动。讲 `codex app-server --stdio` 的 JSON-RPC，翻成 omni 事件。
 *
 * ## 沙箱不是标签，是真的沙箱——而且它就是「问不问」的开关
 *
 * 这是接第二家引擎最重要的一个发现，和 Claude 的结构完全不同。
 *
 * Claude 的 `permissionMode` 只是个路由开关，所以我们把它钉死在 `default`，
 * 让**每一次**调用都走 `canUseTool`，档位全部表达在 `@omni/approval` 里。
 *
 * codex 不是。它的 `sandbox` 是操作系统级的真沙箱（macOS 上是 seatbelt），
 * 实测下来：**只有沙箱会拦的操作才会来问客户端**。
 * `workspace-write` 下往工作区里写文件根本不会触发审批——沙箱本来就允许，
 * codex 没有理由问；换成 `read-only`，同一次写就变成一条
 * `item/fileChange/requestApproval` 送到我们手上。
 *
 * 所以信任档**必须**落在 sandbox 上，落在 approvalPolicy 上是没用的：
 *
 * | 档位        | sandbox           | 结果                                             |
 * | ----------- | ----------------- | ------------------------------------------------ |
 * | `read-only` | `read-only`       | 任何写都来问 omni，omni 拒——档位真正生效         |
 * | `auto-edit` | `workspace-write` | 工作区内的写直接过；越界才问——正是这档的语义     |
 * | `full`      | `workspace-write` | 同上，越界时由 omni 的 `full` 判定放行           |
 *
 * `full` **不**升到 `danger-full-access`：那会把 OS 沙箱整个关掉。
 * `full` 的意思是「别拿日常操作烦我」，不是「把安全网撤了」——
 * 判定错了还有沙箱兜底，这层纵深不该为省一次弹窗而放弃。
 */
const SANDBOX: Readonly<Record<Trust, WireSandbox>> = {
  "read-only": "read-only",
  "auto-edit": "workspace-write",
  full: "workspace-write",
}

/** `untrusted` 把最多的请求路由给客户端，和 Claude 钉死 `default` 是同一个用意。 */
const POLICY: WireApprovalPolicy = "untrusted"

const CLIENT_INFO = { name: "omni", title: "omni 同文", version: "0.1.0" }

const STDERR_KEEP = 2000

/** 握手上限。超过这个还没回 `initialize`，就当它起不来了。 */
const HANDSHAKE_MS = 20_000

/**
 * 把起进程的失败翻成人能照着做的一句话。
 *
 * `Error: spawn codex ENOENT` 对用户毫无意义——他要知道的是「装了没」「装哪了」。
 * 这是生产可用与否的分界线之一：报错必须说得出下一步该干什么。
 */
function startupMessage(command: string, error: Error): string {
  const code = (error as NodeJS.ErrnoException).code
  if (code === "ENOENT") {
    return `找不到可执行文件 \`${command}\`。请确认已安装 codex CLI，且它在 PATH 上（终端里跑 \`which codex\` 验证）。`
  }
  if (code === "EACCES") return `没有权限执行 \`${command}\`。`
  return `启动 \`${command}\` 失败：${error.message}`
}

interface SessionState {
  child: ChildProcess | undefined
  codexThread: string | undefined
  codexTurn: string | undefined
  turn: TurnId | undefined
  stderr: string
  sandbox: WireSandbox
  /** 用户选的模型与强度。`turn/start` 时带上，codex 说它对后续轮次也生效。 */
  model: string | undefined
  effort: string | undefined
}

export interface CodexDriverConfig {
  /** 可执行文件。默认走 PATH 上的 `codex`。 */
  command?: string
  args?: readonly string[]
  reclaim?: Partial<ReclaimConfig>
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

class CodexSession implements EngineSession {
  private readonly owner: ProcessOwner
  private readonly rpc: RpcPeer
  private readonly inflight = new Map<string, WireItem>()
  private readonly materialized = new Set<string>()
  /** MCP 服务器上次报的状态。只在翻面时出声——一次启动实测 17 条通知。 */
  private readonly mcpSeen = new Map<string, string>()
  private readonly trust: { current: Trust }
  private readonly state: SessionState

  constructor(
    private readonly req: StartRequest,
    private readonly config: CodexDriverConfig,
  ) {
    this.trust = { current: req.trust }
    this.owner = createProcessOwner(config.reclaim)
    this.state = {
      child: undefined,
      codexThread: undefined,
      codexTurn: undefined,
      turn: undefined,
      stderr: "",
      sandbox: SANDBOX[req.trust],
      model: undefined,
      effort: undefined,
    }
    this.rpc = createRpc({
      send: (line) => this.state.child?.stdin?.write(`${line}\n`),
      onNotification: (method, params) => {
        handleNotification(this.notifyContext(), method, params)
      },
      onRequest: (call) => {
        void this.answer(call)
      },
    })
  }

  private notifyContext(): NotifyContext {
    return {
      threadId: this.req.threadId,
      emit: this.req.emit,
      turnId: () => this.state.turn,
      inflight: this.inflight,
      materialized: this.materialized,
      mcpSeen: this.mcpSeen,
      now: () => Date.now(),
    }
  }

  /**
   * 把还挂着的轮次落成终态。**幂等**——`state.turn` 已经清了就什么都不做，
   * 否则正常收工路径发过一条之后这里再发一条，journal 里多一行。
   */
  private endTurn(status: TurnStatus): void {
    const turnId = this.state.turn
    if (turnId === undefined) return
    // 在途的工具行一起扫掉，不然它们永远停在 running
    sweepInflight(this.notifyContext(), turnId, status)
    this.state.turn = undefined
    this.req.emit({ type: "turn.completed", at: Date.now(), turnId, status })
  }

  private status(status: EngineStatus, detail?: string): void {
    this.req.emit({
      type: "engine.status",
      at: Date.now(),
      threadId: this.req.threadId,
      status,
      ...(detail === undefined || detail === "" ? {} : { detail }),
    })
  }

  private wire(child: ChildProcess): void {
    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      this.rpc.feed(chunk)
    })
    // stderr 只留最后一段：崩了要给人看的是最后几行，不是整个日志
    child.stderr?.setEncoding("utf8")
    child.stderr?.on("data", (chunk: string) => {
      this.state.stderr = (this.state.stderr + chunk).slice(-STDERR_KEEP)
    })
    child.on("exit", (code) => {
      this.rpc.close(`codex 进程已退出（code ${String(code)}）`)
      // **进程没了，在跑的那一轮必须落终态。**
      // 只发 `crashed` 的话宿主那边 `entry.turn` 和 `status: "running"` 永远留着——
      // 界面上是一条横幅 + 一个一直在涨的计时器 + 一个点了没用的「停止」，
      // 而且输入框被那个假的「正在跑」永久锁住
      this.endTurn("failed")
      if (code !== 0 && code !== null) this.status("crashed", this.state.stderr)
    })
  }

  async start(): Promise<void> {
    this.status("starting")
    // 继承父环境：codex 的登录态、PATH、代理设置全在里面。
    // 凭据擦洗是 EngineDescriptor 描述的以后的事，现在擦了就登录不上。
    const child = this.owner.spawn({
      command: this.config.command ?? "codex",
      args: this.config.args ?? ["app-server", "--stdio"],
      cwd: this.req.cwd,
      env: process.env,
    })
    this.state.child = child
    this.wire(child)

    await this.handshake()
    const started = await this.openThread()
    const id = (started as { thread?: { id?: string } } | undefined)?.thread?.id
    if (id === undefined) throw new Error("codex 没有返回 thread id，无法继续")
    this.state.codexThread = id
    // codex 的 thread id 就是它的会话句柄——落盘之后下次能凭它续跑
    this.req.onHandle?.(id)
    this.status("ready")
  }

  /**
   * 开会话。带句柄就续跑，不带就新开。
   *
   * 续跑失败（历史被清、版本不兼容）**不能静默降级成新会话**——那样用户会以为
   * 上下文还在，实际模型什么都不记得。宁可把失败摆出来。
   */
  private async openThread(): Promise<unknown> {
    const shared = { approvalPolicy: POLICY, sandbox: this.state.sandbox, cwd: this.req.cwd }
    if (this.req.forkOf !== undefined) return this.forkThread(this.req.forkOf)
    if (this.req.resume === undefined) return this.rpc.call("thread/start", shared)
    return this.rpc.call("thread/resume", { threadId: this.req.resume, ...shared })
  }

  /**
   * 以分叉开场。`thread/fork` 复制的是**真的会话**——分出来那条记得原会话
   * 读过哪些文件、写过什么、撞过什么错，而不是只拿到一句提炼过的目标。
   *
   * **必须由这个进程自己 fork。** 让原会话那个进程分好再交给这边去 `thread/resume`，
   * 真机上直接失败：`thread ... already has an active writer`——
   * 分出来的那条归创建它的进程管，而 omni 一个会话一个进程。
   * `thread/unsubscribe` 也不放锁（都实测过）。
   *
   * `dropTurns` 走 `thread/rollback`，**只作用在分出来的那条上**：
   * 原会话是用户还要用的，「从这一轮重来」不该把它自己截短。
   * rollback 失败不算整体失败——上下文完整的分叉已经比交接包强得多，
   * 为了少砍几轮而把整件事退回「只剩一句目标」是把好的换成差的。
   *
   * 分不出来就抛：宿主要靠这个失败退回交接包。默默起一条空会话是最坏的，
   * 那看起来分叉成功了、其实什么都不记得。
   */
  private async forkThread(of: { handle: string; dropTurns?: number }): Promise<unknown> {
    const forked = await this.rpc.call("thread/fork", { threadId: of.handle })
    const id = (forked as { thread?: { id?: string } } | undefined)?.thread?.id
    if (id === undefined || id === "") throw new Error("codex 没有返回分叉出来的会话 id")
    if (of.dropTurns !== undefined && of.dropTurns > 0) {
      await this.rpc.call("thread/rollback", { threadId: id, numTurns: of.dropTurns }).catch(() => undefined)
    }
    return forked
  }

  /**
   * 握手。**必须有超时，也必须看 spawn 本身是否失败**。
   *
   * 起不来的进程不会产出任何 stdout，`rpc.call("initialize")` 于是永远不 resolve，
   * 界面就一直停在「正在打开工作区…」——没有报错、没有超时、什么都没有，
   * 这是最难查的一类故障。
   */
  private async handshake(): Promise<void> {
    const command = this.config.command ?? "codex"
    const result = await Promise.race([
      this.rpc.call("initialize", { clientInfo: CLIENT_INFO, capabilities: null }).then(() => "ok" as const),
      this.owner.died().then((error) => ({ died: error })),
      sleep(HANDSHAKE_MS).then(() => "timeout" as const),
    ])
    if (typeof result === "object") throw new Error(startupMessage(command, result.died))
    if (result === "timeout") {
      const tail = this.state.stderr === "" ? "" : `\n${this.state.stderr}`
      throw new Error(`codex 在 ${String(HANDSHAKE_MS / 1000)} 秒内没有完成握手，已放弃。${tail}`)
    }
    this.rpc.notify("initialized")
    // 账号侧的现状（额度、登录）——**在动手之前问**，见 `account.ts`
    reportAccount(this.rpc, (status, detail) => {
      this.status(status, detail)
    }, this.req.emit)
  }

  /**
   * 服务端请求的应答。判定与措辞在 `approve.ts`——**那个文件就是「codex 的审批
   * 怎么翻译」**，应答逻辑留在驱动里是错位的：驱动只该管发 RPC 和收通知。
   */
  private async answer(call: ServerCall): Promise<void> {
    await answerApproval(call, {
      inflight: this.inflight,
      cwd: this.req.cwd,
      home: this.req.home,
      trust: () => this.trust.current,
      memory: () => this.req.memory(),
      askUser: (ask) => this.req.askUser(ask),
    })
  }

  get threadId(): StartRequest["threadId"] {
    return this.req.threadId
  }

  async prompt(text: string, turnId: TurnId, attachments?: readonly string[]): Promise<void> {
    if (this.state.codexThread === undefined) throw new Error("codex 会话尚未就绪")
    this.state.turn = turnId
    // `turn/start` 在轮次**开始**时就回（status: inProgress），不等收工——
    // 所以这里 await 它是安全的，还能顺手拿到 codex 侧的 turnId 供中断使用。
    const started = await this.rpc.call("turn/start", {
      threadId: this.state.codexThread,
      input: inputItems(text, attachments),
      ...(this.state.model === undefined ? {} : { model: this.state.model }),
      ...(this.state.effort === undefined ? {} : { effort: this.state.effort }),
    })
    this.state.codexTurn = (started as { turn?: { id?: string } } | undefined)?.turn?.id
  }

  /**
   * 跑到一半改向：把话递进**正在跑的那一轮**，不新起一轮、也不打断它。
   *
   * `expectedTurnId` 是 codex 给的并发护栏，必须传。用户按下回车到这条 RPC
   * 到达之间，那一轮可能刚好收工——不带它的话这句话会被记到**下一轮**头上，
   * 而用户以为改的是刚才那一轮。对不上时 codex 拒绝，宿主据此退回排队。
   */
  /** 标题同步给 codex，它自己的会话列表里才认得出这条。 */
  async setTitle(title: string): Promise<void> {
    const { codexThread } = this.state
    if (codexThread === undefined) return
    await this.rpc.call("thread/name/set", { threadId: codexThread, name: title })
  }

  /** 归档而不是删除：codex 那边的原始记录是用户的，可逆的操作才轮得到我们替他做。 */
  async discard(): Promise<void> {
    const { codexThread } = this.state
    if (codexThread === undefined) return
    await this.rpc.call("thread/archive", { threadId: codexThread })
  }

  async steer(text: string, attachments?: readonly string[]): Promise<void> {
    const { codexThread, codexTurn } = this.state
    if (codexThread === undefined || codexTurn === undefined) {
      throw new Error("没有正在跑的轮次，改不了向")
    }
    await this.rpc.call("turn/steer", {
      threadId: codexThread,
      expectedTurnId: codexTurn,
      input: inputItems(text, attachments),
    })
  }

  /**
   * 可选模型。`hidden` 的不给——那是 codex 自己的选择器都不显示的，
   * 我们没有理由比它更啰嗦。
   */
  async models(): Promise<readonly ModelOption[]> {
    const raw = await this.rpc.call("model/list", {}).catch(() => undefined)
    const list = (raw as { data?: readonly WireModel[] } | undefined)?.data ?? []
    return list.filter((m) => m.hidden !== true).map(toModelOption)
  }

  /**
   * codex 自己存着哪些会话。
   *
   * **只取得到列表，取不到内容**：`thread/items/list` 目前明确回
   * `not supported yet`（实测）。所以这些会话接过来之后 omni 这边是空的，
   * 而引擎那边记得一切——界面必须把这个落差说出来。
   */
  async history(): Promise<readonly EngineThread[]> {
    const raw = await this.rpc.call("thread/list", {}).catch(() => undefined)
    return toEngineThreads(raw)
  }

  /** 登录的是哪个账号。额度算在谁头上，看这个。 */
  async account(): Promise<EngineAccount | undefined> {
    const raw = await this.rpc.call("account/read", {}).catch(() => undefined)
    return toAccount(raw)
  }

  /** 能用哪些斜杠命令。翻译在 `catalog.ts`——那是**形状转换**，不是协议调用。 */
  async commands(): Promise<readonly SlashCommand[]> {
    const raw = await this.rpc.call("skills/list", {}).catch(() => undefined)
    return skillsToCommands(raw)
  }

  /**
   * 压缩上下文。app-server 的 `thread/compact/start`。
   *
   * 它**不在 `skills/list` 里**（那只报用户装的技能），所以 omni 必须自己
   * 提供入口——否则 codex 会话撞满上下文就只能新开一个，两小时的历史全丢。
   */
  async compact(): Promise<void> {
    const { codexThread } = this.state
    if (codexThread === undefined) throw new Error("会话还没起来，没法压缩")
    await this.rpc.call("thread/compact/start", { threadId: codexThread })
  }

  /** `thread/compact/start` **不在 `skills/list` 里**，所以必须由 omni 给入口。 */
  capabilities(): EngineCapabilities {
    return { compact: true, attachments: true, steer: true, fork: true }
  }

  async setModel(model: string, effort?: string): Promise<void> {
    this.state.model = model
    this.state.effort = effort
    // 不用单独发请求：`turn/start` 的 model/effort 覆盖「这一轮及后续」
    return Promise.resolve()
  }

  async interrupt(): Promise<void> {
    const { codexThread, codexTurn } = this.state
    if (codexThread === undefined || codexTurn === undefined) return
    await this.rpc.call("turn/interrupt", { threadId: codexThread, turnId: codexTurn })
  }

  /**
   * 改档只改 omni 侧的判定。**OS 沙箱在 `thread/start` 时就定死了，改不了**——
   * 往低了调没问题（omni 拒得更多），往高了调则会出现「omni 说可以、写下去却被
   * 系统拦住」的怪事。所以这种情况明确报一条状态，别让人对着一个没有报错的失败发呆。
   */
  async setTrust(trust: Trust): Promise<void> {
    this.trust.current = trust
    if (SANDBOX[trust] !== this.state.sandbox) {
      this.status(
        "ready",
        `信任档已改为 ${trust}，但本会话的 codex 沙箱仍是 ${this.state.sandbox}（开会话时定死）。要让新档位完全生效，请新开一个会话。`,
      )
    }
    return Promise.resolve()
  }

  /**
   * 回收阶梯。顺序同 Claude 驱动：先给优雅退出的机会，再上信号。
   *
   * 1. 关 stdin → codex 看到 EOF，自己收尾
   * 2. `rpc.close()` 把在途请求全部落定，否则 `dispose()` 会顶在 await 上
   * 3. `owner.reclaim()` 补 SIGTERM → SIGKILL → 整树退出证明
   */
  async dispose(): Promise<void> {
    this.state.child?.stdin?.end()
    this.rpc.close("会话正在关闭")
    const report = await this.owner.reclaim()
    if (report.rung === "escaped") {
      this.status("crashed", `codex 进程组未能回收（pid ${String(report.pid)}），可能已泄漏`)
    }
  }
}

export function createCodexDriver(config: CodexDriverConfig = {}): EngineDriver {
  const command = config.command ?? "codex"
  return {
    id: "codex",
    probe: () => probeCommand(command, "装好之后重启 omni。"),
    start: async (req: StartRequest): Promise<EngineSession> => {
      const session = new CodexSession(req, config)
      // 握手失败要在这里就抛出来，别让宿主拿到一个看着正常、一发消息就炸的会话
      // **握手失败也要回收。** `start()` 第一件事就是 spawn，而握手超时 / 对端回
      // JSON-RPC error / 缺字段这几处抛出都在 spawn 之后；那时 session 还没被登记进
      // `ctx.live`，异常一抛这个对象就没人持有了——`dispose()` 永远不会被调用，
      // 进程因为 detached 连应用退出都带不走。点五次「继续」漏五个常驻进程。
      try {
        await session.start()
      } catch (error) {
        await session.dispose().catch(() => undefined)
        throw error
      }
      return session
    },
  }
}

/**
 * 一次 `turn/start` 或 `turn/steer` 的输入项。
 *
 * codex 的 input item 认这几种（探出来的）：text / image / localImage /
 * audio / localAudio / skill / mention。**用 localImage 而不是 image**：
 * 前者只给路径，后者要把整张图塞进 JSON-RPC——一张截图几 MB，
 * 走管道既慢又会把日志撑爆。
 *
 * 抽出来是因为**开一轮和中途改向必须送同一种形状**。两处各写一份的话，
 * 哪天 codex 改了输入格式，只会有一处被改到——而没被改到的那处
 * 恰恰是更少被测到的那处。
 */
function inputItems(text: string, attachments?: readonly string[]): readonly unknown[] {
  return [
    { type: "text", text, text_elements: [] },
    ...(attachments ?? []).map((path) => ({ type: "localImage", path })),
  ]
}
