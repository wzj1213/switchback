import type { SlashCommand } from "@switchback/protocol"
import { commandLabel } from "../slash.js"
import { CommandIcon } from "./icons.js"

/** 已选命令是可视引用；参数留给旁边的 textarea，发送时再合成原始斜杠文本。 */
export function CommandToken({
  command,
  onRemove,
}: {
  command: SlashCommand
  onRemove: () => void
}): React.JSX.Element {
  const label = commandLabel(command)
  return (
    <button
      type="button"
      className="command-token"
      title={`原生命令 /${command.name}；点击移除`}
      aria-label={`已选择 ${label}；点击移除`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onRemove}
    >
      <CommandIcon size={14} />
      <span className="command-token__label">{label}</span>
    </button>
  )
}
