import type { Rule } from "@switchback/approval"
import type { Trust } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import type { RequestId, ServerCall } from "../rpc.js"
import { answerApproval } from "./approve.js"
import type { WireItem } from "./wire.js"

export interface ServerRequestDeps {
  inflight: Map<string, WireItem>
  cwd: string
  home: string
  trust: () => Trust
  memory: () => readonly Rule[]
  askUser: StartRequest["askUser"]
  askQuestion: StartRequest["askQuestion"]
}

export interface ServerRequests {
  answer: (call: ServerCall) => Promise<void>
  resolved: (id: RequestId) => void
  abortAll: () => void
}

/** 留住 app-server 反向 RPC 的取消柄，对端收口时不在宿主留死卡。 */
export function createServerRequests(deps: ServerRequestDeps): ServerRequests {
  const pending = new Map<string, AbortController>()

  const resolved = (id: RequestId): void => {
    const controller = pending.get(String(id))
    pending.delete(String(id))
    controller?.abort()
  }

  const abortAll = (): void => {
    const requests = [...pending.values()]
    pending.clear()
    for (const controller of requests) controller.abort()
  }

  const answer = async (call: ServerCall): Promise<void> => {
    const key = String(call.id)
    resolved(call.id)
    const controller = new AbortController()
    pending.set(key, controller)
    const guarded = {
      ...call,
      respond: (result: unknown) => {
        if (!controller.signal.aborted) call.respond(result)
      },
      reject: (error: Parameters<ServerCall["reject"]>[0]) => {
        if (!controller.signal.aborted) call.reject(error)
      },
    }
    try {
      await answerApproval(guarded, { ...deps, signal: controller.signal })
    } catch (error) {
      if (!controller.signal.aborted) {
        guarded.reject({
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      if (pending.get(key) === controller) pending.delete(key)
    }
  }

  return { answer, resolved, abortAll }
}
