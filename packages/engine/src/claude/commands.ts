import type { Event, SlashCommand, ThreadId } from "@omni/protocol"

interface RawCommand {
  name?: unknown
  description?: unknown
  argumentHint?: unknown
}

function commandOf(raw: unknown): SlashCommand | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const row = raw as RawCommand
  if (typeof row.name !== "string" || row.name.trim() === "") return undefined
  if (typeof row.description !== "string") return undefined
  return {
    name: row.name,
    description: row.description,
    ...(typeof row.argumentHint === "string" && row.argumentHint !== ""
      ? { argumentHint: row.argumentHint }
      : {}),
    source: "engine",
  }
}

/** SDK 的开场查询和中途推送共用同一份命令形状；空数组是有效的「清空旧清单」。 */
export function claudeCommands(
  raw: unknown,
  terminalCommands?: ReadonlySet<string>,
): readonly SlashCommand[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.flatMap((row) => {
    const command = commandOf(row)
    return command === undefined || terminalCommands?.has(command.name) === true ? [] : [command]
  })
}

/** init 给的终端专用命令是整份快照；旧 CLI 不报字段就保持空集。 */
export function captureTerminalCommands(
  raw: { subtype?: unknown; terminal_slash_commands?: unknown },
  target: Set<string>,
): void {
  if (raw.subtype !== "init") return
  target.clear()
  if (!Array.isArray(raw.terminal_slash_commands)) return
  for (const name of raw.terminal_slash_commands) {
    if (typeof name === "string" && name.trim() !== "") target.add(name)
  }
}

/** `commands_changed` 是整表替换；没这个 subtype 或没数组则不是一次上报。 */
export function emitChangedCommands(
  raw: { subtype?: unknown; commands?: unknown },
  ctx: {
    at: number
    threadId: ThreadId
    terminalCommands: ReadonlySet<string>
    emit: (event: Event) => void
  },
): void {
  if (raw.subtype !== "commands_changed") return
  const commands = claudeCommands(raw.commands, ctx.terminalCommands)
  if (commands === undefined) return
  ctx.emit({ type: "commands.updated", at: ctx.at, threadId: ctx.threadId, engine: "claude", commands })
}
