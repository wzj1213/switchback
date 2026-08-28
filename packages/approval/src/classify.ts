import { resolve } from "./path.js"
import { signature, splitSegments, type SplitResult } from "./command.js"
import type { Request } from "./types.js"

export type Category = "read" | "write" | "exec" | "net" | "meta" | "unknown"

export interface Normalized {
  category: Category
  /** 本次请求涉及的绝对路径。空数组表示判不出路径。 */
  paths: readonly string[]
  hosts: readonly string[]
  /** category === "exec" 时有意义 */
  split: SplitResult
  /** 每个命令段的归一签名 */
  signatures: readonly string[]
}

/**
 * 工具名 → 类别。按引擎硬编码，新工具落 `unknown`。
 * `unknown` 在 auto-edit 及以下一律 escalate——宁可多问，不可漏判。
 */
const TOOL_CATEGORY: Readonly<Record<string, Category>> = {
  // Claude Code
  Read: "read", Glob: "read", Grep: "read", NotebookRead: "read", BashOutput: "read",
  Write: "write", Edit: "write", MultiEdit: "write", NotebookEdit: "write",
  Bash: "exec", KillShell: "exec",
  WebFetch: "net", WebSearch: "net",
  // `Agent` 是**实测**（2026-08-19）模型起子 agent 时真正调的名字；`Task` 是它的旧名，
  // 两个都留着——引擎改名不会通知我们，而漏掉的那个会落 `unknown`，
  // 在只读档上被直接拒。**纯记账的工具被拒，模型只会反复重试**。
  //
  // 顺带记一笔实测：这一版的 `Agent` **不经过 `canUseTool`**（同一轮里只有 `Bash` 经过），
  // 所以这条今天并不构成 bug——它修的是「哪天它开始走这条路」的默认值。
  Task: "meta", Agent: "meta", TodoWrite: "meta", ExitPlanMode: "meta",
  // 待办那一族。**实测（2026-08-19）模型真调的是 `TaskCreate` / `TaskUpdate`**，
  // 而不是 `TodoWrite`——后者仍在 SDK 的声明里，但这台机器上没被调过。
  // 同样**不经过 `canUseTool`**，所以今天不构成 bug；补上修的是「哪天它开始走这条路」
  TaskCreate: "meta", TaskUpdate: "meta", TaskList: "meta", TaskGet: "meta",
  // **`AskUserQuestion` 是实测（2026-08-25）真的走了 `canUseTool` 的那一个**——
  // 上面 `Agent` 那条留的伏笔（「哪天它开始走这条路，表里得已经有它」）到期了。
  //
  // 漏掉它的后果比别的都荒唐：这个工具**除了向用户提一个问题什么都不做**，
  // 不写文件、不跑命令、不碰网络。落 `unknown` 之后，自动编辑档下它要弹一次窗——
  // **「请批准我向你提问」**，而用户挑的这一档对应的正是 Claude 自己的 Auto，
  // 那个档从来不会为提问弹窗（用户报的原话）。只读档更糟：`unknown` 直接拒，
  // 于是那一档里模型连问都问不了，而提问恰恰是它能做的最安全的动作。
  //
  // 它走这条路不是因为危险，是因为**要交互**：SDK 得让宿主去把问题呈现出来。
  // omni 拿静态判定去审一件本质是交互的事，审出来的只能是一层多余的窗。
  AskUserQuestion: "meta",
  // `ExitPlanMode` 的孪生兄弟，纯粹的模式开关。它上面那条已经在表里，
  // 只补这一条是为了两个方向别一个认得一个不认得
  EnterPlanMode: "meta",
  // codex app-server
  shell: "exec", apply_patch: "write", read_file: "read", update_plan: "meta", network: "net",
  // ACP：客户端侧方法（agent 反过来请我们代劳时用）
  "fs/read_text_file": "read", "fs/write_text_file": "write",
  "terminal/create": "exec", "terminal/output": "read",
  // ACP：agent 侧工具。协议里**没有「工具名」这个字段**，身份就是 `kind`，
  // 所以加 `acp:` 前缀入表——不加的话，一个叫 `read` 的 kind 会和别家撞名。
  "acp:read": "read", "acp:search": "read",
  "acp:edit": "write", "acp:delete": "write", "acp:move": "write",
  "acp:execute": "exec",
  "acp:fetch": "net",
  "acp:think": "meta", "acp:switch_mode": "meta",
  // `acp:other` 有意不入表：落 `unknown`，auto-edit 及以下一律 escalate。
  // 这正是想要的——第三方 ACP agent 冒出来的新工具，宁可多问一次。
}

/**
 * 工具**名字**的方向表。`tool` 认不出来时才用，认出来了一个字都不看。
 *
 * ## 为什么必须有这一层
 *
 * ACP 里工具的身份是 `kind`，而各家往那张短枚举上映射时是**有损的**：
 * 实测 kimi 只认十个名字（`Read`/`Glob`/`Grep`/`Write`/`Edit`/`Bash`/`Terminal`/
 * `WebFetch`/`WebSearch`/`Think`），其余一律报 `other`。它 k3 那套工具叫
 * `Shell`、`ReadFile`，于是全部落成 `acp:other` → `unknown` → 自动编辑档下
 * **每条简单命令都要弹一次窗**。而用户挑的「自动编辑」对应的正是 kimi 自己的
 * Auto 档（自动放行安全操作），体感对不上。
 *
 * ## 为什么是前缀而不是全表
 *
 * 那些名字是**服务端定义的**，本地枚举不出来（翻遍 kimi 的包也没有 `Shell` 这个
 * 字面量），所以只能按词根认方向。
 *
 * ## 认不出来仍然落 unknown
 *
 * 这是这张表的安全前提：**没有兜底成 allow 的分支**。认不出方向的工具照旧
 * `unknown` → 自动编辑及以下 escalate，和以前一模一样。这一层只把
 * 「明明看得出是读文件 / 跑命令」的那些捞回来。
 */
const NAME_CATEGORY: readonly (readonly [RegExp, Category])[] = [
  // 网络放在最前面：`WebFetch` 同时含 `fetch` 和 `web`，先判网络才不会被别的词根抢走
  [/^(?:web|fetch|http|curl|browse|download|url)/i, "net"],
  [/^(?:shell|bash|term|exec|run|cmd|command|process|kill)/i, "exec"],
  [/^(?:read|cat|view|show|open|list|ls|dir|glob|grep|search|find|lookup|inspect)/i, "read"],
  [/^(?:write|edit|create|new|apply|patch|update|insert|replace|append|save|delete|remove|move|rename|mkdir)/i, "write"],
  [/^(?:think|todo|plan|task|ask|note|memory|remember)/i, "meta"],
]

/**
 * 标签 → 名字。各家的标签是「名字 + 冒号 + 主参数」（实测 kimi：
 * `Shell: cd /x && ls`、`ReadFile: .claude/settings.json`），所以取第一段。
 *
 * **冒号后面那截有意不用**：它看着像命令原文，但那是引擎排版给人看的字符串，
 * 拿它当判定输入等于把展示层接进安全层。命令原文该从 `args.command` 来。
 */
function nameOfLabel(label: string | undefined): string {
  const head = (label ?? "").split(/[:：\s]/, 1)[0] ?? ""
  return head.trim()
}

function categoryOfName(name: string): Category | undefined {
  if (name === "") return undefined
  const direct = TOOL_CATEGORY[name]
  if (direct !== undefined) return direct
  return NAME_CATEGORY.find(([re]) => re.test(name))?.[1]
}

/**
 * 名字在括号里的那一种。**实测 ZCode**：审批请求的 `title` 是
 *
 * ```
 * tool permission (Bash)
 * ```
 *
 * 取第一段拿到的是 `tool`——一个方向词都不中，于是每一条 Bash 都落 `unknown`。
 * 而 `unknown` 恰好是**唯一**一个在「自动审批 → 完全访问」之间从 escalate 翻成
 * allow 的类别：用户的体感就是「必须开完全访问，否则连 `ls` 都要点一次放行」，
 * 而他挑的「自动审批」那一档在矩阵里 `exec` 本来就是 `allow`。
 *
 * ## 为什么敢看括号，而「冒号后面那截」仍然不看
 *
 * 冒号后面是**参数**（kimi 的 `Shell: cd /x && ls`），拿它判方向等于把展示层
 * 接进安全层。括号里是**名字**——而且这一层只在头一段认不出方向时才问它，
 * `Bash: rm (危险)` 这种头一段就中的，括号一眼都不看。
 *
 * ## 为什么放宽得起
 *
 * 认成 `exec` 之后并不等于放行：`blindExec` 紧跟着要求 `args.command` 也在。
 * **命令原文看不见的话它照旧退回 `unknown`**——于是这一条只可能在
 * 「omni 同时看得见命令原文」时生效，而那时靠命令原文的那 8 条红线
 *（凭据读取、越界删除、`npm i -g`、`git push`、解析不了…）全都是活的。
 */
const PARENTHESISED = /[(（]\s*([^)）]+?)\s*[)）]/g

function categoryOfLabel(label: string | undefined): Category | undefined {
  const head = categoryOfName(nameOfLabel(label))
  if (head !== undefined) return head
  for (const match of (label ?? "").matchAll(PARENTHESISED)) {
    const inner = categoryOfName(nameOfLabel(match[1]))
    if (inner !== undefined) return inner
  }
  return undefined
}

/**
 * 「跑命令」但**参数里本来就没有命令**的那几个工具。
 *
 * 它们的动作不在命令文本里：`KillShell` 杀的是一个已经在跑的后台 shell，
 * 参数是 shell id。所以下面那条「看不见命令就判不出」不适用于它们——
 * 它们不是「看不见」，是本来就没有。
 */
const EXEC_WITHOUT_COMMAND: ReadonlySet<string> = new Set(["KillShell"])

/**
 * 命令看不见时该按什么判。
 *
 * ## 为什么不能按 exec 放行
 *
 * `exec` 在 auto-edit 档下是 `allow`。而**一条我们从没见过的命令**被按 exec 放行，
 * 等于那 8 条靠命令原文的红线（凭据读取、越界删除、`exec-writes-outside-worksite`、
 * `git push`、`git-destructive`、`global-install`、`network`、`unparseable-command`）
 * 全部不存在——它们的判据都在 `norm.split` 里，而 `split` 是从 `args.command` 切出来的。
 *
 * 这在 ACP 上是**常态而非例外**：实测 kimi 的审批请求不带命令原文
 * （`rawInput` 要等批准之后才来），驱动会先等一小会儿（见 `acp/permission.ts`），
 * 等不到就把 `command` 留空——留空之后就走到这里。
 *
 * ## 为什么是 `unknown` 而不是新加一条红线
 *
 * 红线的 action 会**盖掉档位地板**：一条 escalate 红线在只读档下会把本该安静的
 * `deny` 变成一次弹窗。落 `unknown` 则正好让矩阵自己说话——
 * 只读 `deny`（安静拒掉）、自动编辑 `escalate`（问一次）、完全 `allow`。
 * 这也正是 `unknown` 那一列注释里写的取舍：宁可多问一次，不可漏判。
 */
function blindExec(req: Request, category: Category, command: string | undefined): boolean {
  return category === "exec" && command === undefined && !EXEC_WITHOUT_COMMAND.has(req.tool)
}

const PATH_ARG_KEYS = ["file_path", "path", "notebook_path", "filePath", "cwd"] as const
const URL_ARG_KEYS = ["url", "uri"] as const
const HOST_ARG_KEYS = ["host"] as const

/**
 * 一次请求涉及**多个**路径的情况。
 *
 * codex 的一个 `apply_patch` 可以同时改好几个文件；只认单数键的话，
 * 「写到工作区外」这类红线会漏掉第一个之外的所有路径——
 * 接第二家引擎才暴露出来的缺口。
 */
const PATH_LIST_KEYS = ["paths"] as const

function stringArg(args: Readonly<Record<string, unknown>>, keys: readonly string[]): string[] {
  const out: string[] = []
  for (const key of keys) {
    const value = args[key]
    if (typeof value === "string" && value !== "") out.push(value)
  }
  return out
}

function stringListArg(args: Readonly<Record<string, unknown>>, keys: readonly string[]): string[] {
  const out: string[] = []
  for (const key of keys) {
    const value = args[key]
    if (!Array.isArray(value)) continue
    for (const entry of value as readonly unknown[]) {
      if (typeof entry === "string" && entry !== "") out.push(entry)
    }
  }
  return out
}

/**
 * 这个 token 像不像一个路径。
 *
 * **裸相对路径也算。** 只认 `/`、`./`、`~/`、`../` 四种前缀的后果实测过：
 * `cat .env` 全程放行，而 `cat ./.env` 是 `deny credential-read`——
 * 同一件事换个写法就过；`cd ~ && rm -rf .ssh`、`cat $HOME/.ssh/id_rsa`
 * 同样一路绿灯。原因是 `norm.paths` 空了，凭据红线和越界删除红线**同时失明**。
 *
 * `fromCommand` 的注释本来就写着「宁滥勿缺——捞多了只会更保守」，
 * 所以这是实现漏了，不是当初的取舍。
 */
/** 明确以路径符号开头的写法：绝对、显式相对、home、变量、Windows 盘符或 UNC。 */
const PATHY_PREFIX = /^(?:\/|\.\.?\/|~$|~\/|\$|[A-Za-z]:[\\/]|\\\\)/

/** 不带这些前缀但仍是路径：含分隔符（`src/a.ts`），或点开头的名字（`.env`）。 */
const PATHY_SHAPE = /[/\\]|^\.[^.]/

function looksLikePath(token: string): boolean {
  // flag 不是路径（`-rf` 不是文件）
  if (token === "" || token.startsWith("-")) return false
  return PATHY_PREFIX.test(token) || PATHY_SHAPE.test(token)
}

function looksLikeUrl(token: string): boolean {
  return token.startsWith("http://") || token.startsWith("https://")
}

function hostOf(url: string): string | undefined {
  const match = /^https?:\/\/([^/:\s]+)/.exec(url)
  return match?.[1]
}

/** 从命令段里捞出看起来是路径和 URL 的位置参数。宁滥勿缺——捞多了只会更保守。 */
function fromCommand(split: SplitResult): { paths: string[]; urls: string[] } {
  const paths: string[] = []
  const urls: string[] = []
  for (const segment of split.segments) {
    for (const operand of segment.operands) {
      if (looksLikeUrl(operand)) urls.push(operand)
      else if (looksLikePath(operand)) paths.push(operand)
    }
  }
  return { paths, urls }
}

export function classify(req: Request, home: string): Normalized {
  // 名字只在 `tool` 认不出来时才看；认出来了以 `tool` 为准（见 `NAME_CATEGORY`）
  const named = TOOL_CATEGORY[req.tool] ?? categoryOfLabel(req.toolLabel) ?? "unknown"
  const command = typeof req.args["command"] === "string" && req.args["command"] !== "" ? req.args["command"] : undefined
  // 看不见命令就判不出这是什么动作——落 `unknown`，让档位矩阵自己说话（见 `blindExec`）
  const category = blindExec(req, named, command) ? "unknown" : named
  const split: SplitResult =
    command === undefined ? { segments: [], unparseable: false } : splitSegments(command)

  const fromArgs = [...stringArg(req.args, PATH_ARG_KEYS), ...stringListArg(req.args, PATH_LIST_KEYS)]
  const urlArgs = stringArg(req.args, URL_ARG_KEYS)
  const scraped = fromCommand(split)

  const paths = [...fromArgs, ...scraped.paths].map((p) => resolve(req.cwd, p, home))
  // `host` 已经是主机名，不能再当 URL 解析；只有 url/命令里的完整 URL 需要剥协议。
  const hosts = [
    ...stringArg(req.args, HOST_ARG_KEYS),
    ...[...urlArgs, ...scraped.urls].map(hostOf).filter((h): h is string => h !== undefined),
  ]

  return {
    category,
    paths: [...new Set(paths)],
    hosts: [...new Set(hosts)],
    split,
    signatures: split.segments.map(signature),
  }
}
