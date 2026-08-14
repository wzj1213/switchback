import { query, type Options, type PermissionResult, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { decide } from "@omni/approval"
import type { Trust } from "@omni/protocol"
import type { EngineDriver, EngineSession, StartRequest } from "../contract.js"
import { createQueue } from "../queue.js"
import { buildRequest, forcesHumanPrompt, summarize, toAllow, toDeny, type AskMeta } from "./permission.js"
import { runMessageLoop } from "./loop.js"

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
}

class ClaudeSession implements EngineSession {
  private readonly input = createQueue<SDKUserMessage>()
  private readonly abort = new AbortController()
  private readonly trust: { current: Trust }
  private loop: Promise<void> | undefined
  private handle: ReturnType<typeof query> | undefined

  constructor(
    private readonly req: StartRequest,
    private readonly config: ClaudeDriverConfig,
  ) {
    this.trust = { current: req.trust }
  }

  start(): void {
    const options: Options = {
      cwd: this.req.cwd,
      permissionMode: PERMISSION_MODE,
      canUseTool: (tool, input, meta) => this.judge(tool, input, meta as AskMeta),
      abortController: this.abort,
      ...(this.config.isolateSettings === true ? { settingSources: [] } : {}),
    }
    this.handle = query({ prompt: this.input, options })
    this.loop = runMessageLoop(this.handle, this.req)
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
    return answer.allow ? toAllow(answer.remember, meta) : toDeny("用户拒绝了这次调用")
  }

  get threadId(): StartRequest["threadId"] {
    return this.req.threadId
  }

  async prompt(text: string): Promise<void> {
    this.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: this.req.threadId,
    } as SDKUserMessage)
    return Promise.resolve()
  }

  async interrupt(): Promise<void> {
    await this.handle?.interrupt()
  }

  async setTrust(trust: Trust): Promise<void> {
    // 只改 omni 侧的档位；SDK 的 permissionMode 故意不动（见 PERMISSION_MODE 注释）。
    this.trust.current = trust
    return Promise.resolve()
  }

  async dispose(): Promise<void> {
    this.input.close()
    this.abort.abort()
    await this.loop?.catch(() => undefined)
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
