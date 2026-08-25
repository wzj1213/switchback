import type { StartRequest } from "../contract.js"
import type { ServerCall } from "../rpc.js"
import type { ForeignInteraction } from "./caps.js"

export interface ForeignInteractionCalls {
  answer: (call: ServerCall, interaction: ForeignInteraction) => Promise<void>
  resolved: (key: string) => void
  abortAll: () => void
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** 私有交互与宿主问题卡之间的等待账本；一条原生身份只保留最后一次投影。 */
export function createForeignInteractionCalls(
  askQuestion: StartRequest["askQuestion"],
): ForeignInteractionCalls {
  const pending = new Map<string, AbortController>()

  const resolved = (key: string): void => {
    const controller = pending.get(key)
    pending.delete(key)
    controller?.abort()
  }

  const abortAll = (): void => {
    const controllers = [...pending.values()]
    pending.clear()
    for (const controller of controllers) controller.abort()
  }

  const answer = async (call: ServerCall, interaction: ForeignInteraction): Promise<void> => {
    resolved(interaction.key)
    if (interaction.questions.length === 0) {
      call.reject({ code: -32602, message: `${call.method} 没有可呈现的问题` })
      return
    }
    const controller = new AbortController()
    pending.set(interaction.key, controller)
    try {
      const response = await askQuestion(interaction.questions, { signal: controller.signal })
      if (!controller.signal.aborted) call.respond(interaction.reply(response))
    } catch (error) {
      if (!controller.signal.aborted) call.reject({ code: -32603, message: messageOf(error) })
    } finally {
      if (pending.get(interaction.key) === controller) pending.delete(interaction.key)
    }
  }

  return { answer, resolved, abortAll }
}
