import type { ChildProcess } from "node:child_process"
import type { EngineAccount, EngineCapabilities, EngineThread, ModelOption, SlashCommand, Trust, TurnId, TurnStatus, Item } from "@switchback/protocol"
import type { EngineDriver, EngineSession, StartRequest, TrustChange } from "../contract.js"
import { createProcessOwner, type ProcessOwner, type ReclaimConfig } from "../subprocess.js"
import { probeCommand } from "../probe.js"
import { PROBE } from "../probe.messages.js"
import { createRpc, type RpcPeer } from "../rpc.js"
import { CODEX_HISTORY_LIMIT, toAccount, toEngineThreads } from "./catalog.js"
import { nativeAxes, nativeTrustDiffers, POLICY, REVIEWER, SANDBOX } from "./sandbox.js"
import { handleNotification, sweepInflight, type NotifyContext } from "./notify.js"
import type { WireItem } from "./wire.js"
import type { CodexSettings } from "./settings.js"
import { openSession, type OpenCtx, type SessionState } from "./open.js"
import { inputItems, startTurn } from "./turn.js"
import { createServerRequests, type ServerRequests } from "./server-requests.js"
import { createSkillCatalog, type SkillCatalog } from "./skill-catalog.js"
import { startCompaction } from "./compaction.js"
import { createCodexObservers, type CodexObservers } from "./observers.js"
import { emitCodexStatus } from "./status.js"
import { toCodexTranscript } from "./history.js"
import { modelSelection, readModelCatalog } from "./model-catalog.js"
import { localeOf } from "../locale.js"
import { DEFAULT_LOCALE } from "@switchback/i18n"
import { CODEX_DRIVER } from "./driver.messages.js"
import { CODEX_CAPABILITIES } from "./capabilities.js"

/**
 * codex 驱动。讲 `codex app-server --stdio` 的 JSON-RPC，翻成 Switchback 事件。
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
  private readonly streamed = new Map<string, string>()
  private readonly materialized = new Set<string>()
  private readonly safetyActive = new Set<TurnId>()
  private readonly settledTurns = new Set<string>()
  private readonly serverRequests: ServerRequests
  private readonly skills: SkillCatalog
  private readonly observers: CodexObservers
  /** MCP 服务器上次报的状态。只在翻面时出声——一次启动实测 17 条通知。 */
  private readonly mcpSeen = new Map<string, string>()
  private readonly trust: { current: Trust }
  private readonly state: SessionState
  /** 宿主主动收摊。此后进程退出是意料之中，不再报 `onExit`。 */
  private disposing = false

  constructor(
    private readonly req: StartRequest,
    private readonly config: CodexDriverConfig,
  ) {
    this.trust = { current: req.trust }
    this.serverRequests = createServerRequests({
      inflight: this.inflight, cwd: req.cwd, home: req.home,
      trust: () => this.trust.current, memory: req.memory,
      askUser: req.askUser, askQuestion: req.askQuestion,
      locale: () => localeOf(req),
    })
    this.owner = createProcessOwner(config.reclaim)
    this.state = {
      child: undefined,
      codexThread: undefined,
      codexTurn: undefined,
      turn: undefined,
      stderr: "",
      sandbox: SANDBOX[req.trust],
      approval: POLICY[req.trust],
      reviewer: REVIEWER[req.trust],
      model: undefined,
      effort: undefined,
      options: [],
      openedThread: undefined,
    }
    this.observers = createCodexObservers({ threadId: req.threadId, nativeThread: () => this.state.codexThread, turnId: () => this.state.turn, emit: req.emit, now: () => Date.now(), locale: () => localeOf(req) })
    this.rpc = createRpc({
      send: (line) => this.state.child?.stdin?.write(`${line}\n`),
      onNotification: (method, params) => {
        if (!this.observers.activity.handle(method, params)) handleNotification(this.notifyContext(), method, params)
      },
      onRequest: (call) => { void this.serverRequests.answer(call) },
      language: () => localeOf(req),
    })
    this.skills = createSkillCatalog({
      call: (method, params) => this.rpc.call(method, params),
      emit: req.emit,
      cwd: req.cwd,
      threadId: req.threadId,
    })
  }

  private notifyContext(): NotifyContext {
    return {
      threadId: this.req.threadId,
      codexThread: () => this.state.codexThread,
      onSettings: (settings) => this.adoptSettings(settings),
      emit: this.req.emit,
      turnId: () => this.state.turn,
      codexTurn: () => this.state.codexTurn,
      settledTurns: this.settledTurns,
      adoptCodexTurn: (turnId) => (this.state.codexTurn ??= turnId),
      settleTurn: () => {
        if (this.state.codexTurn !== undefined) this.settledTurns.add(this.state.codexTurn)
        this.state.turn = undefined
        this.state.codexTurn = undefined
      },
      inflight: this.inflight,
      streamed: this.streamed,
      materialized: this.materialized,
      safetyActive: this.safetyActive,
      mcpSeen: this.mcpSeen,
      onServerRequestResolved: this.serverRequests.resolved,
      onSkillsChanged: this.skills.changed,
      onGoal: this.req.onGoal,
      hooks: this.observers.hooks,
      now: () => Date.now(),
      locale: () => localeOf(this.req),
    }
  }

  /**
   * 引擎报了一份设置快照。
   *
   * **`match` 在这里判**：Switchback 自己设的是三张原生映射表
   *（见 `sandbox.ts`），拿它和引擎报的比一比就行——不像 ACP 那边要打分匹配，
   * 这里两边都是固定枚举，对不对得上是**确定**的。
   *
   * 三条轴分开报：codex 的档同时落在三个旋钮上，压成一个值就得现编一个合成 id。
   */
  private adoptSettings(settings: CodexSettings): void {
    const axes = nativeAxes(settings, this.trust.current)
    if (axes.length > 0 || settings.model !== undefined) {
      this.req.onEngineState?.({
        axes,
        ...(settings.model === undefined ? {} : { modelId: settings.model }),
      })
    }
    if (settings.model !== undefined || settings.effort !== undefined) {
      this.req.onModel?.(settings.model, settings.effort)
    }
  }

  /** 还挂着的轮次落终态；`state.turn` 已清时幂等无操作。 */
  private endTurn(status: TurnStatus, error?: string): void {
    const turnId = this.state.turn
    if (turnId === undefined) return
    // 在途的工具行一起扫掉，不然它们永远停在 running
    sweepInflight(this.notifyContext(), turnId, status)
    this.state.turn = undefined
    if (this.state.codexTurn !== undefined) this.settledTurns.add(this.state.codexTurn)
    this.state.codexTurn = undefined
    this.req.emit({
      type: "turn.completed",
      at: Date.now(),
      turnId,
      status,
      ...(error === undefined ? {} : { error }),
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
    child.on("exit", (code, signal) => {
      const m = CODEX_DRIVER[localeOf(this.req)]
      const detail = m.exited(code === null ? m.bySignal(String(signal)) : `code ${String(code)}`)
      this.skills.close()
      this.serverRequests.abortAll()
      this.rpc.close(detail)
      // **进程没了，在跑的那一轮必须落终态。**
      // 只发 `crashed` 的话宿主那边 `entry.turn` 和 `status: "running"` 永远留着——
      // 界面上是一条横幅 + 一个一直在涨的计时器 + 一个点了没用的「停止」，
      // 而且输入框被那个假的「正在跑」永久锁住。带上原因：被信号杀掉时 code 是 null，
      // 不带的话这一轮在转录区和横幅上都没有任何说明
      this.endTurn("failed", this.disposing ? undefined : detail)
      this.observers.hooks.close()
      if (code !== 0 && code !== null) emitCodexStatus(this.req.emit, this.req.threadId, "crashed", this.state.stderr)
      if (!this.disposing) this.req.onExit?.(detail)
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
      status: (status, detail) => emitCodexStatus(this.req.emit, this.req.threadId, status, detail),
      wire: (child) => this.wire(child),
    }
  }

  get threadId(): StartRequest["threadId"] {
    return this.req.threadId
  }

  async prompt(text: string, turnId: TurnId, attachments?: readonly string[]): Promise<void> {
    // `turn/start` 在轮次**开始**时就回（status: inProgress），不等收工——
    // 所以这里 await 它是安全的，还能顺手拿到 codex 侧的 turnId 供中断使用。
    await startTurn(
      {
        state: this.state,
        call: (method, params) => this.rpc.call(method, params),
        fail: (message) => this.endTurn("failed", message),
        discard: (native) => this.settledTurns.add(native),
        locale: () => localeOf(this.req),
      },
      text,
      turnId,
      attachments,
    )
  }

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

  /** 跑到一半改向；`expectedTurnId` 防止迟到的请求误入下一轮。 */
  async steer(text: string, attachments?: readonly string[]): Promise<void> {
    const { codexThread, codexTurn } = this.state
    if (codexThread === undefined || codexTurn === undefined) {
      throw new Error(CODEX_DRIVER[localeOf(this.req)].noTurn)
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
    this.state.options = await readModelCatalog((method, params) => this.rpc.call(method, params)).catch(() => [])
    return this.state.options
  }

  /** codex 自己存着哪些会话；清单与正文来自两条公开返回，互不猜测。 */
  async history(): Promise<readonly EngineThread[]> { return toEngineThreads(await this.rpc.call("thread/list", { limit: CODEX_HISTORY_LIMIT }).catch(() => undefined), localeOf(this.req)) }

  /** `thread/resume` 自带完整 turns；接管流程在实时流激活前把它搬进 journal。 */
  transcript(): Promise<{ items: readonly Item[]; total: number }> { return Promise.resolve(toCodexTranscript(this.state.openedThread, Date.now(), localeOf(this.req))) }

  /**
   * 这条会话的 rollout 文件在哪。`thread/list` 每条都带 `path`（实测）。
   *
   * 没有更直接的接口，所以是**在清单里找自己**。清单默认按最近排序，
   * 而我们要找的通常就是刚跑过的那条，代价可以接受。
   */
  async logPath(): Promise<string | undefined> {
    const direct = this.state.openedThread?.path
    if (typeof direct === "string" && direct !== "") return direct
    const { codexThread } = this.state
    if (codexThread === undefined) return undefined
    const raw = await this.rpc.call("thread/list", { limit: CODEX_HISTORY_LIMIT }).catch(() => undefined)
    const rows =
      (raw as { data?: readonly { id?: string; path?: string }[] } | undefined)?.data ?? []
    return rows.find((r) => r.id === codexThread)?.path
  }

  /** 登录的是哪个账号。额度算在谁头上，看这个。 */
  async account(): Promise<EngineAccount | undefined> {
    const raw = await this.rpc.call("account/read", {}).catch(() => undefined)
    return toAccount(raw)
  }

  /** 能用哪些斜杠命令。翻译在 `catalog.ts`——那是**形状转换**，不是协议调用。 */
  async commands(): Promise<readonly SlashCommand[]> {
    return this.skills.list()
  }

  /**
   * 压缩上下文。app-server 的 `thread/compact/start`。
   *
   * 它**不在 `skills/list` 里**（那只报用户装的技能），所以 Switchback 必须自己
   * 提供入口——否则 codex 会话撞满上下文就只能新开一个，两小时的历史全丢。
   */
  compact(turnId: TurnId): Promise<void> { return startCompaction({ state: this.state, call: (method, params) => this.rpc.call(method, params), fail: (message) => this.endTurn("failed", message), locale: () => localeOf(this.req) }, turnId) }

  pid(): number | undefined { return this.owner.pid() }

  /** 每一项的判据见 `capabilities.ts`。 */
  capabilities(): EngineCapabilities {
    return CODEX_CAPABILITIES
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
    const selected = modelSelection(this.state.options, model, effort)
    this.state.model = selected.model
    this.state.effort = selected.effort
    // 不用单独发请求：`turn/start` 的 model/effort 覆盖「这一轮及后续」
    return Promise.resolve(this.state.effort === undefined ? {} : { effort: this.state.effort })
  }

  async interrupt(): Promise<void> {
    const { codexThread, codexTurn, turn } = this.state
    if (codexThread === undefined) return
    // `turn/start` 还没回包（停止键已经出现了）：先记下，拿到原生轮次 id 那一刻补发（见 `turn.ts`）
    if (codexTurn === undefined) {
      if (turn !== undefined) this.state.stopRequested = turn
      return
    }
    await this.rpc.call("turn/interrupt", { threadId: codexThread, turnId: codexTurn })
  }

  /** 原生旋钮定在开场；需要换旋钮时让宿主续接同一条会话重启进程。 */
  async setTrust(trust: Trust): Promise<TrustChange> {
    this.trust.current = trust
    if (!nativeTrustDiffers(this.state.sandbox, this.state.approval, this.state.reviewer, trust)) {
      return { restart: false }
    }
    return {
      restart: true,
      detail: CODEX_DRIVER[localeOf(this.req)].trustRestart,
    }
  }

  /**
   * 回收阶梯。顺序同 Claude 驱动：先给优雅退出的机会，再上信号。
   *
   * 1. 关 stdin → codex 看到 EOF，自己收尾
   * 2. `rpc.close()` 把在途请求全部落定，否则 `dispose()` 会顶在 await 上
   * 3. `owner.reclaim()` 补 SIGTERM → SIGKILL → 整树退出证明
   */
  async dispose(): Promise<void> {
    this.disposing = true
    this.state.child?.stdin?.end()
    this.skills.close()
    this.observers.hooks.close()
    this.serverRequests.abortAll()
    this.rpc.close(CODEX_DRIVER[localeOf(this.req)].closing)
    const report = await this.owner.reclaim()
    if (report.rung === "escaped") {
      emitCodexStatus(this.req.emit, this.req.threadId, "crashed", CODEX_DRIVER[localeOf(this.req)].leaked(String(report.pid)))
    }
  }
}

export function createCodexDriver(config: CodexDriverConfig = {}): EngineDriver {
  const command = config.command ?? "codex"
  return {
    id: "codex",
    // **这句话会出现在两个地方**：设置页那家的状态说明，和输入区引擎下拉里那一条的说明。
    // 原文是「装好之后重启 Switchback」——那曾经是真的（探测结果在进程里只算一次），
    // 现在不是了：装完会自动重探，手动也有一颗按钮。留着旧话等于教用户做无用功。
    probe: (locale) => probeCommand(command, PROBE[locale ?? DEFAULT_LOCALE].installHint, locale),
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
