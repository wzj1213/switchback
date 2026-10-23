import type { SlashCommand } from "@switchback/protocol"
import { commandLabel } from "../slash.js"
import { CommandIcon } from "./icons.js"
import { useMessages } from "../i18n.js"
import { COMMAND_TOKEN } from "./command-token.messages.js"

/** 已选命令是可视引用；参数留给旁边的 textarea，发送时再合成原始斜杠文本。 */
export function CommandToken({
  command,
  onRemove,
}: {
  command: SlashCommand
  onRemove: () => void
}): React.JSX.Element {
  const m = useMessages(COMMAND_TOKEN)
  const label = commandLabel(command)
  return (
    <button
      type="button"
      className="command-token"
      title={m.title(command.name)}
      aria-label={m.label(label)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onRemove}
    >
      <CommandIcon size={14} />
      <span className="command-token__label">{label}</span>
    </button>
  )
}
