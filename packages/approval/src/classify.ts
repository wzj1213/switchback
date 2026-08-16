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
  Task: "meta", TodoWrite: "meta", ExitPlanMode: "meta",
  // codex app-server
  shell: "exec", apply_patch: "write", read_file: "read", update_plan: "meta",
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

const PATH_ARG_KEYS = ["file_path", "path", "notebook_path", "filePath", "cwd"] as const
const URL_ARG_KEYS = ["url", "uri"] as const

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
  const category = TOOL_CATEGORY[req.tool] ?? "unknown"
  const command = typeof req.args["command"] === "string" ? req.args["command"] : undefined
  const split: SplitResult =
    command === undefined ? { segments: [], unparseable: false } : splitSegments(command)

  const fromArgs = [...stringArg(req.args, PATH_ARG_KEYS), ...stringListArg(req.args, PATH_LIST_KEYS)]
  const urlArgs = stringArg(req.args, URL_ARG_KEYS)
  const scraped = fromCommand(split)

  const paths = [...fromArgs, ...scraped.paths].map((p) => resolve(req.cwd, p, home))
  const hosts = [...urlArgs, ...scraped.urls]
    .map(hostOf)
    .filter((h): h is string => h !== undefined)

  return {
    category,
    paths: [...new Set(paths)],
    hosts: [...new Set(hosts)],
    split,
    signatures: split.segments.map(signature),
  }
}
