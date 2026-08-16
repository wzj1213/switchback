import type { EngineStatus, Event } from "@omni/protocol"
import type { RpcPeer } from "../rpc.js"
import { emitLimits } from "./notify.js"
import type { WireRateLimits } from "./wire.js"

/**
 * 账号侧的现状：额度还剩多少、登没登录。**握手完主动问一次。**
 *
 * ## 为什么不能只等推送
 *
 * codex 会推 `account/rateLimits/updated`，但那是**跑完一轮才推的**。
 * 也就是说：额度早就用光了、或者压根没登录，omni 却一个字不说，
 * 等你打完一整段话按下回车，才回一句英文的
 * `You've hit your usage limit`。那时这条信息已经晚了——
 * 「还能不能干活」本来就该在动手之前知道。（实测撞到过。）
 *
 * ## 为什么全都不 await、失败一律静默
 *
 * 这两件事是锦上添花，**它们慢一点、或者问不出来，都不该拖着会话起不来**。
 * 问不出额度和「这个账号不受额度限制」在界面上是同一种表现（什么都不画），
 * 所以静默是对的，不是偷懒。
 */
export function reportAccount(
  rpc: RpcPeer,
  status: (status: EngineStatus, detail?: string) => void,
  emit: (event: Event) => void,
): void {
  void rpc
    .call("account/rateLimits/read", {})
    .then((raw) => {
      emitLimits(emit, (raw as { rateLimits?: WireRateLimits } | undefined)?.rateLimits)
    })
    .catch(() => undefined)
  void rpc
    .call("getAuthStatus", {})
    .then((raw) => {
      const why = notSignedIn(raw)
      if (why !== undefined) status("degraded", why)
    })
    .catch(() => undefined)
}

/**
 * 没登录吗。
 *
 * 判据是实测出来的（拿一个空的 `CODEX_HOME` 模拟登出）：
 * 登录时 `authMethod: "chatgpt"`，登出时 `authMethod: null`，
 * 而 `requiresOpenaiAuth` **两种情况都是 true**——所以不能只看后者。
 */
function notSignedIn(raw: unknown): string | undefined {
  const auth = raw as { authMethod?: string | null; requiresOpenaiAuth?: boolean } | undefined
  if (auth?.requiresOpenaiAuth !== true) return undefined
  const method = auth.authMethod
  if (method !== null && method !== undefined && method !== "") return undefined
  return "codex 还没登录，这个会话发什么都会失败。在终端里跑 `codex login`，然后重开一个会话。"
}
