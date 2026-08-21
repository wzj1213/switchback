import type { EngineAccount, EngineCapabilities, EngineThread, Item, ModelOption, SlashCommand, Trust, TurnId } from "@omni/protocol"
import type { EngineSession, StartRequest, TrustChange } from "../contract.js"
import { KimiAsides } from "./aside.js"
import { toAccount, toHistory, toLimits, toModels, type OAuthUsage } from "./catalog.js"
import { sessionPath } from "./http.js"
import { readKimiTranscript } from "./history.js"
import { KimiInteractions } from "./interactions.js"
import { kimiLogPath } from "./log.js"
import { KimiPrompter } from "./prompt.js"
import type { KimiLease } from "./server.js"
import { KimiStateReporter } from "./state.js"
import { KimiStream, type KimiCursor } from "./stream.js"
import { KIMI_TRUST } from "./trust.js"
import { handleTurnEvent, KimiTurnTracker } from "./turn.js"
import type { KimiFrame, KimiModel, KimiSessionRow, KimiSnapshot, KimiStatus } from "./wire.js"

interface ConfigResponse {
  default_model?: string
}

interface SessionInit {
  id: string
  status: KimiStatus
  snapshot: KimiSnapshot
}

function eventAt(frame: KimiFrame): number {
  const at = frame.timestamp === undefined ? Number.NaN : new Date(frame.timestamp).getTime()
  return Number.isNaN(at) ? Date.now() : at
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class KimiSession implements EngineSession {
  private readonly trust: { current: Trust }
  private readonly turn: KimiTurnTracker
  private readonly reporter: KimiStateReporter
  private readonly prompter: KimiPrompter
  private readonly interactions: KimiInteractions
  private readonly asides: KimiAsides
  private readonly stream: KimiStream
  private readonly unlisten: () => void
  private options: readonly ModelOption[] = []
  private disposed = false

  constructor(
    private readonly req: StartRequest,
    private readonly lease: KimiLease,
    private readonly init: SessionInit,
  ) {
    this.trust = { current: req.trust }
    this.turn = new KimiTurnTracker({ emit: req.emit, now: () => Date.now() })
    this.prompter = new KimiPrompter(lease.api, init.id, this.turn)
    this.reporter = new KimiStateReporter(req, () => this.trust.current)
    this.interactions = new KimiInteractions({
      api: lease.api,
      sessionId: init.id,
      req,
      trust: () => this.trust.current,
      onError: (message) => this.status("degraded", `Kimi 交互请求应答失败：${message}`),
      onQuestion: (message) => this.unsupportedQuestion(message),
    })
    this.asides = new KimiAsides(lease.api, init.id)
    this.stream = new KimiStream({
      wsUrl: lease.wsUrl,
      protocol: lease.protocol,
      sessionId: init.id,
      cursor: this.cursorOf(init.snapshot),
      onFrame: (frame) => this.onFrame(frame),
      onResync: () => this.resync(),
      onDisconnect: () => this.status("degraded", "Kimi 实时连接已中断，正在从会话快照恢复…"),
      onRecovered: () => this.status("ready"),
      onFatal: (error) => this.crashed(`Kimi 实时连接无法恢复：${error.message}`),
    })
    this.unlisten = lease.onCrash((detail) => this.crashed(detail))
  }

  async start(): Promise<void> {
    this.req.onHandle?.(this.init.id)
    this.reporter.status(this.init.status)
    this.reporter.persisted(this.init.snapshot.session.usage)
    this.takeInteractions(this.init.snapshot)
    await this.stream.connect()
    this.status("ready")
  }

  get threadId(): StartRequest["threadId"] {
    return this.req.threadId
  }

  private status(status: "ready" | "degraded" | "crashed", detail?: string): void {
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

  private unsupportedQuestion(message: string): void {
    this.status(
      "degraded",
      `Kimi 提了一个当前 omni 还不能呈现的结构化问题，已按原生“跳过”处理：${message}`,
    )
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
    for (const approval of snapshot.pending_approvals) this.interactions.approval(approval)
    for (const question of snapshot.pending_questions) this.interactions.question(question)
  }

  private async resync(): Promise<KimiCursor> {
    const snapshot = await this.lease.api.get<KimiSnapshot>(sessionPath(this.init.id, "/snapshot"))
    this.turn.reconcile(snapshot)
    this.reporter.persisted(snapshot.session.usage)
    this.takeInteractions(snapshot)
    return this.cursorOf(snapshot)
  }

  private onFrame(frame: KimiFrame): void {
    const payload = frame.payload
    if (payload === undefined || this.asides.handle(payload)) return
    if (payload.agentId !== undefined && payload.agentId !== "main") return
    if (payload.type === "agent.status.updated") this.reporter.event(payload)
    if (payload.type === "event.approval.requested") this.interactions.approval(payload)
    if (payload.type === "event.question.requested") this.interactions.question(payload)
    handleTurnEvent(this.turn, payload, eventAt(frame))
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
      this.lease.api.get<ConfigResponse>("config").catch((): ConfigResponse => ({})),
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

  async commands(): Promise<readonly SlashCommand[]> {
    return this.prompter.commands()
  }

  async compact(): Promise<void> {
    await this.lease.api.post(sessionPath(this.init.id, ":compact"), {})
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

  capabilities(): EngineCapabilities {
    return { compact: true, attachments: true, steer: true, fork: true, modeReadback: true, sideQuestion: true }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.unlisten()
    this.asides.dispose()
    if (this.turn.hasActive()) await this.interrupt().catch(() => undefined)
    await this.stream.dispose()
    await this.lease.release().catch((error) => this.status("crashed", errorText(error)))
  }
}
