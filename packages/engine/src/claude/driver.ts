import {
  query,
  type Options,
  type PermissionResult,
  type SDKUserMessage,
  type SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk"
import { decide } from "@omni/approval"
import type { ModelOption, Trust, TurnId } from "@omni/protocol"
import type { EngineDriver, EngineSession, StartRequest } from "../contract.js"
import { createQueue } from "../queue.js"
import { buildRequest, forcesHumanPrompt, summarize, toAllow, toDeny, type AskMeta } from "./permission.js"
import { runMessageLoop, type TurnRef } from "./loop.js"
import { createProcessOwner, type ProcessOwner, type ReclaimConfig } from "../subprocess.js"

/**
 * `permissionMode` 固定为 `'default'`，三个信任档都不变。
 *
 * 依据（SDK 的 `SDKPermissionDeniedMessage` 文档）：只有走到 **'ask'** 的决定才会
 * 经 `can_use_tool` 请求交给宿主。其余模式都会绕过回调——
 * `acceptEdits` / `bypassPermissions` 预先放行，`dontAsk` / `auto` 预先拒绝
 * （`auto` 用模型分类器判，omni 完全看不到）。
 * 所以档位必须表达在 `@omni/approval` 的判定里，不能表达在 SDK 模式里。
 */
const PERMISSION_MODE = "default" as const

/** 等消息循环自然收尾的上限；超过就进入信号阶梯。 */
const GRACEFUL_WAIT_MS = 4000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface ClaudeDriverConfig {
  /**
   * 是否隔离宿主的 Claude 设置。
   *
   * 默认 `false`——沿用 CLI 行为，加载 user/project/local 全部设置与 CLAUDE.md。
   * 代价是：用户自己配的 allow 规则会**先于** `canUseTool` 放行，omni 的判定器看不到。
   * 这是有意的：那些规则是用户自己写的原生配置，和 `matchedAskRule` 同一个道理——
   * 用户的明示意图压过宿主的自动策略。而且剥掉设置会让 Claude 在 omni 里的行为
   * 与在终端里不一致，违背「引擎原生」这个前提。
   *
   * 设为 `true` 时传 `settingSources: []`，omni 成为唯一权威，**但也会丢掉 CLAUDE.md**。
   */
  isolateSettings?: boolean
  /** 回收阶梯的三个窗口，见 `subprocess.ts` */
  reclaim?: Partial<ReclaimConfig>
}

class ClaudeSession implements EngineSession {
  private readonly input = createQueue<SDKUserMessage>()
  private readonly abort = new AbortController()
  private readonly trust: { current: Trust }
  private readonly turn: TurnRef = { current: undefined, seq: 0, tools: new Map() }
  private readonly owner: ProcessOwner
  private loop: Promise<void> | undefined
  private handle: ReturnType<typeof query> | undefined

  constructor(
    private readonly req: StartRequest,
    private readonly config: ClaudeDriverConfig,
  ) {
    this.trust = { current: req.trust }
    // 字段初始化器里读不到构造参数属性，只能在这里建
    this.owner = createProcessOwner(config.reclaim)
  }

  start(): void {
    const options: Options = {
      cwd: this.req.cwd,
      permissionMode: PERMISSION_MODE,
      canUseTool: (tool, input, meta) => this.judge(tool, input, meta as AskMeta),
      abortController: this.abort,
      // 自己 spawn 才能拿到进程组所有权，回收阶梯才有整树退出证明可言。
      // 强转放这里而不放 subprocess.ts：`SpawnedProcess` 是 Claude SDK 的要求，
      // 进程所有权模块是各引擎共用的，不该反过来迁就某一家的类型。
      spawnClaudeCodeProcess: (o) => this.owner.spawn(o) as unknown as SpawnedProcess,
      // 带句柄就接着上次的会话跑；SDK 会把那次的历史加载回来
      ...(this.req.resume === undefined ? {} : { resume: this.req.resume }),
      ...(this.config.isolateSettings === true ? { settingSources: [] } : {}),
    }
    this.handle = query({ prompt: this.input, options })
    this.loop = runMessageLoop(this.handle, this.req, this.turn)
  }

  /**
   * `canUseTool` 的实现。管线：红线/档位判定 → 必要时问人。
   *
   * 注意 `forcesHumanPrompt`：用户自己配的 ask 规则强制的请求，
   * 判定器说 allow 也要问人——见 permission.ts 的注释。
   */
  private async judge(
    tool: string,
    input: Record<string, unknown>,
    meta: AskMeta,
  ): Promise<PermissionResult> {
    const request = buildRequest(tool, input, meta, { engine: "claude", cwd: this.req.cwd })
    const verdict = decide(request, {
      trust: this.trust.current,
      worksite: this.req.cwd,
      home: this.req.home,
      memory: this.req.memory,
    })
    if (verdict.action === "deny") return toDeny(verdict.reason)
    if (verdict.action === "allow" && !forcesHumanPrompt(meta)) return toAllow(false, meta)

    const answer = await this.req.askUser({
      toolCallId: meta.toolUseID,
      tool,
      summary: summarize(tool, meta),
      reason: verdict.reason,
      ...(verdict.suggest === undefined ? {} : { rememberHint: verdict.suggest.describe }),
    })
    // `once` 只放行这一次；其余范围回传 SDK 的 suggestions，走它原生的「本会话不再问」
    return answer.allow ? toAllow(answer.remember !== "once", meta) : toDeny("用户拒绝了这次调用")
  }

  get threadId(): StartRequest["threadId"] {
    return this.req.threadId
  }

  async prompt(text: string, turnId: TurnId): Promise<void> {
    // 轮次由宿主铸造；引擎只在这里认领它，收工时由消息循环清空
    this.turn.current = turnId
    this.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: this.req.threadId,
    } as SDKUserMessage)
    return Promise.resolve()
  }

  /**
   * 可选模型。
   *
   * **不上报 `efforts`**：SDK 的 `effort` 是 `Options` 字段，只能在 `query()`
   * 时给，运行期没有 setter。报上去界面就会画一个改了不生效的控件。
   */
  async models(): Promise<readonly ModelOption[]> {
    const list = await this.handle?.supportedModels().catch(() => undefined)
    return (list ?? []).map((m) => ({
      id: m.value,
      label: m.displayName,
      ...(m.description === "" ? {} : { description: m.description }),
    }))
  }

  async setModel(model: string): Promise<void> {
    await this.handle?.setModel(model)
  }

  async interrupt(): Promise<void> {
    await this.handle?.interrupt()
  }

  async setTrust(trust: Trust): Promise<void> {
    // 只改 omni 侧的档位；SDK 的 permissionMode 故意不动（见 PERMISSION_MODE 注释）。
    this.trust.current = trust
    return Promise.resolve()
  }

  /**
   * 回收阶梯。**顺序是有讲究的**：
   *
   * 1. 关输入流 → SDK 看到 stdin EOF，走它自己的 ~2s 优雅窗口（`GRACEFUL_EXIT_TIMEOUT_MS`）
   * 2. 等消息循环自然结束（正常退出会走到这里）
   * 3. 才 abort——提前 abort 会抢在 SDK 的优雅路径前面，CLI 自己的优雅退出就没机会跑
   * 4. `owner.reclaim()` 补上 SIGTERM → SIGKILL → 整树退出证明
   *
   * 逃逸（`escaped`）**必须上报**，不能吞。一个悄悄泄漏的引擎子进程
   * 表现出来就是「机器越来越慢」，最难查。
   */
  async dispose(): Promise<void> {
    this.input.close()
    await Promise.race([this.loop?.catch(() => undefined), sleep(GRACEFUL_WAIT_MS)])
    this.abort.abort()
    const report = await this.owner.reclaim()
    if (report.rung === "escaped") {
      this.req.emit({
        type: "engine.status",
        at: Date.now(),
        threadId: this.req.threadId,
        status: "crashed",
        detail: `引擎进程组未能回收（pid ${String(report.pid)}），可能已泄漏`,
      })
    }
  }
}

export function createClaudeDriver(config: ClaudeDriverConfig = {}): EngineDriver {
  return {
    id: "claude",
    start: (req: StartRequest): Promise<EngineSession> => {
      const session = new ClaudeSession(req, config)
      session.start()
      return Promise.resolve(session)
    },
  }
}
