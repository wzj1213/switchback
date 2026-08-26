import { PaperclipIcon } from "./icons-panel.js"

export function AttachmentPick({
  disabled,
  onPick,
}: {
  disabled: boolean
  onPick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="attach-pick"
      title="添加文件或图片（也可拖入或粘贴）"
      aria-label="添加文件或图片"
      disabled={disabled}
      onClick={onPick}
    >
      <PaperclipIcon />
    </button>
  )
}
