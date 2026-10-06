/**
 * 引擎自己的**钩子配置**读出来长什么样。
 *
 * ## 为什么 Switchback 要管这件事
 *
 * 钩子是「引擎在某个时刻替你跑一条命令」——提交前跑格式化、会话结束重启服务。
 * 它写在**引擎自己的配置文件**里（Claude 的 `settings.json`、codex 的 `config.toml`），
 * 而这两份文件散在四五个位置、还按项目叠加。于是最常见的一幕是：
 * 你写了一条钩子，然后**不知道它到底跑没跑**——没有任何界面回答这个问题，
 * 只能等它某次生效（或者某次没生效）才发现。
 *
 * Switchback 是这台机器上唯一同时起着这几家引擎的地方，把这份摊开来是它顺手能做的事。
 *
 * ## 只读，不写
 *
 * 这里出去的每一条都对应用户自己写的文件。Switchback **不提供开关**：
 * 那意味着替用户改他手写的配置（改哪份？项目那份是提交进仓库的），
 * 而这件事他的编辑器做得比我们好。我们负责的是「让他看得见」。
 *
 * ## 四家，两种形状
 *
 * - **Claude / codex / grok**：`hooks.<事件>[].hooks[]`——Claude 写在 JSON 里，
 *   另两家写成 TOML 的 `[[hooks.Stop]]` + `[[hooks.Stop.hooks]]`，解析出来一模一样。
 * - **Kimi Code**：一张**平表** `[[hooks]]`，事件写在条目自己身上
 *   （`event = "PreToolUse"`）。
 *
 * 所以这里是两个读法，不是四个：`hookLines` 与 `hookLinesFlat`。
 */

/** 有钩子这回事的那几家。第三方 ACP 引擎不在内——Switchback 不知道它们的配置长什么样。 */
export type HookEngine = "claude" | "codex" | "kimi" | "grok"

/** 配置来自哪一层。顺序就是优先级从低到高。 */
export type HookScope = "user" | "project" | "local" | "managed"

/** 一条钩子。**命令原文一定要带**——「有 3 个钩子」回答不了「它会干什么」。 */
export interface HookLine {
  /** 生命周期事件，原样保留引擎写的那个名字（`PreToolUse` / `Stop` / …）。 */
  event: string
  /** Claude 的 matcher（按工具名筛）。codex 没有这一项。 */
  matcher?: string
  /** 将要执行的命令原文。 */
  command: string
  /** 秒。引擎没写就没有——**不替它编一个默认值**。 */
  timeout?: number
  /** 跑的时候界面上显示的那句话（Claude 的 `statusMessage`）。 */
  note?: string
  /**
   * codex 专有：这条**审过没有**。
   *
   * codex 的钩子是信任门控的——项目里带来的一条命令，它第一次跑到之前会让你审一遍，
   * 审过的记在 `~/.codex/config.toml` 的 `[hooks.state]` 里。没记的那条**不会跑**，
   * 而这正是「配了却没生效」最常见的原因。
   */
  trust?: "trusted" | "pending"
}

/** 一个配置来源：一份文件 + 它里面的钩子。 */
export interface HookSource {
  engine: HookEngine
  scope: HookScope
  /** 配置文件的绝对路径。**没有这个文件时也要有这一条**——「这儿可以配」本身是信息。 */
  path: string
  exists: boolean
  hooks: readonly HookLine[]
  /** 读不动/解析不了时引擎给的原话。有这一项就说明下面那份钩子**不完整**。 */
  error?: string
}

/** 「环境」那一页要的全部。 */
export interface EnvConfig {
  /** 按哪个工作区算的。没有会话时是 undefined，那时只有用户级那几份。 */
  cwd?: string
  /**
   * 家目录。**界面拿它把路径缩成 `~/.claude/settings.json`**——
   * 渲染层没有 `os.homedir()`，而一行 `/Users/……/settings.json` 里
   * 前一半对读的人没有任何信息量。
   */
  home: string
  sources: readonly HookSource[]
  /** Claude 的总开关（`disableAllHooks`）。真的话下面列的**一条都不会跑**。 */
  disabledAll: boolean
  /** 管理员把它设成只跑管理员那份（`allowManagedHooksOnly`）。 */
  managedOnly: boolean
}

/** 问一条钩子审过没有。codex 用；Claude 没有这套机制，传 undefined。 */
export type TrustAsk = (event: string, group: number, index: number) => HookLine["trust"]

/**
 * 把一份 `hooks` 表读成一串钩子。
 *
 * **逐字段校验，不整份信任**：这两份文件都是用户手写的，也可能是别的版本写的。
 * 读不懂的条目直接跳过——列出一条 `command` 是数字的钩子，比不列它更糟。
 *
 * codex 的 `[hooks.state]` 天然被挡在外面：它是表不是数组。
 */
export function hookLines(raw: unknown, trust?: TrustAsk): readonly HookLine[] {
  const table = asRecord(raw)
  if (table === undefined) return []
  const out: HookLine[] = []
  for (const [event, groups] of Object.entries(table)) {
    if (!Array.isArray(groups)) continue
    groups.forEach((group, gi) => {
      out.push(...groupLines(event, group, gi, trust))
    })
  }
  return out
}

/** 一个 matcher 组里的那几条。 */
function groupLines(event: string, group: unknown, gi: number, trust?: TrustAsk): readonly HookLine[] {
  const it = asRecord(group)
  const list = it?.["hooks"]
  if (!Array.isArray(list)) return []
  const matcher = typeof it?.["matcher"] === "string" ? (it["matcher"] as string) : undefined
  const out: HookLine[] = []
  list.forEach((item, hi) => {
    const line = hookLine(event, item, trust?.(event, gi, hi))
    if (line !== undefined) out.push({ ...line, ...(matcher === undefined || matcher === "" ? {} : { matcher }) })
  })
  return out
}

/** 一条。**命令拿不到就整条不要**——没有命令的钩子在界面上是一行废话。 */
function hookLine(event: string, raw: unknown, trust: HookLine["trust"]): HookLine | undefined {
  const it = asRecord(raw)
  const command = it?.["command"]
  if (typeof command !== "string" || command === "") return undefined
  const timeout = it?.["timeout"]
  const note = it?.["statusMessage"]
  return {
    event,
    command,
    ...(typeof timeout === "number" ? { timeout } : {}),
    ...(typeof note === "string" && note !== "" ? { note } : {}),
    ...(trust === undefined ? {} : { trust }),
  }
}

/**
 * Kimi Code 那张**平表**：`[[hooks]]`，事件写在条目自己身上。
 *
 * 单独一个函数而不是在 `hookLines` 里判类型：两家的形状是各自的产品决定，
 * 混在一个函数里之后，任何一家改了格式都要来动同一段代码。
 */
export function hookLinesFlat(raw: unknown): readonly HookLine[] {
  if (!Array.isArray(raw)) return []
  const out: HookLine[] = []
  for (const item of raw) {
    const it = asRecord(item)
    const event = it?.["event"]
    const line = hookLine(typeof event === "string" ? event : "", item, undefined)
    // 事件名读不出来就整条不要：一条不知道什么时候会跑的钩子，列出来也没法判断
    if (line !== undefined && line.event !== "") {
      const matcher = it?.["matcher"]
      out.push({ ...line, ...(typeof matcher === "string" && matcher !== "" ? { matcher } : {}) })
    }
  }
  return out
}

/**
 * codex 信任表里的键。
 *
 * 形如 `/path/.codex/hooks.json:pre_tool_use:0:0`——文件路径、**蛇形小写**的事件名、
 * 组下标、条目下标。格式是从 codex 自己写下的那份 `[hooks.state]` 反出来的。
 *
 * **蛇形这一步不能省。** 一开始写的是 `toLowerCase()`，样本恰好是 `Stop`
 *（单个词，两种写法一样），于是它看起来是对的；直到遇上 `PreToolUse` 才露馅——
 * `pretooluse` 在信任表里永远查不到，界面会把一条早就审过的钩子标成「待审核」。
 * 「用一个正好分不出对错的样本验收」是这类 bug 的标准出场方式。
 */
export function trustKeyOf(path: string, event: string, group: number, index: number): string {
  return `${path}:${snake(event)}:${String(group)}:${String(index)}`
}

/** `PreToolUse` → `pre_tool_use`。已经是蛇形/单词的原样小写。 */
function snake(event: string): string {
  return event.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
}

/**
 * 事件说明。**只写认得的那些**，认不出就把原名摆出来——
 * 各家都在加新事件，编一句解释比不解释更糟。
 */
export const EVENT_TEXT: Readonly<Record<string, string>> = {
  PreToolUse: "工具执行前",
  PostToolUse: "工具执行后",
  PostToolUseFailure: "工具执行失败后",
  UserPromptSubmit: "你发出一句话时",
  Notification: "引擎要通知你时",
  SessionStart: "会话开始时",
  SessionEnd: "会话结束时",
  Stop: "这一轮答完之前",
  StopFailure: "这一轮出错收尾时",
  SubagentStart: "子 agent 开始时",
  SubagentStop: "子 agent 收尾时",
  PreCompact: "压缩上下文之前",
  PostCompact: "压缩上下文之后",
  PermissionRequest: "要权限时",
  PermissionDenied: "权限被拒后",
  Setup: "首次装配时",
  FileChanged: "文件变了时",
  CwdChanged: "换目录时",
  // 以下几个只有 Kimi Code 有
  UserPromptQueued: "你的话被排进队列时",
  TurnStarted: "这一轮开始时",
  Interrupt: "被打断时",
  SessionHeartbeat: "会话心跳",
  TaskStarted: "后台任务开始时",
  PermissionResult: "权限判完之后",
}

/** 那一层配置的中文说法。**和界面上的分组标题共用这一份**，不写第二遍。 */
export const SCOPE_TEXT: Readonly<Record<HookScope, string>> = {
  managed: "管理员配置",
  user: "用户配置",
  project: "项目配置",
  local: "本机私有配置",
}

/** 把家目录缩成 `~`。缩不了就原样——**不猜**。 */
export function shortPath(path: string, home: string): string {
  return home !== "" && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

function asRecord(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined
}
