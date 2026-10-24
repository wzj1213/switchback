import type { AgentMessageItem, Item, ToolCallItem, TurnId, TurnStatus } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { localeOf } from "../locale.js"
import { AGY_TRANSLATE } from "./translate.messages.js"

export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export interface Outcome { status: TurnStatus; error?: string }

function toolName(step: Record<string, unknown>, info: Record<string, unknown>, previous?: string): string {
  return text(step.tool_name) ?? text(info.name) ?? previous ?? "tool"
}

function toolInfo(step: Record<string, unknown>, before: Item | undefined) {
  const info = record(step.tool_info)
  const previous = before?.kind === "tool_call" ? before : undefined
  const detail = previous?.detail.kind === "other" ? previous.detail : undefined
  return {
    name: toolName(step, info, previous?.tool),
    input: info.parameters ?? detail?.input,
    output: info.output ?? step.subagent_info ?? detail?.output,
    failed: info.error !== undefined,
    error: text(info.error) ?? text(record(info.error).message),
  }
}

export function outcome(result: Record<string, unknown>, locale: Locale = DEFAULT_LOCALE): Outcome | undefined {
  const status = text(result.status)
  if (status === "RUNNING") return undefined
  if (status === "SUCCESS") return { status: "completed" }
  if (status === "CANCELED" || status === "INTERRUPTED") return { status: "interrupted" }
  const error = text(result.error) ?? text(record(result.error).message) ?? text(result.response)
  const m = AGY_TRANSLATE[locale]
  return { status: "failed", error: error || m.badStatus(status ?? m.noStatus) }
}

/** 只翻译公开的 step_update；usage 是累计量，不能当成上下文占用。 */
export class TurnStream {
  private readonly items = new Map<string, Item>()
  private hasText = false

  constructor(private readonly req: StartRequest, private readonly turnId: TurnId) {}

  step(step: Record<string, unknown>): void {
    if (typeof step.step_index !== "number") return
    const id = `agy:${this.turnId}:${String(step.step_index)}`
    if (step.step_type === "agent_response") this.message(id, step)
    if (step.step_type === "tool") this.tool(id, step)
  }

  response(response: unknown): void {
    if (!this.hasText && typeof response === "string" && response !== "") {
      this.message(`agy:${this.turnId}:result`, { text_delta: response, state: "DONE" })
    }
  }

  finish(status: TurnStatus): void {
    for (const item of this.items.values()) {
      if (item.kind === "agent_message" && !item.complete) this.put({ ...item, complete: true })
      if (item.kind === "tool_call" && item.status === "running") {
        // 没收到 DONE 就没有工具成功的证据，即使整轮 SUCCESS 也不替它补成功。
        this.put({ ...item, status: status === "interrupted" ? "interrupted" : "failed",
          error: AGY_TRANSLATE[localeOf(this.req)].noToolEnd })
      }
    }
  }

  private message(id: string, step: Record<string, unknown>): void {
    const before = this.items.get(id)
    const delta = text(step.text_delta) ?? ""
    const previous = before?.kind === "agent_message" ? before.text : ""
    if (delta !== "") this.hasText = true
    const item: AgentMessageItem = {
      id, nativeId: String(step.step_index ?? "result"), turnId: this.turnId,
      at: before?.at ?? Date.now(), kind: "agent_message", text: previous + delta,
      complete: step.state === "DONE",
    }
    if (before !== undefined && !item.complete) {
      this.items.set(id, item)
      this.req.emit({ type: "item.delta", at: Date.now(), itemId: id, append: delta })
    } else this.put(item)
  }

  private tool(id: string, step: Record<string, unknown>): void {
    const before = this.items.get(id)
    const info = toolInfo(step, before)
    const item: ToolCallItem = {
      id, nativeId: String(step.step_index), turnId: this.turnId,
      at: before?.at ?? Date.now(), kind: "tool_call", tool: info.name,
      status: info.failed ? "failed" : step.state === "DONE" ? "ok" : "running",
      detail: { kind: "other", name: info.name, input: info.input, output: info.output },
      ...(info.error === undefined ? {} : { error: info.error }),
    }
    this.put(item)
  }

  private put(item: Item): void {
    const type = this.items.has(item.id) ? "item.updated" : "item.started"
    this.items.set(item.id, item)
    this.req.emit({ type, at: Date.now(), item })
  }
}
