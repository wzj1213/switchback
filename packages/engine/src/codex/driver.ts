import type { ChildProcess } from "node:child_process"
import type { EngineAccount, EngineCapabilities, EngineStatus, EngineThread, ModelOption, SlashCommand, Trust, TurnId, TurnStatus } from "@omni/protocol"
import type { EngineDriver, EngineSession, StartRequest } from "../contract.js"
import { createProcessOwner, type ProcessOwner, type ReclaimConfig } from "../subprocess.js"
import { probeCommand } from "../probe.js"
import { createRpc, type RpcPeer, type ServerCall } from "../rpc.js"
import { skillsToCommands, toAccount, toEngineThreads, toModelOption, type WireModel } from "./catalog.js"
import { LOOSENESS, SANDBOX } from "./sandbox.js"
import { handleNotification, sweepInflight, type NotifyContext } from "./notify.js"
import { answerApproval } from "./approve.js"
import type { WireItem } from "./wire.js"
import { openSession, type OpenCtx, type SessionState } from "./open.js"

/**
 * codex 驱动。讲 `codex app-server --stdio` 的 JSON-RPC，翻成 omni 事件。
 *
 * 信任档怎么落到 codex 的**操作系统沙箱**上，是这个驱动最重要的一个决定，
 * 单独写在 `sandbox.ts`——那不是一张查找表，是接第二家引擎时最大的发现。
 */
const STDERR_KEEP = 2000

export interface CodexDriverConfig {
  /** 可执行文件。默认走 PATH 上的 `codex`。 */
  command?: string
  args?: readonly string[]
  reclaim?: Partial<ReclaimConfig>
}

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
      options: [],
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
      codexThread: () => this.state.codexThread,
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

  start(): Promise<void> {
    return openSession(this.openCtx())
  }

  /** 开场那一组要的东西。形状与 `acp/open.ts` 的 `OpenCtx` 对齐。 */
  private openCtx(): OpenCtx {
    return {
      rpc: this.rpc,
      owner: this.owner,
      config: this.config,
      req: this.req,
      state: this.state,
      status: (status, detail) => {
        this.status(status, detail)
      },
      wire: (child) => {
        this.wire(child)
      },
    }
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
    const options = list.filter((m) => m.hidden !== true).map(toModelOption)
    this.state.options = options
    return options
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

  /**
   * 这条会话的 rollout 文件在哪。`thread/list` 每条都带 `path`（实测）。
   *
   * 没有更直接的接口，所以是**在清单里找自己**。清单默认按最近排序，
   * 而我们要找的通常就是刚跑过的那条，代价可以接受。
   */
  async logPath(): Promise<string | undefined> {
    const { codexThread } = this.state
    if (codexThread === undefined) return undefined
    const raw = await this.rpc.call("thread/list", {}).catch(() => undefined)
    const rows = (raw as { data?: readonly { id?: string; path?: string }[] } | undefined)?.data ?? []
    return rows.find((r) => r.id === codexThread)?.path
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
    // `modeReadback`：`thread/settings/updated` 要在 `initialize` 里声明
    // `capabilities:{experimentalApi:true}`，而声明它的前置（一张「omni 认领了哪些
    // 实验面」的常量表 + CI 双向断言）还没建，见索引 §5-2。同样是「还没接」不是「没有」
    // `sideQuestion`：codex 的侧问只活在它自己的 TUI 里（`tui/src/app/side.rs`），
    // **没从 app-server 那扇门出来**。照着拼要 omni 抄一份它的边界提示词进来维护，
    // 撞 AGENTS.md 的总纲——见 `docs/侧栏与引擎状态方案.md` §0
    return { compact: true, attachments: true, steer: true, fork: true, modeReadback: false, sideQuestion: false }
  }

  /**
   * 换模型。
   *
   * ## 为什么强度要**主动补上**，而不是不传就算了
   *
   * 不传的话 codex 用它自己配置里的全局默认——而那个默认**未必是这个模型
   * 支持的档**。实测：配置里默认 `max`，选 gpt-5.3-codex-spark 之后整轮直接失败，
   * `Unsupported value: 'max' is not supported with the ... model`。
   *
   * 一次「换个模型」的操作导致下一句话报一个看不懂的英文错误，
   * 而错误里提的那个值用户根本没选过。所以这里按模型自己报的默认补齐。
   * 清单拿不到时不补——那时传什么都是猜。
   */
  async setModel(model: string, effort?: string): Promise<{ effort?: string }> {
    this.state.model = model
    this.state.effort = effort ?? this.state.options.find((m) => m.id === model)?.defaultEffort
    // 不用单独发请求：`turn/start` 的 model/effort 覆盖「这一轮及后续」
    return Promise.resolve(this.state.effort === undefined ? {} : { effort: this.state.effort })
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
    const want = SANDBOX[trust]
    // **只有往上调才要出声。** 往下调是安全的：omni 自己的判定会拒得更多，
    // 而沙箱比新档位更宽这件事永远不会被用到。往上调才有害——
    // omni 说可以、写下去却被系统拦住，报错还看不出是沙箱干的
    if (LOOSENESS[want] > LOOSENESS[this.state.sandbox]) {
      this.status(
        "degraded",
        `信任档改成了「${trust}」，但**这个会话的系统沙箱改不了**（codex 在开会话时把它定死在 ${this.state.sandbox}）。` +
          `结果是 omni 这边放行、系统那边照样拦，报错还看不出是沙箱干的。要让新档位真正生效，请新开一个会话。`,
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
