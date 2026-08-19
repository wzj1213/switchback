import { readFile } from "node:fs/promises"
import {
  query,
  type Options,
  type PermissionResult,
  type SDKUserMessage,
  type SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk"
import { decide } from "@omni/approval"
import type { EngineAccount, EngineCapabilities, EngineThread, Item, ModelOption, SlashCommand, Trust, TurnId } from "@omni/protocol"
import type { EngineDriver, EngineSession, StartRequest } from "../contract.js"
import { probeCommand, type Probe } from "../probe.js"
import { createQueue } from "../queue.js"
import { askAside, canAside } from "./aside.js"
import { createTaskState } from "./tasks.js"
import { buildRequest, forcesHumanPrompt, summarize, toAllow, toDeny, type AskMeta } from "./permission.js"
import { runMessageLoop, type TurnRef } from "./loop.js"
import { findSession, listSessions, readAccount, readTranscript } from "./history.js"
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
  private readonly turn: TurnRef = { current: undefined, seq: 0, tools: new Map(), tasks: createTaskState() }
  private readonly owner: ProcessOwner
  private loop: Promise<void> | undefined
  /** 引擎报上来的 session id。`logPath` 要靠它找到那个 jsonl。 */
  private handle: string | undefined
  private query: ReturnType<typeof query> | undefined

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
    this.query = query({ prompt: this.input, options })
    // 截一道记下 session id：`logPath` 要靠它找到那个 jsonl，
    // 而 `onHandle` 本身是发出去就不留的
    this.loop = runMessageLoop(
      this.query,
      {
        ...this.req,
        onHandle: (id) => {
          this.handle = id
          this.req.onHandle?.(id)
        },
      },
      this.turn,
    )
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
      ...(verdict.suggest === undefined ? {} : { rememberHint: verdict.suggest.describe, suggest: verdict.suggest }),
    })
    // `once` 只放行这一次；其余范围回传 SDK 的 suggestions，走它原生的「本会话不再问」
    return answer.allow ? toAllow(answer.remember !== "once", meta) : toDeny("用户拒绝了这次调用")
  }

  get threadId(): StartRequest["threadId"] {
    return this.req.threadId
  }

  async prompt(text: string, turnId: TurnId, attachments?: readonly string[]): Promise<void> {
    // 轮次由宿主铸造；引擎只在这里认领它，收工时由消息循环清空
    this.turn.current = turnId
    this.input.push({
      type: "user",
      message: { role: "user", content: await toContent(text, attachments) },
      parent_tool_use_id: null,
      session_id: this.req.threadId,
    } as SDKUserMessage)
  }

  /**
   * 可选模型。
   *
   * **不上报 `efforts`**：SDK 的 `effort` 是 `Options` 字段，只能在 `query()`
   * 时给，运行期没有 setter。报上去界面就会画一个改了不生效的控件。
   */
  async models(): Promise<readonly ModelOption[]> {
    const list = await this.query?.supportedModels().catch(() => undefined)
    return (list ?? []).map((m) => ({
      id: m.value,
      label: m.displayName,
      ...(m.description === "" ? {} : { description: m.description }),
    }))
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
    return (list ?? []).map((c) => ({
      name: c.name,
      description: c.description,
      ...(c.argumentHint === "" ? {} : { argumentHint: c.argumentHint }),
      source: "engine" as const,
    }))
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

  /** 登录的是哪个账号。读 `~/.claude.json` 的身份字段，**不碰凭据**。 */
  async account(): Promise<EngineAccount | undefined> {
    return readAccount(this.req.home)
  }

  /**
   * 这条会话已经聊过什么。**codex 那边做不到这件事**（它的 `thread/items/list`
   * 回 not supported yet），而这里文件里就是全文，所以接过来能真的摆出来。
   */
  async transcript(): Promise<{ items: readonly Item[]; total: number }> {
    const id = this.req.resume
    if (id === undefined) return { items: [], total: 0 }
    return readTranscript(this.req.home, id, Date.now())
  }

  capabilities(): EngineCapabilities {
    // steer 报 false：SDK 没有「往正在跑的那一轮里插一句」的入口。
    // 宿主据此退回排队——**不是假装支持再偷偷排队**，
    // 那样界面就没法如实告诉用户「这句得等」
    // fork 也报 false：SDK 没有复制会话的入口，只能走交接包
    // **`modeReadback` 报 false 是「omni 还没接」，不是「claude 没有」**：
    // SDK 的 `system` 消息带着 permissionMode，而 `loop.ts` 的 `case "system"`
    // 只放行 `subtype === "init"`。接上之前如实报 false——
    // 报 true 而界面上那行永远不动，比不给那行糟
    // **运行时探测，不嗅版本**：0.3.231 的公开类型还没声明它
    return {
      compact: false,
      attachments: true,
      steer: false,
      fork: false,
      modeReadback: false,
      sideQuestion: canAside(this.query),
    }
  }

  askAside(text: string): Promise<string> {
    return askAside(this.query, text)
  }

  async setModel(model: string): Promise<{ effort?: string }> {
    await this.query?.setModel(model)
    // Claude 不报强度，也就没有「生效的那一档」
    return {}
  }

  async interrupt(): Promise<void> {
    await this.query?.interrupt()
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

/**
 * Claude 的「装了没」比别家难答一档。
 *
 * SDK 自己解析 CLI 的位置（内部走 `which`，也接受 `pathToClaudeCodeExecutable`），
 * 所以 **`which claude` 查不到不代表跑不起来**。
 * 把这种情况报成 `missing` 会灰掉一个能用的引擎，比不检查更糟——
 * 于是查不到时降成 `unknown`：界面照常显示，不做任何标注。
 */
async function probeClaude(): Promise<Probe> {
  const found = await probeCommand("claude")
  if (found.state === "ok") return found
  return {
    state: "unknown",
    detail: "PATH 上没有 `claude`，但 SDK 会自己找——真起不来的话，开会话时会报出来。",
  }
}

export function createClaudeDriver(config: ClaudeDriverConfig = {}): EngineDriver {
  return {
    id: "claude",
    probe: probeClaude,
    start: (req: StartRequest): Promise<EngineSession> => {
      const session = new ClaudeSession(req, config)
      session.start()
      return Promise.resolve(session)
    },
  }
}

/** 认得出的图片类型。**认不出就不送**——把一个 zip 当成图片塞过去，模型那边只会报错。 */
const IMAGE_MIME: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
}

/**
 * 文本 ＋ 附件 → SDK 的消息内容。
 *
 * 没有附件时**仍然给字符串**，不是单元素数组：那条路每天走几百次，
 * 形状不变最安全。
 *
 * 图片要读成 base64——SDK 走的是 Anthropic 的内容块，那边只认内联数据，
 * 没有「给个路径你自己读」的形式（codex 有，所以那边用 `localImage`）。
 * 读不出来的（文件没了、权限不对）**跳过并在文本里说一声**，
 * 而不是整条消息发不出去：用户已经按了回车，那句话本身还是该送到。
 */
async function toContent(
  text: string,
  attachments: readonly string[] | undefined,
): Promise<SDKUserMessage["message"]["content"]> {
  if (attachments === undefined || attachments.length === 0) return text
  const blocks: unknown[] = []
  const failed: string[] = []
  for (const path of attachments) {
    const mime = IMAGE_MIME[extOf(path)]
    if (mime === undefined) {
      failed.push(`${path}（不是认得出的图片类型）`)
      continue
    }
    const data = await readFile(path, { encoding: "base64" }).catch(() => undefined)
    if (data === undefined) {
      failed.push(`${path}（读不出来）`)
      continue
    }
    blocks.push({ type: "image", source: { type: "base64", media_type: mime, data } })
  }
  const note = failed.length === 0 ? "" : `\n\n（这些附件没能送达：${failed.join("、")}）`
  blocks.push({ type: "text", text: text + note })
  return blocks as SDKUserMessage["message"]["content"]
}

function extOf(path: string): string {
  const at = path.lastIndexOf(".")
  return at === -1 ? "" : path.slice(at).toLowerCase()
}
