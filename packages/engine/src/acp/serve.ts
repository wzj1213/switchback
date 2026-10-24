import type { Trust } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { localeOf } from "../locale.js"
import type { ServerCall } from "../rpc.js"
import { handlePermission, type PermissionContext } from "./permission.js"
import { createTerminalHost, type TerminalHost } from "./terminal.js"
import type { AcpDriverConfig } from "./caps.js"
import type { AcpToolCall } from "./wire.js"
import { createForeignInteractionCalls } from "./interaction.js"
import { mine } from "./route.js"

/**
 * **agent 反过来请求客户端时怎么答。**
 *
 * ACP 是双向的：除了 Switchback 调 agent，agent 也会调 Switchback——问审批
 *（`session/request_permission`）、以及认领了 `terminal/*` 之后让 Switchback 替它起进程。
 *
 * 单独一个文件的理由和 `route.ts` 一样：驱动那边回答的是「收到这条要做什么」，
 * 这边回答的是「**我们认领了什么、没认领的怎么拒**」。这两件事的判据不同，
 * 而且这一层还会长——ACP 的客户端方法一直在加。
 *
 * 直接理由仍是行数闸门：`driver.ts` 加完 terminal 是 301/300。
 */

export interface AnswerCtx {
  /** 认领了 `terminal/*` 才有。**没认领就是 undefined**，那类请求照旧回 -32601。 */
  terminal: TerminalHost | undefined
  permission: () => PermissionContext
}

export interface AcpClientCalls {
  answer: (call: ServerCall) => Promise<void>
  resolved: (method: string, params: unknown) => void
  /** 按停止：挂着的权限请求一律回 `cancelled`，宿主那边的卡跟着收成「已失效」。 */
  cancelPermissions: () => void
  dispose: () => void
}

interface ClientCallDeps {
  req: StartRequest
  config: AcpDriverConfig
  inflight: Map<string, AcpToolCall>
  outside?: Map<string, AcpToolCall>
  trust: () => Trust
  sessionId: () => string | undefined
}

/** 一条 ACP 连接上 agent 反向调用宿主的全部入口与等待账本。 */
export function createAcpClientCalls(deps: ClientCallDeps): AcpClientCalls {
  const { req, config } = deps
  const terminal = config.terminal === true ? createTerminalHost(req.cwd) : undefined
  const interactions = createForeignInteractionCalls(req.askQuestion)
  const permissions = new Set<AbortController>()
  const permission = (signal?: AbortSignal): PermissionContext => ({
    engine: config.id,
    cwd: req.cwd,
    home: req.home,
    trust: deps.trust,
    memory: req.memory,
    locale: () => localeOf(req),
    inflight: deps.inflight,
    ...(deps.outside === undefined ? {} : { outside: deps.outside }),
    askUser: req.askUser,
    ...(signal === undefined ? {} : { signal }),
  })
  const answer = async (call: ServerCall): Promise<void> => {
    const interaction = config.interaction?.(call.method, call.params, localeOf(req))
    if (interaction === undefined) {
      const controller = new AbortController()
      permissions.add(controller)
      try {
        await answerCall({ terminal, permission: () => permission(controller.signal) }, call)
      } finally {
        permissions.delete(controller)
      }
      return
    }
    if (!mine(interaction.sessionId, deps.sessionId())) {
      call.reject({ code: -32602, message: `${call.method} 属于另一条会话` }) // i18n-ok：回给引擎进程的协议错误，不上界面
      return
    }
    await interactions.answer(call, interaction)
  }
  const resolved = (method: string, params: unknown): void => {
    const key = config.interactionResolved?.(method, params)
    if (key !== undefined) interactions.resolved(key)
  }
  const cancelPermissions = (): void => {
    for (const controller of [...permissions]) controller.abort()
  }
  const dispose = (): void => {
    cancelPermissions()
    interactions.abortAll()
    terminal?.disposeAll()
  }
  return { answer, resolved, cancelPermissions, dispose }
}

/**
 * 每一条都必须答——**不答 agent 会一直等，整轮卡死**。
 *
 * 认不出的请求回 JSON-RPC 的 method-not-found，而不是空对象：ACP 的客户端方法是
 * **能力协商**出来的，我们没认领却收到这类请求，说明对方没看能力表。
 * 回一个空对象会让它以为办成了，回错误码它才知道没有。
 */
export async function answerCall(ctx: AnswerCtx, call: ServerCall): Promise<void> {
  if (serveTerminal(ctx.terminal, call)) return
  if (call.method !== "session/request_permission") {
    call.reject({ code: -32601, message: `Switchback 未认领 ${call.method}` }) // i18n-ok：回给引擎进程的协议错误，不上界面
    return
  }
  await handlePermission(ctx.permission(), call)
}

/**
 * 这条请求归终端管吗；管就接手并应答，返回 `true`。
 *
 * 应答的形状（含出错时包成 JSON-RPC error）和「认领了什么」放在一起：
 * **那是同一件事的两半**，分开写迟早对不上。
 */
function serveTerminal(host: TerminalHost | undefined, call: ServerCall): boolean {
  const result = host?.handle(call.method, call.params)
  if (result === undefined) return false
  void result.then(
    (value) => {
      call.respond(value)
    },
    (error: Error) => {
      call.reject({ code: -32603, message: error.message })
    },
  )
  return true
}
