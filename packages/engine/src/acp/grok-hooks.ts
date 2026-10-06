import type { ToolStatus } from "@switchback/protocol"
import type { ForeignTool } from "./caps.js"

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined

interface HookOutcome {
  status: ToolStatus
  elapsedMs?: number
  error?: string
}

interface HookContext {
  eventName: string
  toolName: string | undefined
  promptId: string | undefined
}

function elapsed(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function outcome(value: unknown): HookOutcome | undefined {
  const raw = record(value)
  if (raw?.["status"] === "success") {
    const elapsedMs = elapsed(raw["elapsedMs"])
    return { status: "ok", ...(elapsedMs === undefined ? {} : { elapsedMs }) }
  }
  if (raw?.["status"] !== "failed") return undefined
  const error = text(raw["error"])
  if (error === undefined) return undefined
  const elapsedMs = elapsed(raw["elapsedMs"])
  return {
    status: raw["blocked"] === true ? "denied" : "failed",
    error,
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
  }
}

function meaningful(result: HookOutcome, output: string | undefined): boolean {
  return result.status !== "ok" || output !== undefined || (result.elapsedMs ?? 0) >= 300
}

function detailOf(
  name: string,
  ctx: HookContext,
  result: HookOutcome,
  output: string | undefined,
): ForeignTool["detail"] {
  return {
    kind: "other",
    name,
    input: {
      event: ctx.eventName,
      ...(ctx.toolName === undefined ? {} : { toolName: ctx.toolName }),
      ...(result.elapsedMs === undefined ? {} : { elapsedMs: result.elapsedMs }),
    },
    ...(output === undefined ? {} : { output }),
  }
}

function hookItem(value: unknown, ctx: HookContext): ForeignTool | undefined {
  const run = record(value)
  if (run === undefined) return undefined
  const name = text(run["name"])
  if (name === undefined) return undefined
  const result = outcome(run["status"])
  if (result === undefined) return undefined
  const output = text(run["output"])
  if (!meaningful(result, output)) return undefined
  const item: ForeignTool = {
    tool: `hook/${ctx.eventName}`,
    status: result.status,
    detail: detailOf(name, ctx, result, output),
    ...(ctx.promptId === undefined ? {} : { promptId: ctx.promptId }),
  }
  if (result.error !== undefined) item.error = result.error
  return item
}

/** 定时主动轮用原生前缀标身份；宿主关联仍取前缀后的 turn id。 */
function hostPromptId(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined
  const host = value.startsWith("scheduler-fired-") ? value.slice("scheduler-fired-".length) : value
  return host === "" ? undefined : host
}

/** Grok 已经执行完的 Hook 批次；只展示结果，不注册、不运行、也不改变 Hook 决策。 */
export function grokHookItems(method: string, params: unknown): readonly ForeignTool[] | undefined {
  if (method !== "_x.ai/session_notification") return undefined
  const note = params as {
    update?: Record<string, unknown>
    _meta?: { promptId?: unknown }
  } | undefined
  const update = note?.update
  if (update?.["sessionUpdate"] !== "hook_execution") return undefined
  const eventName = text(update["event_name"])
  const runs = update["runs"]
  if (eventName === undefined || !Array.isArray(runs)) return undefined
  const batchPrompt = hostPromptId(update["prompt_id"])
  const ctx = {
    eventName,
    toolName: text(update["tool_name"]),
    promptId: batchPrompt ?? hostPromptId(note?._meta?.promptId),
  }
  return runs.flatMap((run) => {
    const item = hookItem(run, ctx)
    return item === undefined ? [] : [item]
  })
}

/** 首方同名关联位：服务端只拿它回显和划界，不把它送进模型上下文。 */
export function grokPromptMeta(turnId: string): Readonly<Record<string, unknown>> {
  return { promptId: turnId }
}
