import type { PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk"
import type { Request as ApprovalRequest } from "@switchback/approval"
import type { RememberScope } from "@switchback/protocol"

/**
 * `canUseTool` 回调携带的上下文。字段名与 SDK 一致。
 *
 * ⚠️ `title` / `description` / `decisionReason` / `matchedAskRule.*` 由工具或模型产出，
 * SDK 文档明确标注 render-unsafe——渲染前必须过 `sanitize()`。
 */
export interface AskMeta {
  /** CLI 撤回这次询问（停止、hook / 分类器抢先落定）时触发；宿主据此收卡，不留死卡。 */
  signal?: AbortSignal
  toolUseID: string
  suggestions?: readonly PermissionUpdate[]
  blockedPath?: string
  decisionReason?: string
  title?: string
  displayName?: string
  description?: string
  matchedAskRule?: { source: string; toolName: string; ruleContent?: string }
}

const MAX_SUMMARY = 300

/**
 * 控制字符（含换行、制表、DEL）。渲染前必须去掉。
 *
 * 这里 disable `no-control-regex` 是正当的：**匹配控制字符正是本函数的目的**。
 * SDK 文档把 `title` / `decisionReason` 等标为 render-unsafe，这条正则是那道防线。
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g

/** 去掉控制字符并截断。引擎产出的文本一律先过这里再进 UI。 */
export function sanitize(text: string): string {
  const stripped = text.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim()
  return stripped.length > MAX_SUMMARY ? `${stripped.slice(0, MAX_SUMMARY)}…` : stripped
}

/**
 * 是否必须打断用户，不管判定器怎么说。
 *
 * SDK 文档原文：带 `matchedAskRule` 的请求是**用户自己配的 ask 规则**强制出来的，
 * 「the user's stated intent is a human prompt」——宿主侧的自动批准必须让位。
 * 这是 Switchback 唯一一处「引擎的意见压过 Switchback 判定器」的地方。
 */
export function forcesHumanPrompt(meta: AskMeta): boolean {
  return meta.matchedAskRule !== undefined
}

/**
 * 用户 ask 规则强制的那张卡为什么出现。判定器那边说的是放行，它的理由是空的；
 * 照实写出是哪条规则（规则文本来自用户配置，同样先过 `sanitize`）。
 */
export function forcedReason(meta: AskMeta): string {
  const rule = meta.matchedAskRule
  if (rule === undefined) return ""
  const content = rule.ruleContent === undefined ? "" : `(${rule.ruleContent})`
  return `Claude 设置里的 ask 规则要求逐项确认：${sanitize(`${rule.toolName}${content}`)}`
}

/** 优先用 SDK 渲染好的人话标题；它比我们从 tool+args 拼的准。 */
export function summarize(toolName: string, meta: AskMeta): string {
  const candidate = meta.title ?? meta.description ?? meta.displayName
  if (candidate !== undefined && candidate !== "") return sanitize(candidate)
  return meta.blockedPath === undefined ? toolName : `${toolName} → ${sanitize(meta.blockedPath)}`
}

export interface RequestContext {
  engine: string
  cwd: string
}

export function buildRequest(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  meta: AskMeta,
  ctx: RequestContext,
): ApprovalRequest {
  const summary = summarize(toolName, meta)
  return { engine: ctx.engine, tool: toolName, args: input, cwd: ctx.cwd, summary }
}

export function toDeny(reason: string): PermissionResult {
  // `interrupt` 留空：拒绝单次调用，不掐断整轮——引擎读到 message 后通常会改方案。
  return { behavior: "deny", message: reason }
}

/** 只有「放行」的两类原生更新能当「此对话不再问」用；改模式归信任档管，删改规则不是放行。 */
const SESSION_GRANTS = new Set<PermissionUpdate["type"]>(["addRules", "addDirectories"])

/**
 * 放行。**原生规则只给「此对话」，而且目的地一律改成 `session`。**
 *
 * SDK 给的 `suggestions` 自带目的地，Bash、MCP 这几类是 `localSettings`：原样回传的话，
 * CLI 会把它写进项目里的 `.claude/settings.local.json`，「允许此对话」就成了这个项目的永久规则。
 * 而原生 allow 规则先于 `canUseTool` 生效——之后同前缀的命令（`git push *` 连 `--force` 一起）
 * 在 Switchback 内外都不再经过红线与审批卡。所以：
 * - `once` 不带规则；
 * - `guarded`（红线，或用户自己的 ask 规则强制要问）不带规则：前者要么每次问、要么由
 *   Switchback 按主机记，后者是用户亲口要求每次都问；
 * - `project`（「本项目始终允许」）由 Switchback 自己的规则表记，见 host 的 `remember`；
 * - `session` 只留 `addRules` / `addDirectories`，目的地改成 `session`，随这个 CLI 进程一起没。
 */
export function toAllow(scope: RememberScope, meta: AskMeta, guarded = false): PermissionResult {
  if (scope !== "session" || guarded) return { behavior: "allow" }
  const grants = (meta.suggestions ?? [])
    .filter((update) => SESSION_GRANTS.has(update.type))
    .map((update): PermissionUpdate => ({ ...update, destination: "session" }))
  return grants.length === 0 ? { behavior: "allow" } : { behavior: "allow", updatedPermissions: grants }
}
