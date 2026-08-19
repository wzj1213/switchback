import type { ChildProcess } from "node:child_process"
import { NO_CAPABILITIES } from "@omni/protocol"
import type { EngineCapabilities, EngineStatus, EngineThread, ModelOption, Trust, TurnId } from "@omni/protocol"
import type { EngineDriver, EngineSession, StartRequest } from "../contract.js"
import { createRpc, type RpcPeer, type ServerCall } from "../rpc.js"
import { createProcessOwner, type ProcessOwner } from "../subprocess.js"
import { probeCommand } from "../probe.js"
import { sessionsOf, type Catalog } from "./setup.js"
import type { AcpDriverConfig } from "./caps.js"
import { adoptCatalog, startSession, type OpenState, type StartCtx } from "./open.js"
import { applyTrust, warnNativeFixed, type TrustCtx } from "./mode.js"
import { applyModel, type ModelCtx } from "./model.js"
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
      // 两条路由都等开会话时由 agent 自己报的形状决定（见 `open.ts` 的 `adopt`）
      modelConfig: undefined,
      effortConfig: undefined,
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
      engine: this.config.id,
      emit: this.req.emit,
      onCatalog: (catalog) => {
        this.recatalog(catalog)
      },
      onMode: (modeId) => {
        this.state.mode = modeId
      },
      turnId: () => this.state.turn,
      inflight: this.inflight,
      newId: (prefix) => {
        this.seq += 1
        return `${prefix}-${String(this.seq)}`
      },
      now: () => Date.now(),
    }
  }

  /**
   * 「一个选好的值怎么落到引擎上」那两个模块共用的一份上下文：
   * 档位在 `mode.ts`、模型与强度在 `model.ts`。两边要的东西一模一样
   * （引擎 id、发 RPC、出声、状态），摆两份只会有一天漂成两份。
   */
  private knobs(): TrustCtx & ModelCtx {
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

  /**
   * agent 自己换了可选项（换完模型，强度的词表就变了）：落到状态上，
   * **并且转发给界面**——不转发的话选择器还摆着引擎已经不认的那几档。
   */
  private recatalog(catalog: Catalog): void {
    adoptCatalog(this.state, catalog)
    this.req.onModel?.(catalog.model, catalog.effort)
    this.req.emit({
      type: "models.updated",
      at: Date.now(),
      threadId: this.req.threadId,
      engine: this.config.id,
      models: catalog.models,
    })
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

  start(): Promise<void> {
    return startSession(this.startCtx())
  }

  /** 整条开场序列要的东西。见 `open.ts`。 */
  private startCtx(): StartCtx {
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
      applyTrust: () => applyTrust(this.knobs(), this.trust.current, this.state.modes),
    }
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
   * 换模型（可能连带换强度）。**发哪一发由 agent 报清单的方式决定**——
   * 那一段连同「发不出去怎么向用户交代」都在 `model.ts`，和 `mode.ts` 同一个边界。
   */
  setModel(model: string, effort?: string): Promise<{ effort?: string }> {
    return applyModel(this.knobs(), model, effort)
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
    warnNativeFixed(this.knobs(), trust)
    await applyTrust(this.knobs(), trust, this.state.modes)
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
