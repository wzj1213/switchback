import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { sessionPath, type KimiApi } from "./http.js"
import { KIMI_ASIDE } from "./aside.messages.js"
import type { KimiPayload, KimiPrompt } from "./wire.js"

interface Waiting {
  text: string
  resolve: (answer: string) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const ASIDE_MS = 180_000

function errorOf(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw
  if (typeof raw !== "object" || raw === null) return undefined
  const message = (raw as { message?: unknown }).message
  return typeof message === "string" ? message : undefined
}

export class KimiAsides {
  private readonly waiting = new Map<string, Waiting>()

  constructor(
    private readonly api: KimiApi,
    private readonly sessionId: string,
    private readonly locale: () => Locale = () => DEFAULT_LOCALE,
  ) {}

  async ask(text: string): Promise<string> {
    const started = await this.api.post<{ agent_id: string }>(sessionPath(this.sessionId, ":btw"), {})
    const answer = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => this.finish(started.agent_id, new Error(KIMI_ASIDE[this.locale()].timeout)), ASIDE_MS)
      this.waiting.set(started.agent_id, { text: "", resolve, reject, timer })
    })
    try {
      const prompt = await this.api.post<KimiPrompt>(sessionPath(this.sessionId, "/prompts"), {
        agent_id: started.agent_id,
        content: [{ type: "text", text }],
      })
      if (prompt.status !== "running") throw new Error(KIMI_ASIDE[this.locale()].notStarted(prompt.status))
    } catch (error) {
      this.finish(started.agent_id, error instanceof Error ? error : new Error(String(error)))
    }
    return answer
  }

  handle(payload: KimiPayload): boolean {
    const agentId = payload.agentId
    const waiting = agentId === undefined ? undefined : this.waiting.get(agentId)
    if (agentId === undefined || waiting === undefined) return false
    if (payload.type === "assistant.delta" && payload.delta !== undefined) waiting.text += payload.delta
    if (payload.type === "turn.ended") {
      const error = payload.reason === "completed" ? undefined : new Error(errorOf(payload.error) ?? KIMI_ASIDE[this.locale()].unfinished)
      this.finish(agentId, error)
    }
    return true
  }

  private finish(agentId: string, error?: Error): void {
    const waiting = this.waiting.get(agentId)
    if (waiting === undefined) return
    this.waiting.delete(agentId)
    clearTimeout(waiting.timer)
    if (error === undefined && waiting.text.trim() === "") waiting.reject(new Error(KIMI_ASIDE[this.locale()].noText))
    else if (error === undefined) waiting.resolve(waiting.text)
    else waiting.reject(error)
  }

  dispose(): void {
    for (const id of [...this.waiting.keys()]) this.finish(id, new Error(KIMI_ASIDE[this.locale()].closing))
  }
}
