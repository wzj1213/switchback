import type { ChildProcess } from "node:child_process"
import { decide } from "@omni/approval"
import type { EngineStatus, ModelOption, Trust, TurnId } from "@omni/protocol"
import type { EngineDriver, EngineSession, StartRequest } from "../contract.js"
import { createProcessOwner, type ProcessOwner, type ReclaimConfig } from "../subprocess.js"
import { createRpc, type RpcPeer, type ServerCall } from "../rpc.js"
import { handleNotification, type NotifyContext } from "./notify.js"
import { buildRequest, decisionFor, toolOf } from "./approve.js"
import type { WireApprovalPolicy, WireApprovalRequest, WireItem, WireSandbox } from "./wire.js"

/**
 * codex 驱动。讲 `codex app-server --stdio` 的 JSON-RPC，翻成 omni 事件。
 *
 * ## 沙箱不是标签，是真的沙箱——而且它就是「问不问」的开关
 *
 * 这是接第二家引擎最重要的一个发现，和 Claude 的结构完全不同。
 *
 * Claude 的 `permissionMode` 只是个路由开关，所以我们把它钉死在 `default`，
 * 让**每一次**调用都走 `canUseTool`，档位全部表达在 `@omni/approval` 里。
 *
 * codex 不是。它的 `sandbox` 是操作系统级的真沙箱（macOS 上是 seatbelt），
 * 实测下来：**只有沙箱会拦的操作才会来问客户端**。
 * `workspace-write` 下往工作区里写文件根本不会触发审批——沙箱本来就允许，
 * codex 没有理由问；换成 `read-only`，同一次写就变成一条
 * `item/fileChange/requestApproval` 送到我们手上。
 *
 * 所以信任档**必须**落在 sandbox 上，落在 approvalPolicy 上是没用的：
 *
 * | 档位        | sandbox           | 结果                                             |
 * | ----------- | ----------------- | ------------------------------------------------ |
 * | `read-only` | `read-only`       | 任何写都来问 omni，omni 拒——档位真正生效         |
 * | `auto-edit` | `workspace-write` | 工作区内的写直接过；越界才问——正是这档的语义     |
 * | `full`      | `workspace-write` | 同上，越界时由 omni 的 `full` 判定放行           |
 *
 * `full` **不**升到 `danger-full-access`：那会把 OS 沙箱整个关掉。
 * `full` 的意思是「别拿日常操作烦我」，不是「把安全网撤了」——
 * 判定错了还有沙箱兜底，这层纵深不该为省一次弹窗而放弃。
 */
const SANDBOX: Readonly<Record<Trust, WireSandbox>> = {
  "read-only": "read-only",
  "auto-edit": "workspace-write",
  full: "workspace-write",
}

/** `untrusted` 把最多的请求路由给客户端，和 Claude 钉死 `default` 是同一个用意。 */
const POLICY: WireApprovalPolicy = "untrusted"

const CLIENT_INFO = { name: "omni", title: "omni 同文", version: "0.1.0" }

interface WireModel {
  id?: string
  model?: string
  displayName?: string
  description?: string
  hidden?: boolean
  supportedReasoningEfforts?: readonly (string | { reasoningEffort?: string })[]
  defaultReasoningEffort?: string
}

/**
 * codex 的 effort 列表元素是 `{ reasoningEffort, description }` 对象，
 * **不是**裸字符串——第一版按 `entry.effort` 读，结果强度选择器整个不出现。
 * 探真实响应才发现字段名。裸字符串那条分支留着兜底，代价只有一行。
 */
function effortOf(entry: string | { reasoningEffort?: string }): string | undefined {
  return typeof entry === "string" ? entry : entry.reasoningEffort
}

function toModelOption(raw: WireModel): ModelOption {
  const efforts = (raw.supportedReasoningEfforts ?? [])
    .map(effortOf)
    .filter((e): e is string => e !== undefined)
  const id = raw.id ?? raw.model ?? ""
  return {
    id,
    label: raw.displayName ?? id,
    ...(raw.description === undefined ? {} : { description: raw.description }),
    ...(efforts.length === 0 ? {} : { efforts }),
    ...(raw.defaultReasoningEffort === undefined ? {} : { defaultEffort: raw.defaultReasoningEffort }),
  }
}

const STDERR_KEEP = 2000

/** 握手上限。超过这个还没回 `initialize`，就当它起不来了。 */
const HANDSHAKE_MS = 20_000

/**
 * 把起进程的失败翻成人能照着做的一句话。
 *
 * `Error: spawn codex ENOENT` 对用户毫无意义——他要知道的是「装了没」「装哪了」。
 * 这是生产可用与否的分界线之一：报错必须说得出下一步该干什么。
 */
function startupMessage(command: string, error: Error): string {
  const code = (error as NodeJS.ErrnoException).code
  if (code === "ENOENT") {
    return `找不到可执行文件 \`${command}\`。请确认已安装 codex CLI，且它在 PATH 上（终端里跑 \`which codex\` 验证）。`
  }
  if (code === "EACCES") return `没有权限执行 \`${command}\`。`
  return `启动 \`${command}\` 失败：${error.message}`
}

interface SessionState {
  child: ChildProcess | undefined
  codexThread: string | undefined
  codexTurn: string | undefined
  turn: TurnId | undefined
  stderr: string
  sandbox: WireSandbox
  /** 用户选的模型与强度。`turn/start` 时带上，codex 说它对后续轮次也生效。 */
  model: string | undefined
  effort: string | undefined
}

export interface CodexDriverConfig {
  /** 可执行文件。默认走 PATH 上的 `codex`。 */
  command?: string
  args?: readonly string[]
  reclaim?: Partial<ReclaimConfig>
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

class CodexSession implements EngineSession {
  private readonly owner: ProcessOwner
  private readonly rpc: RpcPeer
  private readonly inflight = new Map<string, WireItem>()
  private readonly materialized = new Set<string>()
  private readonly trust: { current: Trust }
  private readonly state: SessionState

  constructor(
    private readonly req: StartRequest,
    private readonly config: CodexDriverConfig,
  ) {
    this.trust = { current: req.trust }
    this.owner = createProcessOwner(config.reclaim)
    this.state = {
      child: undefined,
      codexThread: undefined,
      codexTurn: undefined,
      turn: undefined,
      stderr: "",
      sandbox: SANDBOX[req.trust],
      model: undefined,
      effort: undefined,
    }
    this.rpc = createRpc({
      send: (line) => this.state.child?.stdin?.write(`${line}\n`),
      onNotification: (method, params) => {
        handleNotification(this.notifyContext(), method, params)
      },
      onRequest: (call) => {
        void this.answer(call)
      },
    })
  }

  private notifyContext(): NotifyContext {
    return {
      threadId: this.req.threadId,
      emit: this.req.emit,
      turnId: () => this.state.turn,
      inflight: this.inflight,
      materialized: this.materialized,
      now: () => Date.now(),
    }
  }

  private status(status: EngineStatus, detail?: string): void {
    this.req.emit({
      type: "engine.status",
      at: Date.now(),
      threadId: this.req.threadId,
      status,
      ...(detail === undefined || detail === "" ? {} : { detail }),
    })
  }

  private wire(child: ChildProcess): void {
    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      this.rpc.feed(chunk)
    })
    // stderr 只留最后一段：崩了要给人看的是最后几行，不是整个日志
    child.stderr?.setEncoding("utf8")
    child.stderr?.on("data", (chunk: string) => {
      this.state.stderr = (this.state.stderr + chunk).slice(-STDERR_KEEP)
    })
    child.on("exit", (code) => {
      this.rpc.close(`codex 进程已退出（code ${String(code)}）`)
      if (code !== 0 && code !== null) this.status("crashed", this.state.stderr)
    })
  }

  async start(): Promise<void> {
    this.status("starting")
    // 继承父环境：codex 的登录态、PATH、代理设置全在里面。
    // 凭据擦洗是 EngineDescriptor 描述的以后的事，现在擦了就登录不上。
    const child = this.owner.spawn({
      command: this.config.command ?? "codex",
      args: this.config.args ?? ["app-server", "--stdio"],
      cwd: this.req.cwd,
      env: process.env,
    })
    this.state.child = child
    this.wire(child)

    await this.handshake()
    const started = await this.openThread()
    const id = (started as { thread?: { id?: string } } | undefined)?.thread?.id
    if (id === undefined) throw new Error("codex 没有返回 thread id，无法继续")
    this.state.codexThread = id
    // codex 的 thread id 就是它的会话句柄——落盘之后下次能凭它续跑
    this.req.onHandle?.(id)
    this.status("ready")
  }

  /**
   * 开会话。带句柄就续跑，不带就新开。
   *
   * 续跑失败（历史被清、版本不兼容）**不能静默降级成新会话**——那样用户会以为
   * 上下文还在，实际模型什么都不记得。宁可把失败摆出来。
   */
  private async openThread(): Promise<unknown> {
    const shared = { approvalPolicy: POLICY, sandbox: this.state.sandbox, cwd: this.req.cwd }
    if (this.req.resume === undefined) return this.rpc.call("thread/start", shared)
    return this.rpc.call("thread/resume", { threadId: this.req.resume, ...shared })
  }

  /**
   * 握手。**必须有超时，也必须看 spawn 本身是否失败**。
   *
   * 起不来的进程不会产出任何 stdout，`rpc.call("initialize")` 于是永远不 resolve，
   * 界面就一直停在「正在打开工作区…」——没有报错、没有超时、什么都没有，
   * 这是最难查的一类故障。
   */
  private async handshake(): Promise<void> {
    const command = this.config.command ?? "codex"
    const result = await Promise.race([
      this.rpc.call("initialize", { clientInfo: CLIENT_INFO, capabilities: null }).then(() => "ok" as const),
      this.owner.died().then((error) => ({ died: error })),
      sleep(HANDSHAKE_MS).then(() => "timeout" as const),
    ])
    if (typeof result === "object") throw new Error(startupMessage(command, result.died))
    if (result === "timeout") {
      const tail = this.state.stderr === "" ? "" : `\n${this.state.stderr}`
      throw new Error(`codex 在 ${String(HANDSHAKE_MS / 1000)} 秒内没有完成握手，已放弃。${tail}`)
    }
    this.rpc.notify("initialized")
  }

  /**
   * 服务端请求的应答。**必须每一条都答**——不答 codex 会一直等，整轮就此挂住。
   *
   * 认不出的请求一律回空对象：宁可让 codex 拿到一个它看不懂的应答，
   * 也不能让它无限期等下去。审批类的认不出就拒——默认拒是唯一安全的默认。
   */
  private async answer(call: ServerCall): Promise<void> {
    if (!call.method.endsWith("requestApproval")) {
      call.respond({})
      return
    }
    const params = call.params as WireApprovalRequest
    const item = this.inflight.get(params.itemId)
    const request = buildRequest(call.method, params, item, this.req.cwd)
    const verdict = decide(request, {
      trust: this.trust.current,
      worksite: this.req.cwd,
      home: this.req.home,
      memory: this.req.memory(),
    })
    if (verdict.action !== "escalate") {
      call.respond({ decision: verdict.action === "allow" ? "accept" : "decline" })
      return
    }
    const answer = await this.req.askUser({
      toolCallId: params.itemId,
      tool: toolOf(call.method),
      summary: request.summary ?? toolOf(call.method),
      reason: verdict.reason,
      ...(verdict.suggest === undefined ? {} : { rememberHint: verdict.suggest.describe, suggest: verdict.suggest }),
    })
    call.respond({ decision: decisionFor(answer.allow, answer.remember !== "once") })
  }

  get threadId(): StartRequest["threadId"] {
    return this.req.threadId
  }

  async prompt(text: string, turnId: TurnId): Promise<void> {
    if (this.state.codexThread === undefined) throw new Error("codex 会话尚未就绪")
    this.state.turn = turnId
    // `turn/start` 在轮次**开始**时就回（status: inProgress），不等收工——
    // 所以这里 await 它是安全的，还能顺手拿到 codex 侧的 turnId 供中断使用。
    const started = await this.rpc.call("turn/start", {
      threadId: this.state.codexThread,
      input: [{ type: "text", text, text_elements: [] }],
      ...(this.state.model === undefined ? {} : { model: this.state.model }),
      ...(this.state.effort === undefined ? {} : { effort: this.state.effort }),
    })
    this.state.codexTurn = (started as { turn?: { id?: string } } | undefined)?.turn?.id
  }

  /**
   * 可选模型。`hidden` 的不给——那是 codex 自己的选择器都不显示的，
   * 我们没有理由比它更啰嗦。
   */
  async models(): Promise<readonly ModelOption[]> {
    const raw = await this.rpc.call("model/list", {}).catch(() => undefined)
    const list = (raw as { data?: readonly WireModel[] } | undefined)?.data ?? []
    return list.filter((m) => m.hidden !== true).map(toModelOption)
  }

  async setModel(model: string, effort?: string): Promise<void> {
    this.state.model = model
    this.state.effort = effort
    // 不用单独发请求：`turn/start` 的 model/effort 覆盖「这一轮及后续」
    return Promise.resolve()
  }

  async interrupt(): Promise<void> {
    const { codexThread, codexTurn } = this.state
    if (codexThread === undefined || codexTurn === undefined) return
    await this.rpc.call("turn/interrupt", { threadId: codexThread, turnId: codexTurn })
  }

  /**
   * 改档只改 omni 侧的判定。**OS 沙箱在 `thread/start` 时就定死了，改不了**——
   * 往低了调没问题（omni 拒得更多），往高了调则会出现「omni 说可以、写下去却被
   * 系统拦住」的怪事。所以这种情况明确报一条状态，别让人对着一个没有报错的失败发呆。
   */
  async setTrust(trust: Trust): Promise<void> {
    this.trust.current = trust
    if (SANDBOX[trust] !== this.state.sandbox) {
      this.status(
        "ready",
        `信任档已改为 ${trust}，但本会话的 codex 沙箱仍是 ${this.state.sandbox}（开会话时定死）。要让新档位完全生效，请新开一个会话。`,
      )
    }
    return Promise.resolve()
  }

  /**
   * 回收阶梯。顺序同 Claude 驱动：先给优雅退出的机会，再上信号。
   *
   * 1. 关 stdin → codex 看到 EOF，自己收尾
   * 2. `rpc.close()` 把在途请求全部落定，否则 `dispose()` 会顶在 await 上
   * 3. `owner.reclaim()` 补 SIGTERM → SIGKILL → 整树退出证明
   */
  async dispose(): Promise<void> {
    this.state.child?.stdin?.end()
    this.rpc.close("会话正在关闭")
    const report = await this.owner.reclaim()
    if (report.rung === "escaped") {
      this.status("crashed", `codex 进程组未能回收（pid ${String(report.pid)}），可能已泄漏`)
    }
  }
}

export function createCodexDriver(config: CodexDriverConfig = {}): EngineDriver {
  return {
    id: "codex",
    start: async (req: StartRequest): Promise<EngineSession> => {
      const session = new CodexSession(req, config)
      // 握手失败要在这里就抛出来，别让宿主拿到一个看着正常、一发消息就炸的会话
      await session.start()
      return session
    },
  }
}
