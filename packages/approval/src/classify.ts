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
  // ACP
  "fs/read_text_file": "read", "fs/write_text_file": "write",
  "terminal/create": "exec", "terminal/output": "read",
}

const PATH_ARG_KEYS = ["file_path", "path", "notebook_path", "filePath", "cwd"] as const
const URL_ARG_KEYS = ["url", "uri"] as const

function stringArg(args: Readonly<Record<string, unknown>>, keys: readonly string[]): string[] {
  const out: string[] = []
  for (const key of keys) {
    const value = args[key]
    if (typeof value === "string" && value !== "") out.push(value)
  }
  return out
}

function looksLikePath(token: string): boolean {
  return token.startsWith("/") || token.startsWith("./") || token.startsWith("~/") || token.startsWith("../")
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

  const fromArgs = stringArg(req.args, PATH_ARG_KEYS)
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
