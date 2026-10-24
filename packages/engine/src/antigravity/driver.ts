import { NO_CAPABILITIES, type ModelOption, type Trust, type TurnId } from "@switchback/protocol"
import { DEFAULT_LOCALE } from "@switchback/i18n"
import type { EngineDriver, EngineSession, StartRequest, TrustChange } from "../contract.js"
import { localeOf } from "../locale.js"
import { probeCommand, resolveCommand } from "../probe.js"
import { Unsupported } from "../unsupported.js"
import { readModels } from "./models.js"
import { assertTrust } from "./options.js"
import { AntigravityTurn } from "./turn.js"
import { AGY_DRIVER } from "./driver.messages.js"

export function createAntigravityDriver(command = "agy"): EngineDriver {
  return {
    id: "antigravity",
    probe: (locale) => probeCommand(command, AGY_DRIVER[locale ?? DEFAULT_LOCALE].probeHint, locale),
    start: async (req) => {
      if (req.forkOf !== undefined) throw new Unsupported(AGY_DRIVER[localeOf(req)].noFork)
      assertTrust(req.trust, localeOf(req))
      const resolved = await resolveCommand(command)
      return new AntigravitySession(req, resolved)
    },
  }
}

class AntigravitySession implements EngineSession {
  readonly threadId: string
  private trust: Trust
  private conversation: string | undefined
  private model: string | undefined
  private active: AntigravityTurn | undefined
  private disposed = false
  private catalog: readonly ModelOption[] = []

  constructor(private readonly req: StartRequest, private readonly command: string) {
    this.threadId = req.threadId
    this.trust = req.trust
    this.conversation = req.resume
  }

  async activate(): Promise<void> {
    this.req.emit({ type: "engine.status", at: Date.now(), threadId: this.threadId, status: "ready" })
  }

  async prompt(prompt: string, turnId: TurnId, attachments?: readonly string[]): Promise<void> {
    const m = AGY_DRIVER[localeOf(this.req)]
    if (this.disposed) throw new Error(m.closed)
    if ((attachments?.length ?? 0) > 0) throw new Unsupported(m.textOnly)
    if (this.active !== undefined) throw new Error(m.busy)
    const turn = new AntigravityTurn(this.req, {
      command: this.command, prompt, turnId, trust: this.trust, locale: localeOf(this.req),
      conversation: this.conversation, model: this.model,
      onHandle: (handle) => {
        if (this.conversation === handle) return
        this.conversation = handle
        this.req.onHandle?.(handle)
      },
      onFinish: () => { if (this.active === turn) this.active = undefined },
    })
    this.active = turn
    try {
      turn.start()
      this.req.onTrustApply?.({ result: "applied", at: Date.now() })
    } catch (error) {
      this.active = undefined
      throw error
    }
  }

  pid(): number | undefined { return this.active?.pid() }
  capabilities() { return NO_CAPABILITIES }
  async interrupt(): Promise<void> { await this.active?.interrupt() }

  async setTrust(trust: Trust): Promise<TrustChange> {
    assertTrust(trust, localeOf(this.req))
    if (this.active !== undefined) throw new Unsupported(AGY_DRIVER[localeOf(this.req)].stopForTrust)
    this.trust = trust
    return { restart: false }
  }

  async models(): Promise<readonly ModelOption[]> {
    this.catalog = await readModels(this.command)
    return this.catalog
  }

  async setModel(model: string, effort?: string): Promise<{ effort?: string }> {
    const m = AGY_DRIVER[localeOf(this.req)]
    if (this.active !== undefined) throw new Unsupported(m.stopForModel)
    if (effort !== undefined) throw new Unsupported(m.effortInModel)
    if (this.catalog.length === 0) await this.models()
    if (!this.catalog.some((entry) => entry.id === model)) throw new Unsupported(m.noModel(model))
    this.model = model
    return {}
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await this.interrupt()
  }
}
