import type { EngineAccount, EngineCapabilities, EngineThread, Item, ModelOption, SlashCommand, Trust, TurnId } from "@omni/protocol"
import type { EngineSession, StartRequest, TrustChange } from "../contract.js"
import { KimiActivations } from "./activation.js"
import { KimiActivityTracker } from "./activity.js"
import { KimiAsides } from "./aside.js"
import { toAccount, toHistory, toLimits, toModels, type OAuthUsage } from "./catalog.js"
import { KimiDiagnostics, type KimiMcpSnapshot } from "./diagnostics.js"
import { disconnectText } from "./disconnect.js"
import { sessionPath } from "./http.js"
import { readKimiTranscript } from "./history.js"
import { KimiInteractions } from "./interactions.js"
import { kimiLogPath } from "./log.js"
import { KimiPrompter } from "./prompt.js"
import type { KimiLease } from "./server.js"
import { KimiStateReporter } from "./state.js"
import { KimiStream, type KimiCursor } from "./stream.js"
import { KIMI_TRUST } from "./trust.js"
import { KimiTurnTracker } from "./turn.js"
import { KimiTurnEvents } from "./turn-events.js"
import { reconcileKimiTurn } from "./turn-recovery.js"
import { kimiGoalUpdate, type KimiGoalWire } from "./goal.js"
import { emitKimiLiveWarning, emitKimiSessionWarnings } from "./warnings.js"
import type { KimiFrame, KimiModel, KimiPayload, KimiSessionRow, KimiSnapshot, KimiStatus, KimiTasksResponse, KimiWarningsResponse } from "./wire.js"

interface SessionInit {
  id: string
  status: KimiStatus
  snapshot: KimiSnapshot
  goal?: KimiGoalWire
  mcp?: KimiMcpSnapshot
  tasks?: KimiTasksResponse
  warnings?: KimiWarningsResponse
}

function eventAt(frame: KimiFrame): number {
  const at = frame.timestamp === undefined ? Number.NaN : new Date(frame.timestamp).getTime()
  return Number.isNaN(at) ? Date.now() : at
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

export class KimiSession implements EngineSession {
  private readonly trust: { current: Trust }
  private readonly turn: KimiTurnTracker
  private readonly turnEvents: KimiTurnEvents
  private readonly reporter: KimiStateReporter
  private readonly prompter: KimiPrompter
  private readonly interactions: KimiInteractions
  private readonly activations: KimiActivations
  private readonly asides: KimiAsides
  private readonly activity: KimiActivityTracker
  private readonly diagnostics: KimiDiagnostics
  private readonly stream: KimiStream
  private readonly unlisten: () => void
  private options: readonly ModelOption[] = []
  private goalActive: boolean
  private disposed = false

  constructor(
    private readonly req: StartRequest,
    private readonly lease: KimiLease,
    private readonly init: SessionInit,
  ) {
    this.goalActive = kimiGoalUpdate(init.goal)?.goal?.status === "active"
    this.trust = { current: req.trust }
    this.turn = new KimiTurnTracker({ emit: req.emit, now: () => Date.now() })
    this.turnEvents = new KimiTurnEvents(this.turn, req.onNativeTurn, () => this.goalActive)
    this.prompter = new KimiPrompter(lease.api, init.id, this.turn)
    this.reporter = new KimiStateReporter(req, () => this.trust.current)
    this.interactions = new KimiInteractions({
      api: lease.api,
      sessionId: init.id,
      req,
      trust: () => this.trust.current,
      onError: (message) => this.status("degraded", `Kimi 交互请求应答失败：${message}`),
    })
    this.activations = new KimiActivations({ emit: req.emit, turnId: () => this.turn.currentTurnId() })
    this.asides = new KimiAsides(lease.api, init.id)
    this.activity = new KimiActivityTracker({ threadId: req.threadId, emit: req.emit })
    this.diagnostics = new KimiDiagnostics({ threadId: req.threadId, emit: req.emit }, init.mcp)
    this.stream = new KimiStream({
      wsUrl: lease.wsUrl,
      protocol: lease.protocol,
      sessionId: init.id,
      cursor: this.cursorOf(init.snapshot),
      onFrame: (frame) => this.onFrame(frame),
      onResync: () => this.resync(),
      // 断了先报「正在重连」而不是 `degraded`：它不是故障，界面不为它弹横幅；
      // 接上报 `ready` 收起，接不回来才报 `crashed`
      onDisconnect: (cause) => this.status("reconnecting", disconnectText(cause)),
      onRecovered: () => this.status("ready"),
      onFatal: (error) => this.crashed(`Kimi 的实时连接重试多次都没接上：${error.message}`),
    })
    this.unlisten = lease.onCrash((detail) => this.crashed(detail))
  }

  async activate(): Promise<void> {
    try {
      this.req.onHandle?.(this.init.id)
      this.reporter.status(this.init.status)
      this.reporter.persisted(this.init.snapshot.session.usage)
      this.activity.reconcile(this.init.snapshot, Date.now(), this.init.tasks?.items)
      this.reportWarnings(this.init.warnings)
      if (this.init.goal !== undefined) this.reportGoal(this.init.goal)
      this.takeInteractions(this.init.snapshot)
      await this.reconcileTurn(this.init.snapshot)
      await this.stream.connect()
      this.status("ready")
      this.diagnostics.reportMcpHealth(Date.now())
    } catch (error) {
      if (this.req.resume === undefined) await this.discard().catch(() => undefined)
      throw error
    }
  }
  get threadId(): StartRequest["threadId"] { return this.req.threadId }
  private status(status: "ready" | "degraded" | "crashed" | "reconnecting", detail?: string): void {
    this.req.emit({
      type: "engine.status",
      at: Date.now(),
      threadId: this.req.threadId,
      status,
      ...(detail === undefined ? {} : { detail }),
    })
  }

  /** 主操作完成后的状态读回是校验，不该反过来把已经拿到的结果报成失败。 */
  private async refreshStatus(action: string): Promise<KimiStatus | undefined> {
    try {
      const status = await this.lease.api.get<KimiStatus>(sessionPath(this.init.id, "/status"))
      this.reporter.status(status)
      return status
    } catch (error) {
      this.status("degraded", `Kimi ${action}已完成，但状态读回失败：${errorText(error)}`)
      return undefined
    }
  }

  private crashed(detail: string): void {
    this.turn.fail(detail)
    this.status("crashed", detail)
    void this.stream.dispose()
  }

  private cursorOf(snapshot: KimiSnapshot): KimiCursor {
    return { seq: snapshot.as_of_seq, ...(snapshot.epoch === "" ? {} : { epoch: snapshot.epoch }) }
  }

  private takeInteractions(snapshot: KimiSnapshot): void {
    this.interactions.reconcile(snapshot.pending_approvals, snapshot.pending_questions)
  }

  private async resync(): Promise<KimiCursor> {
    const [snapshot, goal, tasks, warnings] = await Promise.all([
      this.lease.api.get<KimiSnapshot>(sessionPath(this.init.id, "/snapshot")),
      this.lease.api.get<KimiGoalWire>(sessionPath(this.init.id, "/goal")).catch(() => undefined),
      this.lease.api.get<KimiTasksResponse>(sessionPath(this.init.id, "/tasks")).catch(() => undefined),
      this.lease.api.get<KimiWarningsResponse>(sessionPath(this.init.id, "/warnings")).catch(() => undefined),
    ])
    if (goal !== undefined) this.reportGoal(goal)
    await this.reconcileTurn(snapshot)
    this.activity.reconcile(snapshot, Date.now(), tasks?.items)
    this.reporter.persisted(snapshot.session.usage)
    this.reportWarnings(warnings)
    this.takeInteractions(snapshot)
    return this.cursorOf(snapshot)
  }

  private reconcileTurn(snapshot: KimiSnapshot): Promise<void> {
    return reconcileKimiTurn(
      {
        api: this.lease.api,
        sessionId: this.init.id,
        events: this.turnEvents,
        tracker: this.turn,
        now: () => Date.now(),
      },
      snapshot,
    )
  }

  private handlesSessionFrame(payload: KimiPayload, at: number, seq: number | undefined): boolean {
    if (this.activity.handle(payload, at)) return true
    if (payload.agentId !== undefined && payload.agentId !== "main") return true
    if (this.activations.handle(payload, at)) return true
    return this.diagnostics.handle(payload, at, seq)
  }

  private onFrame(frame: KimiFrame): void {
    const payload = frame.payload
    if (payload === undefined || this.asides.handle(payload)) return
    const at = eventAt(frame)
    if (this.interactions.handle(payload)) return
    if (this.handlesSessionFrame(payload, at, frame.seq)) return
    if (payload.type === "warning") {
      if (!this.turn.notice(payload, at)) {
        emitKimiLiveWarning(payload, { threadId: this.req.threadId, at, emit: this.req.emit })
      }
      return
    }
    if (payload.type === "agent.status.updated") this.reporter.event(payload)
    if (payload.type === "goal.updated") this.reportGoal(payload.snapshot)
    if (this.turnEvents.handle(payload, at, frame.offset)) this.stream.requestResync()
  }

  private reportGoal(raw: unknown): void {
    const update = kimiGoalUpdate(raw)
    if (update === undefined) return
    this.goalActive = update.goal?.status === "active"
    this.turnEvents.goalChanged(this.goalActive, Date.now())
    this.req.onGoal?.(update.goal)
  }

  private reportWarnings(raw: KimiWarningsResponse | undefined): void {
    if (raw === undefined) return
    emitKimiSessionWarnings(raw.warnings, { threadId: this.req.threadId, at: Date.now(), emit: this.req.emit })
  }

  async prompt(text: string, turnId: TurnId, attachments?: readonly string[]): Promise<void> {
    await this.prompter.prompt(text, turnId, attachments)
  }

  async steer(text: string, attachments?: readonly string[]): Promise<void> {
    await this.prompter.steer(text, attachments)
  }

  async setTitle(title: string): Promise<void> {
    await this.lease.api.post(sessionPath(this.init.id, "/profile"), { title })
  }

  async discard(): Promise<void> {
    await this.lease.api.post(sessionPath(this.init.id, ":archive"), {})
  }

  askAside(text: string): Promise<string> {
    return this.asides.ask(text)
  }

  async interrupt(): Promise<void> {
    await this.lease.api.post(sessionPath(this.init.id, ":abort"), {})
  }

  async setTrust(trust: Trust): Promise<TrustChange> {
    const target = KIMI_TRUST[trust]
    await this.lease.api.post(sessionPath(this.init.id, "/profile"), { agent_config: target })
    this.trust.current = trust
    await this.refreshStatus("权限切换")
    this.req.onTrustApply?.({ result: "applied", at: Date.now() })
    return { restart: false }
  }

  async models(): Promise<readonly ModelOption[]> {
    const [catalog, config] = await Promise.all([
      this.lease.api.get<{ items: readonly KimiModel[] }>("models"),
      this.lease.api.get<{ default_model?: string }>("config").catch((): { default_model?: string } => ({})),
    ])
    this.options = toModels(catalog.items, config.default_model)
    this.reporter.setOptions(this.options)
    await this.refreshStatus("模型清单加载")
    return this.options
  }

  async setModel(model: string, effort?: string): Promise<{ effort?: string }> {
    if (this.options.length === 0) await this.models()
    const option = this.options.find((entry) => entry.id === model)
    const wanted = effort ?? option?.defaultEffort
    await this.lease.api.post(sessionPath(this.init.id, "/profile"), {
      agent_config: { model, ...(wanted === undefined ? {} : { thinking: wanted }) },
    })
    const status = await this.refreshStatus("模型切换")
    const applied = status?.thinking_level
    return option?.efforts?.includes(applied ?? "") === true ? { effort: applied } : {}
  }

  async commands(): Promise<readonly SlashCommand[]> { return this.prompter.commands() }

  async compact(turnId: TurnId): Promise<void> {
    const generation = this.turn.begin(turnId, "", "compact")
    try {
      await this.lease.api.post(sessionPath(this.init.id, ":compact"), {})
    } catch (error) {
      this.turn.failGeneration(generation, errorText(error))
      throw error
    }
  }

  async history(): Promise<readonly EngineThread[]> {
    const raw = await this.lease.api.get<{ items: readonly KimiSessionRow[] }>(
      "sessions?page_size=40&include_archive=false&exclude_empty=true",
    )
    return toHistory(raw.items)
  }

  async account(): Promise<EngineAccount | undefined> {
    const [user, usage] = await Promise.all([
      this.lease.api.get<{ kind?: string; userInfo?: { nickname?: string; userLevelName?: string } }>("oauth/userinfo"),
      this.lease.api.get<OAuthUsage>("oauth/usage").catch(() => undefined),
    ])
    const limits = usage === undefined ? undefined : toLimits(usage)
    if (limits !== undefined) this.req.emit({ type: "limits.updated", at: Date.now(), engine: "kimi", limits })
    return toAccount(user)
  }

  logPath(): Promise<string | undefined> {
    return kimiLogPath(this.req.home, this.init.id)
  }

  async transcript(): Promise<{ items: readonly Item[]; total: number }> {
    return readKimiTranscript(this.lease.api, this.init.id)
  }

  pid(): number | undefined { return this.lease.pid() }

  capabilities(): EngineCapabilities {
    return {
      compact: true,
      attachments: true,
      steer: true,
      fork: true,
      rewind: false,
      modeReadback: true,
      sideQuestion: true,
      activity: true,
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.unlisten()
    this.asides.dispose()
    this.interactions.dispose()
    if (this.turn.hasActive()) await this.interrupt().catch(() => undefined)
    await this.stream.dispose()
    await this.lease.release().catch((error) => this.status("crashed", errorText(error)))
  }
}
