import type { Request as ApprovalRequest } from "@omni/approval"
import { sanitize } from "../claude/permission.js"
import type { KimiApproval, KimiToolDisplay } from "./wire.js"

function displayOf(raw: unknown): KimiToolDisplay | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  return typeof (raw as { kind?: unknown }).kind === "string" ? (raw as KimiToolDisplay) : undefined
}

type ArgsBuilder = (display: KimiToolDisplay) => Readonly<Record<string, unknown>>

const ARGS: Readonly<Record<string, ArgsBuilder>> = {
  command: (display) => {
    const command = display as Extract<KimiToolDisplay, { kind: "command" }>
    return { command: command.command, ...(command.cwd === undefined ? {} : { cwd: command.cwd }) }
  },
  file_io: (display) => {
    const file = display as Extract<KimiToolDisplay, { kind: "file_io" }>
    return { path: file.path, paths: [file.path] }
  },
  diff: (display) => {
    const diff = display as Extract<KimiToolDisplay, { kind: "diff" }>
    return { path: diff.path, paths: [diff.path] }
  },
  url_fetch: (display) => ({ url: (display as Extract<KimiToolDisplay, { kind: "url_fetch" }>).url }),
  search: (display) => {
    const search = display as Extract<KimiToolDisplay, { kind: "search" }>
    return { query: search.query, ...(search.scope === undefined ? {} : { scope: search.scope }) }
  },
}

function argsOf(display: KimiToolDisplay | undefined): Readonly<Record<string, unknown>> {
  if (display === undefined) return {}
  return ARGS[display.kind]?.(display) ?? { ...display }
}

function fallbackSummary(display: KimiToolDisplay | undefined, tool: string): string {
  if (display?.kind === "command") return `执行 ${sanitize(display.command)}`
  if (display?.kind === "file_io") return `${display.operation} ${sanitize(display.path)}`
  if (display?.kind === "diff") return `修改 ${sanitize(display.path)}`
  if (display?.kind === "url_fetch") return `访问 ${sanitize(display.url)}`
  if (display?.kind === "generic") return sanitize(display.summary)
  return `执行 ${sanitize(tool)}（详情未送达）`
}

export function approvalSummary(approval: KimiApproval): string {
  const action = approval.action.trim()
  return action === "" ? fallbackSummary(displayOf(approval.tool_input_display), approval.tool_name) : sanitize(action)
}

export function approvalRequest(approval: KimiApproval, cwd: string): ApprovalRequest {
  const display = displayOf(approval.tool_input_display)
  return {
    engine: "kimi",
    tool: approval.tool_name,
    args: argsOf(display),
    cwd,
    summary: approvalSummary(approval),
  }
}
