import type { FileChange, ToolCallItem, ToolDetail, ToolStatus, TurnId } from "@switchback/protocol"
import { synthDiff } from "../synth.js"
import type { KimiPayload, KimiToolDisplay, KimiTranscriptFrame } from "./wire.js"

function record(raw: unknown): Readonly<Record<string, unknown>> {
  return typeof raw === "object" && raw !== null ? (raw as Readonly<Record<string, unknown>>) : {}
}

function text(raw: unknown): string | undefined {
  return typeof raw === "string" && raw !== "" ? raw : undefined
}

function file(path: string, before: string | undefined, after: string | undefined): FileChange {
  if (before === undefined) {
    const body = after ?? ""
    return { path, kind: "add", diff: body, added: synthDiff("", body).added, removed: 0 }
  }
  const diff = synthDiff(before, after ?? "")
  return { path, kind: "update", diff: diff.diff, added: diff.added, removed: diff.removed }
}

function editDetail(display: Extract<KimiToolDisplay, { kind: "file_io" | "diff" }>): ToolDetail {
  const before = display.before
  const after = display.kind === "file_io" ? display.after ?? display.content : display.after
  const change = file(display.path, before, after)
  return { kind: "file_edit", path: display.path, files: [change], added: change.added, removed: change.removed }
}

function commandDetail(display: KimiToolDisplay): ToolDetail {
  const command = display as Extract<KimiToolDisplay, { kind: "command" }>
  return { kind: "shell", command: command.command, ...(command.cwd === undefined ? {} : { cwd: command.cwd }) }
}

function fileDetail(display: KimiToolDisplay): ToolDetail {
  const file = display as Extract<KimiToolDisplay, { kind: "file_io" }>
  if (file.operation === "read") return { kind: "file_read", path: file.path }
  if (file.operation === "write" || file.operation === "edit") return editDetail(file)
  return { kind: "other", name: file.operation, input: file }
}

const DETAILS: Readonly<Record<string, (display: KimiToolDisplay) => ToolDetail>> = {
  command: commandDetail,
  file_io: fileDetail,
  diff: (display) => editDetail(display as Extract<KimiToolDisplay, { kind: "diff" }>),
  url_fetch: (display) => ({ kind: "fetch", url: (display as Extract<KimiToolDisplay, { kind: "url_fetch" }>).url }),
}

function displayDetail(display: KimiToolDisplay | undefined, name: string, args: unknown): ToolDetail {
  if (display === undefined) return { kind: "other", name, input: args }
  return DETAILS[display.kind]?.(display) ?? { kind: "other", name, input: args ?? display }
}

function outputText(output: unknown): string | undefined {
  if (typeof output === "string") return output
  const raw = record(output)
  for (const key of ["formatted_output", "output", "stdout", "text"]) {
    const value = text(raw[key])
    if (value !== undefined) return value
  }
  if (output === undefined || output === null) return undefined
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

function exitCode(output: unknown): number | undefined {
  const value = record(output)["exit_code"]
  return typeof value === "number" ? value : undefined
}

export function startTool(payload: KimiPayload, turnId: TurnId, at: number): ToolCallItem | undefined {
  const id = payload.toolCallId
  const name = payload.name
  if (id === undefined || name === undefined) return undefined
  return {
    id,
    turnId,
    at,
    kind: "tool_call",
    tool: name,
    status: "running",
    detail: displayDetail(payload.display, name, payload.args),
  }
}

export function finishTool(item: ToolCallItem, output: unknown, failed: boolean): ToolCallItem {
  const rendered = outputText(output)
  const code = exitCode(output)
  const status: ToolStatus = failed || (code !== undefined && code !== 0) ? "failed" : "ok"
  if (item.detail.kind !== "shell") {
    const detail = item.detail.kind === "other" ? { ...item.detail, output } : item.detail
    return { ...item, status, detail, ...(failed && rendered !== undefined ? { error: rendered } : {}) }
  }
  return {
    ...item,
    status,
    detail: {
      ...item.detail,
      ...(code === undefined ? {} : { exitCode: code }),
      ...(rendered === undefined ? {} : { output: rendered }),
    },
    ...(failed && rendered !== undefined ? { error: rendered } : {}),
  }
}

export function transcriptTool(frame: Extract<KimiTranscriptFrame, { kind: "tool" }>, turnId: TurnId, at: number): ToolCallItem {
  const base: ToolCallItem = {
    id: frame.toolCallId || frame.frameId,
    turnId,
    at,
    kind: "tool_call",
    tool: frame.name,
    status: "running",
    detail: displayDetail(frame.display, frame.name, frame.input),
  }
  if (frame.state === "running") return base
  return finishTool(base, frame.output ?? frame.error, frame.state === "error")
}

export function sweepTool(item: ToolCallItem, status: "failed" | "interrupted"): ToolCallItem {
  return item.status === "running" || item.status === "pending" ? { ...item, status } : item
}
