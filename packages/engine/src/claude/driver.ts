import {
  query, type Options, type PermissionResult, type SDKUserMessage, type SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk"
import { decide } from "@omni/approval"
import type {
  EngineAccount,
  EngineCapabilities,
  EngineThread,
  Item,
  ModelOption,
  SlashCommand,
  Trust,
  TurnId,
} from "@omni/protocol"
import type { EngineDriver, EngineSession, StartRequest, TrustChange } from "../contract.js"
import { createQueue } from "../queue.js"
import { askAside } from "./aside.js"
import { nameFirst } from "./title.js"
import { capabilitiesOf } from "./caps.js"
import { applyEffort, modelOptions } from "./effort.js"
import { claudeCommands } from "./commands.js"
import {
  buildRequest,
  forcesHumanPrompt,
  summarize,
  toAllow,
  toDeny,
  type AskMeta,
} from "./permission.js"
import { createTurnRef, runMessageLoop } from "./loop.js"
import { findSession, listSessions, readAccount, readTranscript } from "./history.js"
import { createProcessOwner, type ProcessOwner, type ReclaimConfig } from "../subprocess.js"
import { CLAUDE_TRUST, needsPermissionRestart, permissionOptions } from "./trust.js"
import { claudePath, probeClaude, type ClaudeExecutable } from "./executable.js"
import { answerElicitation } from "./elicitation.js"
import { refusalDialogOptions } from "./refusal-dialog.js"
import { planFork, type ForkPlan } from "./fork.js"
import { toUserMessage } from "./attach.js"
import { ContextProbe } from "./context-probe.js"
import { claudeAccount } from "./account.js"
import { ClaudeMcpStatus, reportCurrentMcp } from "./mcp-status.js"

/**
 * Claude Code 2.1.83 起正式暴露 `auto`：由另一只模型分类器审批工具调用。
 *
 * 三档因此直接落到它公开的 Plan / Auto / Bypass。`canUseTool` 仍保留：用户原生
 * ask 规则、需要交互的工具，以及 Auto 多次阻断后的人工回退都会从这扇门出来。
 * 只有走到这里时 omni 才负责呈现或应答，不再拿自己的静态判定冒充原生 Auto。
 */
/** 等消息循环自然收尾的上限；超过就进入信号阶梯。 */
const GRACEFUL_WAIT_MS = 4000
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface ClaudeDriverConfig {
  /** 完整版让 SDK 使用内置 CLI；轻量版把 PATH 上解析出的原生 Claude 交给 SDK。 */
  executable?: ClaudeExecutable
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
  private readonly turn = createTurnRef((at) => {
    void this.commands().then((commands) => {
      if (commands.length > 0) {
        this.req.emit({ type: "commands.updated", at, threadId: this.req.threadId, engine: "claude", commands })
      }
    }).catch(() => undefined)
  })
  private readonly owner: ProcessOwner
  private readonly mcp: ClaudeMcpStatus
  private readonly bypassEnabled: boolean
  private loop: Promise<void> | undefined
  /** 引擎报上来的 session id。`logPath` 要靠它找到那个 jsonl。 */
  private handle: string | undefined
  /** 起名问过没有。**一条会话只问一次**，见 `title.ts` 的 `nameFirst`。 */
  private readonly naming = { asked: false }
  private query: ReturnType<typeof query> | undefined
  /** 当前模型的原生上下文快照；去重控制请求，并隔离换模型前的迟到结果。 */
  private readonly context = new ContextProbe()

  constructor(
    private readonly req: StartRequest,
    private readonly config: ClaudeDriverConfig,
    private readonly executable: string | undefined,
    /** 原生分叉的落点。构造前先读历史解出，避免在同步 `start()` 里做 IO。 */
    private readonly fork: ForkPlan | undefined,
  ) {
    this.trust = { current: req.trust }
    this.bypassEnabled = req.trust === "full"
    this.mcp = new ClaudeMcpStatus({ threadId: req.threadId, emit: req.emit })
    // 字段初始化器里读不到构造参数属性，只能在这里建
    this.owner = createProcessOwner(config.reclaim)
  }

  start(): void {
    const options: Options = {
      cwd: this.req.cwd,
      ...permissionOptions(this.req.trust),
      canUseTool: (tool, input, meta) => this.judge(tool, input, meta as AskMeta),
      onElicitation: (request, { signal }) => answerElicitation(request, this.req.askQuestion, signal),
      ...refusalDialogOptions(this.req, this.turn),
      // 只打开 Claude 已执行 Hook 的公开生命周期；不新增、改写或代审任何 Hook 配置。
      includeHookEvents: true,
      // SDK 只在显式开启后才给逐字增量；收尾消息会复用增量已铸好的 item id。
      includePartialMessages: true,
      // Claude 原生把子 agent 正文标成 parent_tool_use_id；工作台按这个身份渲染嵌套记录。
      forwardSubagentText: true,
      abortController: this.abort,
      // 自己 spawn 才能拿到进程组所有权，回收阶梯才有整树退出证明可言。
      // 强转放这里而不放 subprocess.ts：`SpawnedProcess` 是 Claude SDK 的要求，
      // 进程所有权模块是各引擎共用的，不该反过来迁就某一家的类型。
      spawnClaudeCodeProcess: (o) => this.owner.spawn(o) as unknown as SpawnedProcess,
      // 带句柄就接着上次的会话跑；SDK 会把那次的历史加载回来
      ...(this.req.resume === undefined ? {} : { resume: this.req.resume }),
      // 原生分叉必须覆盖普通 resume：它会生成新 session，并可截到指定 chain entry。
      ...(this.fork === undefined
        ? {}
        : {
            resume: this.fork.resume,
            forkSession: true,
            ...(this.fork.at === undefined ? {} : { resumeSessionAt: this.fork.at }),
          }),
      ...(this.config.isolateSettings === true ? { settingSources: [] } : {}),
      ...(this.executable === undefined ? {} : { pathToClaudeCodeExecutable: this.executable }),
    }
    this.query = query({ prompt: this.input, options })
    // 截一道记下 session id：`logPath` 要靠它找到那个 jsonl，
    // 而 `onHandle` 本身是发出去就不留的
    this.loop = runMessageLoop(
      this.query,
      {
        ...this.req,
        onHandle: (id) => {
          if (this.handle === id) return
          this.handle = id
          this.req.onHandle?.(id)
        },
      },
      this.turn,
      {
        trust: () => this.trust.current,
        context: () => this.context.read(this.query),
        onReady: () => {
          void this.context.read(this.query)
          void reportCurrentMcp(this.query, this.mcp, Date.now())
        },
        onMcpStatuses: (statuses, at) => this.mcp.report(statuses, at),
      },
    )
    // init 要等首条 prompt 后才来；先问一次，第一轮也能拿到正确分母。
    void this.context.read(this.query)
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
    // Plan 的退出本身就是放宽权限。只读档不能把它当普通 meta 工具自动放行。
    if (this.trust.current === "read-only" && tool === "ExitPlanMode") {
      return toDeny("当前会话是只读档，不能退出 Claude Plan mode；请先由用户切换权限档")
    }
    const request = buildRequest(tool, input, meta, { engine: "claude", cwd: this.req.cwd })
    const verdict = decide(request, {
      trust: this.trust.current,
      worksite: this.req.cwd,
      home: this.req.home,
      memory: this.req.memory(),
    })
    if (verdict.action === "deny") return toDeny(verdict.reason)
    if (verdict.action === "allow" && !forcesHumanPrompt(meta)) return toAllow(false, meta)

    const answer = await this.req.askUser({
      toolCallId: meta.toolUseID,
      tool,
      summary: summarize(tool, meta),
      reason: verdict.reason,
      ...(verdict.redline === undefined ? {} : { redline: verdict.redline }),
      ...(verdict.suggest === undefined
        ? {}
        : { rememberHint: verdict.suggest.describe, suggest: verdict.suggest }),
    })
    // `once` 只放行这一次；其余范围回传 SDK 的 suggestions，走它原生的「本会话不再问」
    return answer.allow ? toAllow(answer.remember !== "once", meta) : toDeny("用户拒绝了这次调用")
  }

  get threadId(): StartRequest["threadId"] {
    return this.req.threadId
  }

  async prompt(text: string, turnId: TurnId, attachments?: readonly string[]): Promise<void> {
    const message = await toUserMessage(text, attachments, this.req.threadId)
    // 轮次由宿主铸造；引擎只在这里认领它，收工时由消息循环清空
    this.turn.current = turnId
    this.turn.pendingSteers = 0
    this.turn.latestUsage = undefined
    this.turn.outputTokens = undefined
    const accepted = this.input.push(message)
    if (accepted) {
      nameFirst({ once: this.naming, query: this.query, first: text,
        resume: this.req.resume, forked: this.fork !== undefined, onTitle: this.req.onTitle })
      return
    }
    if (this.turn.current === turnId) {
      this.turn.current = undefined
      this.req.emit({
        type: "turn.completed",
        at: Date.now(),
        turnId,
        status: "failed",
        error: "Claude 输入流已经关闭，这句话没有送达。请重新连接会话后再试。",
      })
    }
    throw new Error("Claude 输入流已经关闭")
  }

  /** 当前原生阶段停下，随后的 `priority: now` 阶段仍挂在同一个 omni turn 上。 */
  async steer(text: string, attachments?: readonly string[]): Promise<void> {
    const expected = this.turn.current
    if (expected === undefined) throw new Error("Claude 当前没有可插入的轮次")
    const message = await toUserMessage(text, attachments, this.req.threadId, "now")
    if (this.turn.current !== expected) throw new Error("Claude 原轮次已经结束")
    this.turn.pendingSteers += 1
    const accepted = this.input.push(message)
    if (accepted) return
    this.turn.pendingSteers -= 1
    throw new Error("Claude 输入流已经关闭")
  }

  /**
   * 可选模型。
   *
   * **强度按模型报**：每个模型自己声明 `supportsEffort` / `supportedEffortLevels`，
   * 不支持的那些一档都不给（见 `effort.ts`——那里也记了上一版为什么写着「没有」）。
   */
  async models(): Promise<readonly ModelOption[]> {
    return modelOptions(await this.query?.supportedModels().catch(() => undefined))
  }

  /**
   * 能用哪些斜杠命令。
   *
   * SDK 的 `supportedCommands()` 把内置命令和技能一起给（实测 52 条），
   * 而**技能是用户自己装的**——`~/.claude/skills`、项目里的、插件带的。
   * 所以这里绝不能写死一张表：写死的表既漏掉用户自己的技能，
   * 又会在 Claude 加减命令时过期，而且过期了不报错。
   */
  async commands(): Promise<readonly SlashCommand[]> {
    const list = await this.query?.supportedCommands().catch(() => undefined)
    return claudeCommands(list ?? [], this.turn.terminalCommands) ?? []
  }

  /**
   * **`compact` 报 false 是有意的。**
   *
   * Claude 当然会压缩上下文——但它的 `/compact` 已经在 `supportedCommands()`
   * 里，会经斜杠命令面板原样露给用户。omni 再给一个「压缩上下文」，
   * 面板上就有两条长得不一样、干同一件事的入口，
   * 而人会先花时间想「这俩有什么区别」。
   *
   * 这一条正是这层抽象要表达的东西：能力问的是**「omni 该不该提供入口」**，
   * 不是「这家引擎有没有这个概念」。
   */
  /**
   * Claude 自己存着哪些会话。
   *
   * SDK 没有「列出历史」的接口，但 Claude Code 把每次对话原样写在
   * `~/.claude/projects/` 下，而**文件名就是 session id**——正好是 `resume`
   * 要的句柄。所以这条是读盘，不是问 SDK（细节见 `history.ts`）。
   */
  async history(): Promise<readonly EngineThread[]> {
    return listSessions(this.req.home)
  }

  /**
   * 这条会话的 jsonl 在哪。Claude Code 把每次对话原样写在
   * `~/.claude/projects/<项目>/<sessionId>.jsonl`，**文件名就是 session id**。
   */
  async logPath(): Promise<string | undefined> {
    const id = this.handle ?? this.req.resume
    if (id === undefined) return undefined
    return findSession(this.req.home, id)
  }

  /** 登录的是哪个账号。优先问 SDK 的公开 `accountInfo()`；旧 CLI 失败时才回落本地身份字段。 */
  async account(): Promise<EngineAccount | undefined> {
    const handle = this.query
    if (handle === undefined) return readAccount(this.req.home)
    try {
      return claudeAccount(await handle.accountInfo())
    } catch {
      return readAccount(this.req.home)
    }
  }

  /** 这条会话已经聊过什么；Claude 的公开载体是本地 jsonl 全文。 */
  async transcript(): Promise<{ items: readonly Item[]; total: number }> {
    const id = this.req.resume
    if (id === undefined) return { items: [], total: 0 }
    return readTranscript(this.req.home, id, Date.now())
  }

  pid(): number | undefined { return this.owner.pid() }

  capabilities(): EngineCapabilities {
    return capabilitiesOf(this.query)
  }

  askAside(text: string): Promise<string> {
    return askAside(this.query, text)
  }

  async setModel(model: string, effort?: string): Promise<{ effort?: string }> {
    await this.query?.setModel(model)
    // 窗口跟着模型走；换模型后旧分母和旧占用都不能继续沿用。
    this.context.invalidate()
    void this.context.read(this.query)
    // **设不上就回空**，调用方据此不把上一模型的旧档冒充成新模型状态
    const applied = await applyEffort(this.query, effort).catch((error: unknown) => {
      this.req.emit({
        type: "engine.status",
        at: Date.now(),
        threadId: this.req.threadId,
        status: "degraded",
        detail: `Claude 设推理强度失败：${error instanceof Error ? error.message : String(error)}`,
      })
      return undefined
    })
    return applied === undefined ? {} : { effort: applied }
  }

  async interrupt(): Promise<void> {
    await this.query?.interrupt()
  }

  async setTrust(trust: Trust): Promise<TrustChange> {
    if (trust === this.trust.current) return { restart: false }
    if (needsPermissionRestart(this.bypassEnabled, trust)) {
      return {
        restart: true,
        detail:
          "Claude 的完全访问需要在会话启动时显式允许 Bypass。请等当前轮结束；omni 会续接同一条会话后重启。",
      }
    }
    const handle = this.query
    if (handle === undefined) throw new Error("Claude 会话尚未就绪，无法切换权限档")
    const previous = this.trust.current
    this.trust.current = trust
    try {
      await handle.setPermissionMode(CLAUDE_TRUST[trust])
    } catch (error) {
      this.trust.current = previous
      throw error
    }
    return { restart: false }
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
  const mode = config.executable ?? "bundled"
  return {
    id: "claude",
    probe: () => probeClaude(mode),
    start: async (req: StartRequest): Promise<EngineSession> => {
      const fork = req.forkOf === undefined ? undefined : await planFork(req.home, req.forkOf)
      const session = new ClaudeSession(req, config, await claudePath(mode), fork)
      session.start()
      return session
    },
  }
}
