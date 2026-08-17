import type { ChildProcess } from "node:child_process"
import { NO_CAPABILITIES } from "@omni/protocol"
import type { EngineCapabilities, EngineStatus, EngineThread, ModelOption, Trust, TurnId } from "@omni/protocol"
import type { EngineDriver, EngineSession, StartRequest } from "../contract.js"
import { createRpc, type RpcPeer, type ServerCall } from "../rpc.js"
import { createProcessOwner, type ProcessOwner, type ReclaimConfig } from "../subprocess.js"
import { probeCommand } from "../probe.js"
import { sessionsOf } from "./setup.js"
import { handshake, openSession, type OpenCtx, type OpenState } from "./open.js"
import { applyTrust, warnNativeFixed, type TrustCtx } from "./mode.js"
import { handlePermission } from "./permission.js"
import { stopStatus } from "./translate.js"
import { imageBlocks } from "./attach.js"
import {
  closeText,
  createUpdateState,
  emitUsage,
  handleUpdate,
  sweep,
  type UpdateContext,
  type UpdateState,
} from "./update.js"
import type { AcpNotification, AcpPromptResult, AcpToolCall } from "./wire.js"

/**
 * 通用 ACP 驱动。**一个驱动接所有讲 ACP 的引擎**——这是接第三家协议的全部意义：
 * 前两家各写一个驱动，第 N 家不该再写第 N 个。
 *
 * ## 客户端能力：什么都不认领，这是有意的
 *
 * ACP 允许客户端认领 `fs/*`（代 agent 读写文件）和 `terminal/*`（代 agent 开终端）。
 * omni 一个都不认领：
 *
 * - `fs` 的用处是让 agent 看见编辑器里**没存盘的缓冲区**。omni 没有编辑器，
 *   认领了只是把 agent 自己就能做的事绕一圈回到我们这儿，还多一份出错的可能。
 * - `terminal` 认领了就等于「命令跑在 omni 进程里」，这和「引擎跑自己的原生进程、
 *   用自己的沙箱」这个产品前提直接冲突——那层 OS 沙箱正是判定错了之后的兜底。
 *
 * 实测确认这不影响拿输出：不认领 `terminal` 时 codex-acp 照样自己跑命令，
 * 输出从 `rawOutput.formatted_output` 回来（见 `translate.ts` 的 `execDetail`）。
 *
 * ## 同一个代价：审批的可见性由 agent 决定
 *
 * 和 codex 那边一模一样的结构性限制，实测复现过：`agent` 档下让它
 * `curl` 一个外网地址，agent 直接被自己的沙箱拦下并报告失败，
 * **一次 `session/request_permission` 都没发**。换到 `read-only` 档，
 * 同一个改文件的操作立刻变成一条审批请求。
 *
 * 也就是说 omni 的判定器只在 agent 决定问我们时才有发言权。这是「引擎原生」
 * 这个前提的必然代价，不是可以修的 bug——写在 README 的已知限制里。
 */



/** 历史列表最多带回来这么多条。和界面上那一段的上限对齐。 */
const HISTORY_MAX = 40
const STDERR_KEEP = 2000


export interface AcpDriverConfig {
  /** 引擎身份，落进事件与判定请求。约定用 `acp:` 前缀，如 `acp:zcode`。 */
  id: string
  command: string
  args?: readonly string[]
  env?: Readonly<Record<string, string>>
  reclaim?: Partial<ReclaimConfig>
  /**
   * 这家把会话记录写到哪。**注入进来而不是驱动自己认**：
   * ACP 协议里根本没有「记录在哪」这个概念，各家各写各的
   * （kimi 的在 `kimi.ts`，grok 的在 `grok.ts`），驱动这一层不该认识
   * 任何一家的目录结构。
   *
   * `cwd` 也一并给出去：有的家**按工作区分目录**（grok 的记录在
   * `sessions/<工作区编码>/<sessionId>/` 下），光有 sessionId 定位不到；
   * 不需要的那家（kimi 查自己的索引）少收一个参数就行。
   *
   * 不给就是拿不到——换引擎时退回交接包，那条路一直留着。
   */
  logPath?: (home: string, sessionId: string, cwd: string) => Promise<string | undefined>
  /**
   * 这家怎么报上下文用量——**只用于协议之外的私有通知**。
   *
   * 标准路子是 `session/update` 的 `usage_update`，那条驱动自己认（实测 kimi
   * 一轮收工推一条 `{used, size}`）。但不是每家都走它：**grok 一条 `usage_update`
   * 都不发**，用量藏在它自己的 `_x.ai/session_notification` 里
   *（`turn_completed` 带 `usage.totalTokens`）。
   *
   * 认这类通知是一家一家的事，所以和 `logPath` 同一个办法注入进来，
   * 驱动这一层不认识任何一家的私有方法名。返回 undefined = 这条通知与用量无关。
   */
  contextUsed?: (method: string, params: unknown) => number | undefined
  /**
   * 这家的**原生审批开关**怎么按信任档设。
   *
   * ACP 的标准做法是 mode（`session/set_mode`），但不是每家都实现：
   * **grok 的 `set_mode` 是空壳，而它的会话默认 yolo**——实测不传任何 `_meta` 时
   * 它一次审批都不发，只读档下照样改文件。它唯一的开关是 `session/new` 的
   * `_meta.yoloMode`（见 `grok.ts` 的实测对照表）。
   *
   * `meta` 并进 `session/new` 的 `_meta`；`note` 是要对用户说的一句话
   * （「这一档下 omni 的判定对它不生效」），替掉「没报告可选档位」那句通用文案。
   *
   * **只在开会话时生效**：和 codex 的沙箱一样定死，`setTrust` 改不了它——
   * 改不了就发 `degraded`，不假装改成了。
   */
  nativeApproval?: (trust: Trust) => { meta?: Readonly<Record<string, unknown>>; note?: string }
}

interface SessionState extends OpenState {
  child: ChildProcess | undefined
  turn: TurnId | undefined
}

class AcpSession implements EngineSession {
  private readonly owner: ProcessOwner
  private readonly rpc: RpcPeer
  private readonly inflight = new Map<string, AcpToolCall>()
  private readonly updates: UpdateState = createUpdateState()
  private readonly trust: { current: Trust }
  private readonly state: SessionState
  private seq = 0

  constructor(
    private readonly req: StartRequest,
    private readonly config: AcpDriverConfig,
  ) {
    this.trust = { current: req.trust }
    this.owner = createProcessOwner(config.reclaim)
    this.state = {
      child: undefined,
      acpSession: undefined,
      turn: undefined,
      stderr: "",
      modes: [],
      mode: undefined,
      models: [],
      loadSession: false,
      caps: NO_CAPABILITIES,
      canList: undefined,
      windowOf: {},
      contextWindow: undefined,
      native: undefined,
      effort: undefined,
      trust: req.trust,
    }
    this.rpc = createRpc({
      send: (line) => this.state.child?.stdin?.write(`${line}\n`),
      onNotification: (method, params) => {
        this.onNotification(method, params)
      },
      onRequest: (call) => {
        void this.answer(call)
      },
    })
  }

  private updateContext(): UpdateContext {
    return {
      threadId: this.req.threadId,
      emit: this.req.emit,
      turnId: () => this.state.turn,
      inflight: this.inflight,
      newId: (prefix) => {
        this.seq += 1
        return `${prefix}-${String(this.seq)}`
      },
      now: () => Date.now(),
    }
  }

  /** 信任档那几步共用的一份上下文。见 `mode.ts`——**那是「档位怎么落到引擎上」**。 */
  private trustCtx(): TrustCtx {
    return {
      id: this.config.id,
      call: (method, params) => this.rpc.call(method, params),
      status: (status, detail) => {
        this.status(status, detail)
      },
      state: this.state,
      ...(this.config.nativeApproval === undefined ? {} : { nativeApproval: this.config.nativeApproval }),
    }
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

  private onNotification(method: string, params: unknown): void {
    if (method !== "session/update") {
      this.onForeignNotification(method, params)
      return
    }
    const update = (params as AcpNotification | undefined)?.update
    if (update === undefined) return
    handleUpdate(this.updateContext(), this.updates, update)
  }

  /**
   * 协议之外的通知。只有一件事要从这里捞：**用量**。
   *
   * grok 一条 `usage_update` 都不发（实测），它把 token 数放在自己的
   * `_x.ai/session_notification` 里。哪个方法名、什么形状由各家的模块认
   *（见 `AcpDriverConfig.contextUsed`），驱动只负责把它拼成事件——
   * 分母用当前模型的窗口大小，拿不到就不给，界面据此只显示数字不画比例条。
   */
  private onForeignNotification(method: string, params: unknown): void {
    const used = this.config.contextUsed?.(method, params)
    if (used === undefined) return
    emitUsage(this.updateContext(), used, this.state.contextWindow)
  }

  private wire(child: ChildProcess): void {
    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      this.rpc.feed(chunk)
    })
    child.stderr?.setEncoding("utf8")
    child.stderr?.on("data", (chunk: string) => {
      this.state.stderr = (this.state.stderr + chunk).slice(-STDERR_KEEP)
    })
    child.on("exit", (code) => {
      this.rpc.close(`${this.config.id} 进程已退出（code ${String(code)}）`)
      if (code !== 0 && code !== null) this.status("crashed", this.state.stderr)
    })
  }

  async start(): Promise<void> {
    this.status("starting")
    const child = this.owner.spawn({
      command: this.config.command,
      args: this.config.args ?? [],
      cwd: this.req.cwd,
      env: { ...process.env, ...(this.config.env ?? {}) },
    })
    this.state.child = child
    this.wire(child)

    await this.handshake()
    await this.openSession()
    this.status("ready")
  }

  /** 握手 + 开会话。细节在 `open.ts`——**那是「这条会话怎么开场」，不是驱动的日常**。 */
  /** 开场那几步共用的一份上下文。见 `open.ts`。 */
  private openCtx(): OpenCtx {
    return { rpc: this.rpc, owner: this.owner, config: this.config, req: this.req, state: this.state }
  }

  private async handshake(): Promise<void> {
    this.state.caps = await handshake(this.openCtx())
  }

  private async openSession(): Promise<void> {
    await openSession(this.openCtx())
    await applyTrust(this.trustCtx(), this.trust.current, this.state.modes)
  }


  /**
   * 应答 agent 发来的请求。**每一条都必须答**——不答 agent 会一直等，整轮卡死。
   *
   * 认不出的请求回 JSON-RPC 的 method-not-found，而不是空对象：ACP 的客户端
   * 方法是**能力协商**出来的，我们没认领 `fs`/`terminal` 却收到这类请求，
   * 说明对方没看能力表。回一个空对象会让它以为办成了，回错误码它才知道没有。
   */
  private async answer(call: ServerCall): Promise<void> {
    if (call.method !== "session/request_permission") {
      call.respond({ error: { code: -32601, message: `omni 未认领 ${call.method}` } })
      return
    }
    await handlePermission(
      {
        engine: this.config.id,
        cwd: this.req.cwd,
        home: this.req.home,
        trust: () => this.trust.current,
        memory: this.req.memory,
        inflight: this.inflight,
        askUser: this.req.askUser,
      },
      call,
    )
  }

  get threadId(): StartRequest["threadId"] {
    return this.req.threadId
  }

  /**
   * 发一轮。
   *
   * **`session/prompt` 到收工才回**，和 codex 的 `turn/start`（一开始就回）
   * 正好相反。所以这里不能 await 它——await 了 `prompt()` 就要挂到整轮结束，
   * 宿主那边的队列会以为这一轮还没发出去。收工事件在 then 里发。
   */
  async prompt(text: string, turnId: TurnId, attachments?: readonly string[]): Promise<void> {
    const sessionId = this.state.acpSession
    if (sessionId === undefined) throw new Error(`${this.config.id} 会话尚未就绪`)
    this.state.turn = turnId
    const prompt = [{ type: "text", text }, ...(await imageBlocks(attachments, this.state.caps.attachments))]
    this.rpc
      .call("session/prompt", { sessionId, prompt })
      .then(
        (result) => {
          this.finishTurn(turnId, (result as AcpPromptResult | undefined)?.stopReason)
        },
        (error: unknown) => {
          this.failTurn(turnId, error instanceof Error ? error.message : String(error))
        },
      )
    return Promise.resolve()
  }

  private finishTurn(turnId: TurnId, reason: AcpPromptResult["stopReason"]): void {
    if (this.state.turn !== turnId) return
    const { status, error } = stopStatus(reason)
    sweep(this.updateContext(), this.updates, status === "interrupted" ? "interrupted" : "failed")
    this.state.turn = undefined
    this.req.emit({
      type: "turn.completed",
      at: Date.now(),
      turnId,
      status,
      ...(error === undefined ? {} : { error }),
    })
  }

  /**
   * 一轮直接报错。实测过：适配器版本比配置的模型旧时，`session/prompt`
   * 回的是 JSON-RPC error 而不是 `stopReason`，两条路都要走通，
   * 否则那一轮会永远停在「进行中」。
   */
  private failTurn(turnId: TurnId, message: string): void {
    if (this.state.turn !== turnId) return
    sweep(this.updateContext(), this.updates, "failed")
    this.state.turn = undefined
    this.req.emit({ type: "turn.completed", at: Date.now(), turnId, status: "failed", error: message })
  }

  models(): Promise<readonly ModelOption[]> {
    return Promise.resolve(this.state.models)
  }

  /**
   * 换模型。ACP 的强度编在 modelId 里，所以 `effort` 参数在这里是多余的——
   * 但契约上它是可选的，忽略即可，不用报错。
   */
  /**
   * **agent 自己说的，不是写死的。** 上一版一律报 `NO_CAPABILITIES`，
   * 于是接进来的引擎就算支持贴图、支持原生分叉，界面上那些入口一个都不给。
   * 一个驱动接所有讲 ACP 的引擎，那各家能力就只能一家一家问。
   */
  capabilities(): EngineCapabilities {
    return this.state.caps
  }

  /**
   * 换模型（可能连带换强度）。
   *
   * 强度有两种表达：有的适配器把它编进 modelId（codex 适配器的
   * `gpt-5.6-sol[low]`），那时 `effort` 是多余的，忽略即可；
   * 有的把它做成独立的会话选项（kimi 的 `thinking`），那时要单独发一次。
   * **两条都走**，因为同一个驱动要接这两种。
   */
  async setModel(model: string, effort?: string): Promise<void> {
    const sessionId = this.state.acpSession
    if (sessionId === undefined) return
    await this.rpc.call("session/set_model", { sessionId, modelId: model })
    // 分母跟着换：同一家的两个模型窗口可以不一样，不换的话比例条会按旧分母画
    this.state.contextWindow = this.state.windowOf[model] ?? this.state.contextWindow
    if (effort === undefined || effort === this.state.effort) return
    await this.rpc
      .call("session/set_config_option", { sessionId, configId: "thinking", value: effort })
      .then(() => {
        this.state.effort = effort
      })
      // 改不了强度不该把「换模型」也算失败——模型那一步已经成了
      .catch(() => undefined)
  }

  /**
   * agent 自己存着哪些会话。拿不到就给空数组，界面据此不显示那一段。
   *
   * ## 「没声明」不等于「不支持」
   *
   * 实测 grok：`sessionCapabilities` 是个**空对象**，一条能力都不报，
   * 而 `session/list` 答得好好的——连 cwd、标题、更新时间都齐。
   * 只认声明的话它的历史区永远是空的，而这其实是「替引擎回答」的另一种写法，
   * 只不过这次替它答的是「不支持」。
   *
   * 所以三态（和 `probe.ts` 那个三态同一个道理）：**声明了**就直接用；
   * **没声明**的问一次，问不出来才记成不支持，之后不再问。
   * 代价是对真不支持的引擎多发一次注定失败的 RPC，只有一次。
   */
  async history(): Promise<readonly EngineThread[]> {
    if (this.state.canList === false) return []
    const raw = await this.rpc.call("session/list", { cwd: this.req.cwd }).catch(() => undefined)
    this.state.canList = raw !== undefined
    return sessionsOf(raw, HISTORY_MAX)
  }

  /**
   * 这条会话的原始记录在磁盘上的哪儿——换引擎时交接的就是这个路径。
   *
   * 协议问不出来，只能按引擎认（见 `AcpDriverConfig.logPath`）。
   * 认不出来的那些给 undefined，宿主据此退回交接包。
   */
  async logPath(): Promise<string | undefined> {
    const sessionId = this.state.acpSession
    if (sessionId === undefined || this.config.logPath === undefined) return undefined
    return this.config.logPath(this.req.home, sessionId, this.req.cwd).catch(() => undefined)
  }

  /**
   * 中断。`session/cancel` 是**通知不是请求**——发完不等回应，
   * 在途的 `session/prompt` 会以 `stopReason: "cancelled"` 收尾。
   * 当成请求发会永远等不到应答。
   */
  interrupt(): Promise<void> {
    const sessionId = this.state.acpSession
    if (sessionId === undefined) return Promise.resolve()
    this.rpc.notify("session/cancel", { sessionId })
    return Promise.resolve()
  }

  async setTrust(trust: Trust): Promise<void> {
    this.state.trust = trust
    this.trust.current = trust
    warnNativeFixed(this.trustCtx(), trust)
    await applyTrust(this.trustCtx(), trust, this.state.modes)
  }


  async dispose(): Promise<void> {
    // 有在途文本就先收口，否则最后一条消息会永远停在「正在输入」
    closeText(this.updateContext(), this.updates)
    this.state.child?.stdin?.end()
    this.rpc.close("会话正在关闭")
    const report = await this.owner.reclaim()
    if (report.rung === "escaped") {
      this.status("crashed", `${this.config.id} 进程组未能回收（pid ${String(report.pid)}），可能已泄漏`)
    }
  }
}

export function createAcpDriver(config: AcpDriverConfig): EngineDriver {
  return {
    id: config.id,
    probe: () => probeCommand(config.command, "检查 engines.json 里写的路径对不对。"),
    start: async (req: StartRequest): Promise<EngineSession> => {
      const session = new AcpSession(req, config)
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
