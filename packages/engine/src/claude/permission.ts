import type { PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk"
import type { Request as ApprovalRequest } from "@switchback/approval"

/**
 * `canUseTool` 回调携带的上下文。字段名与 SDK 一致。
 *
 * ⚠️ `title` / `description` / `decisionReason` / `matchedAskRule.*` 由工具或模型产出，
 * SDK 文档明确标注 render-unsafe——渲染前必须过 `sanitize()`。
 */
export interface AskMeta {
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

/**
 * 放行。`remember` 为真时把 SDK 给的 `suggestions` 原样回传成 `updatedPermissions`——
 * 这是 SDK 原生的「本会话不再询问」，不需要 Switchback 自己造。
 */
export function toAllow(remember: boolean, meta: AskMeta): PermissionResult {
  const suggestions = meta.suggestions
  if (!remember || suggestions === undefined || suggestions.length === 0) {
    return { behavior: "allow" }
  }
  return { behavior: "allow", updatedPermissions: [...suggestions] }
}
