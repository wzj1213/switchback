import { authMethodsOf, canLogout, type AcpAuthMethod } from "./auth.js"
import { initializeOnce, PROTOCOL_VERSION, withAcpProcess, type Initialized, type OneShotRequest } from "./oneshot.js"
import { startupMessage } from "./setup.js"
import type { AcpInitialize } from "./wire.js"

/**
 * 试着和一个可执行文件握一次 ACP 的手。
 *
 * ## 这件事为什么值得单独做
 *
 * 「这台机器上有没有一个能用的 agent」——Switchback 原来只能靠**猜命令名**回答，
 * 而猜不出来的那些（ZCode 之类）只能让人手写 `engines.json`：写对了才知道对，
 * 写错了得到的是一条起不来的会话，而错在哪不知道。
 *
 * **ACP 是有协议的，这个问题它自己能回答。** 你指一个可执行文件，
 * 我们发一次 `initialize`——它答得上来就是能用的，答不上来的原因也是它自己说的。
 * 命令和参数由用户给，能力由握手探到，**没有一条是 Switchback 编的**。
 *
 * ## 为什么只到 initialize 为止
 *
 * 再往下就要 `session/new`，那会在用户的工作区里真的开一条会话、
 * 起一个可能开始干活的 agent。**试接不该有副作用**——`initialize` 是纯问答，
 * 而它已经足够回答「这是不是一个讲 ACP 的东西」。
 */
export interface AcpTrial {
  ok: boolean
  /** 它自报的协议版本。Switchback 只认到 v1（见 `open.ts`）。 */
  protocolVersion?: number
  /** 它认领了哪几件事。**原样列出，不翻译也不补全**——没声明只是没声明。 */
  capabilities?: readonly string[]
  /** 失败时那句话。照 `Probe.detail` 的规矩：必须说得出下一步做什么。 */
  error?: string
  /** 它自己打到 stderr 的尾巴。**失败时这常常是唯一的线索**，别吞掉。 */
  stderr?: string
  /**
   * 它报的登录方式，按它报的顺序。**只列、不办**——试接没有副作用，
   * 登录要人挑了才去做（见 `login.ts`）。
   */
  authMethods?: readonly AcpAuthMethod[]
  /** 它认不认 `logout`。 */
  logout?: boolean
  /** 它自报的名字与版本（`agentInfo`），原样。 */
  agent?: { name?: string; title?: string; version?: string }
}

/** 试接比开会话短得多：这里只发一个 `initialize`，起得来的话是毫秒级。 */
const TRY_MS = 8000

/**
 * 它认领的能力，摊平成一串键。
 *
 * ## 为什么必须往里再走一层
 *
 * 上一版只列顶层键，于是 kimi 那种报
 * `{loadSession, promptCapabilities:{...}, sessionCapabilities:{list,resume,close,delete,fork}}`
 * 的会被折成 `loadSession / promptCapabilities / sessionCapabilities` 三个词——
 * **真正有用的那几个（fork、resume、list）全丢在里面了**，而它们正好对应
 * Switchback 界面上的分叉、续接、历史。摊平一层，前缀保留方法名的样子
 *（`session/fork`），方便对着它自己的文档查。
 *
 * ## 「存在即支持」
 *
 * `sessionCapabilities` 用空对象当标记（见 `wire.ts`），所以判据是**键在不在**，
 * 不是值真不真。`promptCapabilities` 相反，是实打实的布尔——`audio: false`
 * 是「明确说了不支持」，不能跟着列出来。两种语义不一样，分开处理。
 *
 * 一个字都不补：**没声明只是没声明**。ACP 里 `session/compact` 与 `session/steer`
 * 就没有对应的声明位（实测的几家也都没往 `sessionCapabilities` 里写），
 * 所以那两位在 `engines.json` 里仍然只能手填，见 `caps.ts` 那段复测记录。
 */
function claimed(info: AcpInitialize): readonly string[] {
  const caps = info.agentCapabilities
  if (caps === undefined || typeof caps !== "object") return []
  const out: string[] = []
  if (caps.loadSession === true) out.push("loadSession")
  for (const [key, value] of Object.entries(caps.promptCapabilities ?? {})) {
    if (value === true) out.push(`prompt:${key}`)
  }
  for (const key of Object.keys(caps.sessionCapabilities ?? {})) out.push(`session/${key}`)
  return out
}

export async function tryAcp(req: OneShotRequest & {
  /** 等多久算不答。默认 `TRY_MS`；注册表里 npx 分发的第一次要现下载，调用方会给长一些。 */
  timeoutMs?: number
  /** 人点了「取消」。进程照常回收。 */
  signal?: AbortSignal
}): Promise<AcpTrial> {
  const budget = req.timeoutMs ?? TRY_MS
  const tail = { stderr: "" }
  try {
    return await withAcpProcess(req, async (shot) => {
      const result = await initializeOnce(shot, budget, req.signal)
      tail.stderr = shot.stderr()
      return verdict(result, req.command, tail.stderr, budget)
    })
  } catch (error) {
    // 对方答了但答的是错误（JSON-RPC error），或者进程中途关了流
    return fail(error instanceof Error ? error.message : String(error), tail.stderr)
  }
}

function verdict(result: Initialized, command: string, stderr: string, budget: number): AcpTrial {
  if (result.kind === "aborted") return { ok: false, error: "已取消。" }
  if (result.kind === "timeout") {
    return fail(
      `${String(Math.round(budget / 1000))} 秒内没有回应。它可能不讲 ACP，或者要换一组参数才进 ACP 模式（有几家是 \`<命令> acp\` 或 \`<命令> agent stdio\`）。`,
      stderr,
    )
  }
  if (result.kind === "died") return fail(startupMessage(command, result.error), stderr)
  const info = result.info
  const version = info.protocolVersion
  if (version !== undefined && version > PROTOCOL_VERSION) {
    return fail(
      `它讲的是 ACP v${String(version)}，Switchback 只认到 v${String(PROTOCOL_VERSION)}。请升级 Switchback。`,
      stderr,
    )
  }
  const agent = info.agentInfo
  return {
    ok: true,
    ...(version === undefined ? {} : { protocolVersion: version }),
    capabilities: claimed(info),
    authMethods: authMethodsOf(info),
    logout: canLogout(info),
    ...(agent === undefined ? {} : { agent: { ...agent } }),
    ...(stderr === "" ? {} : { stderr }),
  }
}

function fail(error: string, stderr: string): AcpTrial {
  return { ok: false, error, ...(stderr === "" ? {} : { stderr }) }
}
