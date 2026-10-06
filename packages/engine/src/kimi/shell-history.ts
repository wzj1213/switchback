import type { Item, NoticeItem, TurnId, UserMessageItem } from "@switchback/protocol"
import type { KimiTranscriptTurn } from "./wire.js"

interface ShellOrigin {
  phase: "input" | "output"
  isError: boolean
}

// 这些正则的目的就是移除 Kimi 原生 renderer 同一组终端控制字符。
// eslint-disable-next-line no-control-regex
const CSI = /\u001B\[[0-9:;<=>?]*[ -/]*[@-~]/g
// eslint-disable-next-line no-control-regex
const OSC = /\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g
// eslint-disable-next-line no-control-regex
const ESCAPE = /\u001B(?:[ -/][0-~]|[0-~])/g
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001B\u001C-\u001F]/g

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function shellOrigin(raw: unknown): ShellOrigin | undefined {
  const root = record(raw)
  const value = record(root?.["payload"]) ?? root
  if (value?.["kind"] !== "shell_command") return undefined
  const phase = value["phase"]
  if (phase !== "input" && phase !== "output") return undefined
  return { phase, isError: value["isError"] === true }
}

function unescapeXml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
}

function tagText(text: string, tag: string): string | undefined {
  const open = `<${tag}>`
  const close = `</${tag}>`
  const start = text.indexOf(open)
  const end = text.indexOf(close, start + open.length)
  return start === -1 || end === -1 ? undefined : unescapeXml(text.slice(start + open.length, end))
}

function safeOutput(text: string): string {
  return text.replace(OSC, "").replace(CSI, "").replace(ESCAPE, "").replace(CONTROL, "")
}

function inputItem(prompt: string, turnId: TurnId, at: number): UserMessageItem {
  const command = (tagText(prompt, "bash-input") ?? prompt).trim()
  return {
    id: `${turnId}-prompt`,
    turnId,
    at,
    kind: "user_message",
    text: `$ ${command}`,
    origin: { kind: "shell" },
  }
}

function outputItem(prompt: string, turnId: TurnId, at: number, isError: boolean): NoticeItem {
  const stdout = safeOutput(tagText(prompt, "bash-stdout") ?? "").trimEnd()
  const stderr = safeOutput(tagText(prompt, "bash-stderr") ?? "").trimEnd()
  const message = [stdout, stderr].filter((part) => part !== "").join("\n") || "(no output)"
  return {
    id: `${turnId}-shell-output`,
    turnId,
    at,
    kind: "notice",
    message,
    level: isError ? "warning" : "info",
  }
}

/** Kimi 公开历史用 XML 保存 `!` 命令；恢复时镜像原生 replay 的可见文本。 */
export function kimiShellHistoryItem(
  turn: KimiTranscriptTurn,
  turnId: TurnId,
  at: number,
): Item | undefined {
  const origin = shellOrigin(turn.origin)
  if (origin === undefined || turn.prompt === undefined) return undefined
  return origin.phase === "input"
    ? inputItem(turn.prompt, turnId, at)
    : outputItem(turn.prompt, turnId, at, origin.isError)
}
