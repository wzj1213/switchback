import type { Event, ThreadId } from "@switchback/protocol"
import type { Locale } from "@switchback/i18n"
import { KimiMcpStatus, type KimiMcpSnapshot } from "./mcp-status.js"
import type { KimiPayload } from "./wire.js"

export type { KimiMcpSnapshot } from "./mcp-status.js"

interface ErrorOut {
  threadId: ThreadId
  emit: (event: Event) => void
  /** 只给 MCP 那几条连起来时用；Kimi 自己报的错照原样显示。 */
  locale?: () => Locale
}

interface NativeError {
  code: string
  message: string
  details?: Record<string, unknown>
}

interface ExpectedDuplicate {
  seq: number
  error: NativeError
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function nativeError(raw: unknown): NativeError | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const code = text(record["code"])
  const message = text(record["message"])
  if (code === undefined || message === undefined) return undefined
  const details = record["details"]
  return {
    code,
    message,
    ...(typeof details === "object" && details !== null ? { details: details as Record<string, unknown> } : {}),
  }
}

function sameError(left: NativeError | undefined, right: NativeError): boolean {
  return left?.code === right.code && left.message === right.message
}

function filteredMessage(error: NativeError): string | undefined {
  const finish = text(error.details?.["finishReason"])
  const raw = text(error.details?.["rawFinishReason"])
  if (finish !== "filtered" && raw !== "content_filter") return undefined
  const suffix = raw === undefined ? "" : `, rawFinishReason=${raw}`
  return `Provider filtered the response before visible output (finishReason=${finish ?? "filtered"}${suffix}).`
}

function display(error: NativeError): string {
  return `[${error.code}] ${filteredMessage(error) ?? error.message}`
}

/** Kimi error 没有 turnId；去掉 turn.ended 的相邻副本，其余按原生 TUI 样式展示。 */
export class KimiDiagnostics {
  private duplicate: ExpectedDuplicate | undefined
  private readonly mcp: KimiMcpStatus

  constructor(private readonly out: ErrorOut, mcp?: KimiMcpSnapshot) {
    this.mcp = new KimiMcpStatus(out)
    this.mcp.seed(mcp)
  }

  handle(payload: KimiPayload, at: number, seq: number | undefined): boolean {
    if (this.mcp.handle(payload, at)) return true
    if (payload.type === "turn.ended") {
      const error = payload.reason === "failed" ? nativeError(payload.error) : undefined
      this.duplicate = error === undefined || seq === undefined ? undefined : { seq: seq + 1, error }
      return false
    }
    if (payload.type !== "error") return false
    const error = nativeError(payload)
    const expected = this.duplicate
    const duplicate = error !== undefined && expected !== undefined && expected.seq === seq && sameError(expected.error, error)
    this.duplicate = undefined
    if (error !== undefined && !duplicate) {
      this.out.emit({
        type: "engine.notification",
        at,
        threadId: this.out.threadId,
        engine: "kimi",
        key: `session-error:${error.code}`,
        message: display(error),
        priority: "high",
      })
    }
    return true
  }

  reportMcpHealth(at: number): void {
    this.mcp.reportHealth(at)
  }
}
