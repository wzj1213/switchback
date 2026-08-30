import { createProcessOwner } from "../subprocess.js"
import { resolveCommand } from "../probe.js"
import { createRpc } from "../rpc.js"
import { startupMessage } from "./setup.js"
import type { AcpInitialize } from "./wire.js"

/**
 * 试着和一个可执行文件握一次 ACP 的手。
 *
 * ## 这件事为什么值得单独做
 *
 * 「这台机器上有没有一个能用的 agent」——omni 原来只能靠**猜命令名**回答，
 * 而猜不出来的那些（ZCode 之类）只能让人手写 `engines.json`：写对了才知道对，
 * 写错了得到的是一条起不来的会话，而错在哪不知道。
 *
 * **ACP 是有协议的，这个问题它自己能回答。** 你指一个可执行文件，
 * 我们发一次 `initialize`——它答得上来就是能用的，答不上来的原因也是它自己说的。
 * 命令和参数由用户给，能力由握手探到，**没有一条是 omni 编的**。
 *
 * ## 为什么只到 initialize 为止
 *
 * 再往下就要 `session/new`，那会在用户的工作区里真的开一条会话、
 * 起一个可能开始干活的 agent。**试接不该有副作用**——`initialize` 是纯问答，
 * 而它已经足够回答「这是不是一个讲 ACP 的东西」。
 */
export interface AcpTrial {
  ok: boolean
  /** 它自报的协议版本。omni 只认到 v1（见 `open.ts`）。 */
  protocolVersion?: number
  /** 它认领了哪几件事。**原样列出，不翻译也不补全**——没声明只是没声明。 */
  capabilities?: readonly string[]
  /** 失败时那句话。照 `Probe.detail` 的规矩：必须说得出下一步做什么。 */
  error?: string
  /** 它自己打到 stderr 的尾巴。**失败时这常常是唯一的线索**，别吞掉。 */
  stderr?: string
}

const PROTOCOL_VERSION = 1
const CLIENT_INFO = { name: "omni", title: "omni 同文", version: "0.1.0" }
/** 试接比开会话短得多：这里只发一个 `initialize`，起得来的话是毫秒级。 */
const TRY_MS = 8000
const STDERR_KEEP = 4000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 它认领的能力键。**只列它自己写了的**，值为假的也算「提到了」——那是两种不同的信息。 */
function claimed(info: AcpInitialize): readonly string[] {
  const caps = info.agentCapabilities
  if (caps === undefined || typeof caps !== "object") return []
  return Object.entries(caps)
    .filter(([, value]) => value === true || (typeof value === "object" && value !== null))
    .map(([key]) => key)
}

export async function tryAcp(req: {
  command: string
  args?: readonly string[]
  env?: Readonly<Record<string, string | undefined>>
  cwd: string
  /** 等多久算不答。**只为测试可注入**——真用的时候就是 `TRY_MS`。 */
  timeoutMs?: number
}): Promise<AcpTrial> {
  const budget = req.timeoutMs ?? TRY_MS
  const owner = createProcessOwner()
  let stderr = ""
  const rpc = createRpc({
    send: (line) => child.stdin?.write(`${line}\n`),
    onNotification: () => undefined,
    // 试接阶段 agent 不该反过来叫我们；真叫了也只能不理——这里没有会话可以答
    onRequest: () => undefined,
  })
  // **spawn 真正能跑的那个绝对路径**，理由同 `resolveCommand`：裸名字会被 PATH
  // 再解析一次，而那次可能落到另一个同名文件上——试接说好、真跑的是另一个
  const child = owner.spawn({
    command: await resolveCommand(req.command),
    args: req.args ?? [],
    cwd: req.cwd,
    ...(req.env === undefined ? {} : { env: { ...process.env, ...req.env } }),
  })
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => rpc.feed(chunk))
  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_KEEP)
  })

  try {
    const result = await Promise.race([
      rpc.call("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: CLIENT_INFO,
      }),
      // 起不来这件事毫秒级就已知，不该让人干等八秒
      owner.died().then((error) => ({ died: error })),
      sleep(budget).then(() => "timeout" as const),
    ])
    return verdict(result, req.command, stderr, budget)
  } catch (error) {
    // 对方答了但答的是错误（JSON-RPC error），或者进程中途关了流
    return fail(error instanceof Error ? error.message : String(error), stderr)
  } finally {
    rpc.close("试接结束")
    child.stdin?.end()
    await owner.reclaim()
  }
}

function verdict(result: unknown, command: string, stderr: string, budget: number): AcpTrial {
  if (result === "timeout") {
    return fail(
      `${String(budget / 1000)} 秒内没有回应。它可能不讲 ACP，或者要换一组参数才进 ACP 模式（有几家是 \`<命令> acp\` 或 \`<命令> agent stdio\`）。`,
      stderr,
    )
  }
  if (typeof result === "object" && result !== null && "died" in result) {
    return fail(startupMessage(command, (result as { died: Error }).died), stderr)
  }
  const info = result as AcpInitialize
  const version = info.protocolVersion
  if (version !== undefined && version > PROTOCOL_VERSION) {
    return fail(
      `它讲的是 ACP v${String(version)}，omni 只认到 v${String(PROTOCOL_VERSION)}。请升级 omni。`,
      stderr,
    )
  }
  return {
    ok: true,
    ...(version === undefined ? {} : { protocolVersion: version }),
    capabilities: claimed(info),
    ...(stderr === "" ? {} : { stderr }),
  }
}

function fail(error: string, stderr: string): AcpTrial {
  return { ok: false, error, ...(stderr === "" ? {} : { stderr }) }
}
