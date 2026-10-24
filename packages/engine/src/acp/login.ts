import { authMethodsOf, canLogout, type AcpAuthMethod } from "./auth.js"
import { abortedBy, initializeOnce, sleep, withAcpProcess, type OneShot, type OneShotRequest } from "./oneshot.js"
import { startupMessage } from "./setup.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { ACP_LOGIN } from "./login.messages.js"
import { ACP_ONESHOT } from "./oneshot.messages.js"

/**
 * 替人把「我要用这种方式登录」转给 agent。
 *
 * **只做转达。** 开浏览器、收 OAuth 回调、存凭证全是 agent 自己的事（协议里 `agent` 型的定义），
 * Switchback 连凭证长什么样都看不见。所以这里的全部工作是：起一个进程、握手、
 * 发 `authenticate`、等它办完、收掉进程。它把凭证存在自己那儿，之后开的会话自然就是登录过的。
 *
 * terminal 型不走这里：协议明说客户端**不得**把它发给 `authenticate`，
 * 那一种要在真终端里跑它自己的登录界面，见 `terminalLoginOf`。
 */
export interface AcpLoginResult {
  ok: boolean
  /** 失败时那句话。它自己说的原样带上，后面补一句下一步。 */
  error?: string
  stderr?: string
}

const HANDSHAKE_MS = 30_000
/** 人要在浏览器里走完一整套登录。给足，但不能无限——卡住的登录也得有个头。 */
const LOGIN_MS = 5 * 60_000

type Outcome = { done: unknown } | { failed: Error } | { died: Error } | "timeout" | "aborted"

async function settle(
  shot: OneShot,
  call: Promise<unknown>,
  limit: { ms: number; signal?: AbortSignal },
): Promise<Outcome> {
  return Promise.race([
    call.then((done) => ({ done }), (error: unknown) => ({ failed: error instanceof Error ? error : new Error(String(error)) })),
    shot.died.then((error) => ({ died: error })),
    sleep(limit.ms).then(() => "timeout" as const),
    abortedBy(limit.signal),
  ])
}

function outcomeText(outcome: Outcome, command: string, locale: Locale): string | undefined {
  if (outcome === "timeout") return ACP_LOGIN[locale].timeout
  if (outcome === "aborted") return ACP_ONESHOT[locale].cancelled
  if ("died" in outcome) return startupMessage(command, outcome.died, locale)
  if ("failed" in outcome) return ACP_LOGIN[locale].failed(outcome.failed.message)
  return undefined
}

/** 握手后找到那一种。**以它这一次报的为准**——换过版本的 agent 可能已经不认旧的 id。 */
async function methodFrom(
  shot: OneShot,
  req: OneShotRequest & { methodId: string },
): Promise<{ method?: AcpAuthMethod; logout: boolean; error?: string }> {
  const locale = req.locale ?? DEFAULT_LOCALE
  const init = await initializeOnce(shot, HANDSHAKE_MS)
  if (init.kind === "timeout") return { logout: false, error: ACP_LOGIN[locale].loginHandshake }
  if (init.kind === "died") return { logout: false, error: startupMessage(req.command, init.error, locale) }
  if (init.kind === "aborted") return { logout: false, error: ACP_ONESHOT[locale].cancelled }
  const method = authMethodsOf(init.info).find((one) => one.id === req.methodId)
  return { logout: canLogout(init.info), ...(method === undefined ? {} : { method }) }
}

type LoginRequest = OneShotRequest & { methodId: string; signal?: AbortSignal; timeoutMs?: number }

async function authenticateIn(shot: OneShot, req: LoginRequest): Promise<AcpLoginResult> {
  const locale = req.locale ?? DEFAULT_LOCALE
  const found = await methodFrom(shot, req)
  if (found.error !== undefined) return { ok: false, error: found.error }
  if (found.method === undefined) return { ok: false, error: ACP_LOGIN[locale].noMethod(req.methodId) }
  if (found.method.kind === "terminal") return { ok: false, error: ACP_LOGIN[locale].terminalOnly }
  const outcome = await settle(shot, shot.rpc.call("authenticate", { methodId: req.methodId }), {
    ms: req.timeoutMs ?? LOGIN_MS,
    ...(req.signal === undefined ? {} : { signal: req.signal }),
  })
  const error = outcomeText(outcome, req.command, locale)
  return error === undefined ? { ok: true } : { ok: false, error }
}

export async function acpAuthenticate(req: LoginRequest): Promise<AcpLoginResult> {
  return withAcpProcess(req, async (shot) => {
    const result = await authenticateIn(shot, req)
    const stderr = shot.stderr()
    // 失败时它自己打的那几行是唯一的线索；成功了就不必摊出来
    return result.ok || stderr === "" ? result : { ...result, stderr }
  }).catch((error: unknown): AcpLoginResult => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
}

/** 退出登录。**只对报了 `auth.logout` 的发**——没报就照实说不认，不去撞一个 `-32601`。 */
export async function acpLogout(req: OneShotRequest): Promise<AcpLoginResult> {
  const locale = req.locale ?? DEFAULT_LOCALE
  return withAcpProcess(req, async (shot): Promise<AcpLoginResult> => {
    const init = await initializeOnce(shot, HANDSHAKE_MS)
    if (init.kind === "timeout") return { ok: false, error: ACP_LOGIN[locale].logoutHandshake }
    if (init.kind === "died") return { ok: false, error: startupMessage(req.command, init.error, locale) }
    if (init.kind === "aborted") return { ok: false, error: ACP_ONESHOT[locale].cancelled }
    if (!canLogout(init.info)) return { ok: false, error: ACP_LOGIN[locale].noLogout }
    const outcome = await settle(shot, shot.rpc.call("logout", {}), { ms: HANDSHAKE_MS })
    const error = outcomeText(outcome, req.command, locale)
    return error === undefined ? { ok: true } : { ok: false, error }
  }).catch((error: unknown): AcpLoginResult => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
}

/**
 * terminal 型登录在终端里要跑的那一整条。**纯函数**：怎么打开终端是桌面的事。
 *
 * - 新写法：它自己的启动命令 + 启动参数 + 这一种的 `args`（协议原文「append」），
 *   环境是启动环境叠上这一种的 `env`。
 * - 旧写法（`_meta["terminal-auth"]`）直接给了整条命令：用它的命令与参数，不再拼启动参数。
 */
export function terminalLoginOf(
  launch: { command: string; args?: readonly string[]; env?: Readonly<Record<string, string>> },
  method: AcpAuthMethod,
): { command: string; args: readonly string[]; env: Readonly<Record<string, string>> } {
  const env = { ...(launch.env ?? {}), ...(method.env ?? {}) }
  if (method.command !== undefined) return { command: method.command, args: method.args ?? [], env }
  return { command: launch.command, args: [...(launch.args ?? []), ...(method.args ?? [])], env }
}
