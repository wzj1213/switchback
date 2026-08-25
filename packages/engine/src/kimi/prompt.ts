import type { SlashCommand, TurnId } from "@omni/protocol"
import { promptContent } from "./attach.js"
import type { KimiApi } from "./http.js"
import { sessionPath } from "./http.js"
import { KimiSkills } from "./skill.js"
import type { KimiTurnTracker } from "./turn.js"
import type { KimiPrompt } from "./wire.js"

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class KimiPrompter {
  private readonly skills: KimiSkills

  constructor(
    private readonly api: KimiApi,
    private readonly sessionId: string,
    private readonly turn: KimiTurnTracker,
  ) {
    this.skills = new KimiSkills(api, sessionId)
  }

  commands(): Promise<readonly SlashCommand[]> {
    return this.skills.commands()
  }

  async prompt(text: string, turnId: TurnId, attachments?: readonly string[]): Promise<void> {
    const generation = this.turn.begin(turnId, text)
    try {
      const invocation = await this.skills.resolve(text)
      if (invocation !== undefined) {
        await this.skills.activate(invocation, attachments)
        this.turn.activationAccepted(generation)
        return
      }
      const content = await promptContent(text, attachments)
      const prompt = await this.api.post<KimiPrompt>(sessionPath(this.sessionId, "/prompts"), { content })
      if (prompt.status === "blocked") {
        this.turn.promptAccepted(generation, prompt.prompt_id)
        this.turn.failGeneration(generation, "Prompt hook blocked the request.")
        return
      }
      if (prompt.status !== "running") {
        await this.cancel(prompt.prompt_id)
        throw new Error(`Kimi 没有开始这一轮（状态：${prompt.status}）`)
      }
      this.turn.promptAccepted(generation, prompt.prompt_id)
    } catch (error) {
      this.turn.failGeneration(generation, errorText(error))
      throw error
    }
  }

  async steer(text: string, attachments?: readonly string[]): Promise<void> {
    const generation = this.turn.currentGeneration()
    if (generation === undefined) throw new Error("Kimi 没有正在运行的轮次，无法改向")
    const content = await promptContent(text, attachments)
    const prompt = await this.api.post<KimiPrompt>(sessionPath(this.sessionId, "/prompts"), { content })
    if (prompt.status !== "queued" || !this.turn.isActive(generation)) {
      await this.cancel(prompt.prompt_id)
      throw new Error("Kimi 的上一轮刚好已经结束，这句话改为排队发送")
    }
    try {
      await this.api.post(sessionPath(this.sessionId, "/prompts:steer"), { prompt_ids: [prompt.prompt_id] })
    } catch (error) {
      await this.cancel(prompt.prompt_id)
      throw error
    }
  }

  private async cancel(promptId: string): Promise<void> {
    try {
      await this.api.post(sessionPath(this.sessionId, `/prompts/${encodeURIComponent(promptId)}:abort`))
    } catch (error) {
      try {
        await this.api.post(sessionPath(this.sessionId, ":abort"), {})
      } catch {
        throw error
      }
    }
  }
}
