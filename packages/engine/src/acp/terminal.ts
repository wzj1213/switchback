import { spawn, type ChildProcess } from "node:child_process"

/**
 * ACP 的 `terminal/*`：**由客户端替 agent 起进程**。
 *
 * ## 为什么必须做——不做的代价是「静默地没有 shell」
 *
 * `driver.ts` 原来的注释写着：
 *
 * > 实测确认这不影响拿输出：不认领 `terminal` 时 codex-acp 照样自己跑命令
 *
 * 那句话对 codex-acp 成立，对 **kimi 不成立**——**一家的实测被写成了全家族的结论**
 *（和 `compact` 那次一模一样的错误形状）。kimi 的 ACP 运行时里
 * `AcpProcessService.spawn()` 第一行就是
 * `if (!this.connection.terminalEnabled) throw new Error("ACP terminal capability is unavailable")`，
 * **没有本地兜底**：客户端不认领，它一条命令都跑不了。
 *
 * A/B 实测（2026-08-19，同一句话、Switchback 原样的握手参数，只改这一位）：
 *
 * | `terminal` | 结果 |
 * |---|---|
 * | `false` | Bash 工具 failed，模型说「当前环境的 shell 执行能力不可用」 |
 * | `true` | 它发来 `terminal/create` → `wait_for_exit` → `output` → `release` |
 *
 * 严重的地方在于这是**静默的能力损失**：kimi 照样读写文件、看起来一切正常，
 * 只是测试、构建、git 全废，而没有任何东西报错。用户是靠模型自己提了一句才发现的。
 *
 * ## 那条「不认领」的理由为什么在这儿不成立
 *
 * 原来的理由是「命令跑在 Switchback 进程里，和『引擎跑自己的原生进程、用自己的沙箱』冲突」。
 * 但 kimi **压根没有引擎侧的 shell 沙箱**——它的设计就是把起进程这件事交给客户端。
 * 所以真实的取舍不是「Switchback 的进程 vs kimi 的沙箱」，而是**「Switchback 的进程 vs 完全没有 shell」**。
 *
 * 因此这一位**按引擎注入**（`AcpDriverConfig.terminal`），不是全家族打开：
 * codex-acp / grok / zcode 自己起进程，认领了反而是把命令从**它们自己的沙箱里拽出来**。
 *
 * ## 边界：这里不做审批
 *
 * 命令该不该跑由引擎那侧的档位决定（kimi 的 mode 落在 `session/set_config_option`），
 * Switchback 在这一层**只负责把进程起起来、把输出还回去**。在这儿再加一道判定，
 * 就是在引擎已经批准的事情上叠 Switchback 的第二套规则——撞总纲。
 */

/** `terminal/create` 的入参形状（读 kimi 包里的 zod schema 抄的）。 */
export interface CreateParams {
  sessionId?: string
  command?: string
  args?: readonly string[]
  /** **是数组不是对象**：`[{name, value}]`。 */
  env?: readonly { name?: string; value?: string }[]
  cwd?: string | null
  outputByteLimit?: number | null
}

interface Term {
  child: ChildProcess
  /** 累积输出。stdout 与 stderr 合流——agent 那边就是一个 `output` 字段。 */
  out: string
  truncated: boolean
  limit: number
  exit: { exitCode?: number; signal?: string } | undefined
  /** `wait_for_exit` 挂在这上面；进程已经退了就是一个已 resolve 的 Promise。 */
  done: Promise<void>
}

/** 默认上限。agent 不给时用它——不设上限的话一条 `yes` 能把内存吃光。 */
const DEFAULT_LIMIT = 4 * 1024 * 1024

export interface TerminalHost {
  /** 处理一条 `terminal/*` 请求。返回 undefined 表示这个方法不归它管。 */
  handle: (method: string, params: unknown) => Promise<unknown> | undefined
  /** 会话结束时把还活着的进程全杀掉。**不做的话它们会活过 Switchback**。 */
  disposeAll: () => void
}

export function createTerminalHost(fallbackCwd: string): TerminalHost {
  const terms = new Map<string, Term>()
  let seq = 0

  const create = (params: CreateParams): { terminalId: string } => {
    const id = `t${String((seq += 1))}`
    terms.set(id, start(params, fallbackCwd))
    return { terminalId: id }
  }

  const of = (params: unknown): Term | undefined => {
    const id = (params as { terminalId?: unknown } | undefined)?.terminalId
    return typeof id === "string" ? terms.get(id) : undefined
  }

  const handle = (method: string, params: unknown): Promise<unknown> | undefined => {
    if (method === "terminal/create") return Promise.resolve(create(params as CreateParams))
    const term = of(params)
    // **认得方法但找不到这条终端**：回一个空壳而不是抛。agent 那边通常是
    // release 迟到了一步（它自己也在收尾），抛出去只会在轮次末尾多一条红字
    if (term === undefined) return TERMINAL_METHODS.has(method) ? Promise.resolve({}) : undefined
    if (method === "terminal/output") return Promise.resolve(outputOf(term))
    if (method === "terminal/wait_for_exit") return term.done.then(() => term.exit ?? {})
    if (method === "terminal/kill" || method === "terminal/release") {
      term.child.kill("SIGKILL")
      return Promise.resolve({})
    }
    return undefined
  }

  return {
    handle,
    disposeAll: () => {
      for (const term of terms.values()) term.child.kill("SIGKILL")
      terms.clear()
    },
  }
}

const TERMINAL_METHODS: ReadonlySet<string> = new Set([
  "terminal/output",
  "terminal/wait_for_exit",
  "terminal/kill",
  "terminal/release",
])

/** 当前输出。**`exitStatus` 只在真退了之后才给**——没退就报 undefined，不猜 0。 */
function outputOf(term: Term): { output: string; truncated: boolean; exitStatus?: { exitCode?: number; signal?: string } } {
  return {
    output: term.out,
    truncated: term.truncated,
    ...(term.exit === undefined ? {} : { exitStatus: term.exit }),
  }
}

/**
 * 起进程。
 *
 * **继承父环境再叠 agent 给的那几个**：只给它传来的那几个变量的话，
 * `PATH` 就没了——那时候连 `git` 都找不到，而报错是「command not found」，
 * 看起来像用户机器上没装。
 *
 * `env` 线上是**数组** `[{name, value}]`，不是对象。写成对象解析会得到一个空环境，
 * 而那个错误的表现恰恰是上面那句「看起来像没装」。
 */
function start(params: CreateParams, fallbackCwd: string): Term {
  const env: Record<string, string> = { ...process.env } as Record<string, string>
  for (const item of params.env ?? []) {
    if (typeof item.name === "string" && item.name !== "") env[item.name] = item.value ?? ""
  }
  const child = spawn(params.command ?? "", [...(params.args ?? [])], {
    cwd: params.cwd ?? fallbackCwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const limit = params.outputByteLimit ?? DEFAULT_LIMIT
  const term: Term = { child, out: "", truncated: false, limit, exit: undefined, done: Promise.resolve() }
  term.done = wire(term)
  return term
}

/** 接输出与退出。**截断从头部丢**——命令的结论通常在末尾。 */
function wire(term: Term): Promise<void> {
  const take = (chunk: unknown): void => {
    term.out += String(chunk)
    if (term.out.length <= term.limit) return
    term.out = term.out.slice(term.out.length - term.limit)
    term.truncated = true
  }
  term.child.stdout?.on("data", take)
  term.child.stderr?.on("data", take)
  return new Promise<void>((resolve) => {
    // `error` 也要落终态：命令不存在时只有这一条，没有 `exit`——
    // 不接的话 `wait_for_exit` 永远不回，整轮挂死
    term.child.on("error", (error: Error) => {
      take(`${error.message}\n`)
      term.exit ??= { exitCode: 127 }
      resolve()
    })
    term.child.on("exit", (code, signal) => {
      term.exit = {
        ...(code === null ? {} : { exitCode: code }),
        ...(signal === null ? {} : { signal }),
      }
      resolve()
    })
  })
}
