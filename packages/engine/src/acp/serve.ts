import type { ServerCall } from "../rpc.js"
import { handlePermission, type PermissionContext } from "./permission.js"
import type { TerminalHost } from "./terminal.js"

/**
 * **agent 反过来请求客户端时怎么答。**
 *
 * ACP 是双向的：除了 omni 调 agent，agent 也会调 omni——问审批
 *（`session/request_permission`）、以及认领了 `terminal/*` 之后让 omni 替它起进程。
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
    call.respond({ error: { code: -32601, message: `omni 未认领 ${call.method}` } })
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
      call.respond({ error: { code: -32603, message: error.message } })
    },
  )
  return true
}
