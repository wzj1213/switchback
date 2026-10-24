import type { EngineStatus, Event } from "@switchback/protocol"
import type { RpcPeer } from "../rpc.js"
import { emitLimits } from "./limits.js"
import type { WireRateLimits } from "./wire.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { CODEX_ACCOUNT } from "./account.messages.js"

/**
 * 账号侧的现状：额度还剩多少、登没登录。**握手完主动问一次。**
 *
 * ## 为什么不能只等推送
 *
 * codex 会推 `account/rateLimits/updated`，但那是**跑完一轮才推的**。
 * 也就是说：额度早就用光了、或者压根没登录，Switchback 却一个字不说，
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
  locale: Locale = DEFAULT_LOCALE,
): void {
  void rpc
    .call("account/rateLimits/read")
    .then((raw) => {
      emitLimits(emit, (raw as { rateLimits?: WireRateLimits } | undefined)?.rateLimits, "snapshot")
    })
    .catch(() => undefined)
  void rpc
    .call("account/read", { refreshToken: false })
    .then((raw) => {
      const why = notSignedIn(raw, locale)
      if (why !== undefined) status("degraded", why)
    })
    .catch(() => undefined)
}

/**
 * 没登录吗。
 *
 * 0.149.0 的公开 v2 形状：登录态在 `account`，登出是 null；
 * `requiresOpenaiAuth` 只说明这套 provider 是否要求 OpenAI 登录。
 */
function notSignedIn(raw: unknown, locale: Locale): string | undefined {
  const auth = raw as { account?: unknown; requiresOpenaiAuth?: boolean } | undefined
  if (auth?.requiresOpenaiAuth !== true) return undefined
  if (auth.account !== null && auth.account !== undefined) return undefined
  return CODEX_ACCOUNT[locale].signedOut
}
