import { PaperclipIcon } from "./icons-panel.js"

export function AttachmentPick({ onPick }: { onPick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className="attach-pick"
      data-tip="添加文件或图片（也可拖入或粘贴）"
      aria-label="添加文件或图片"
      onClick={onPick}
    >
      <PaperclipIcon />
    </button>
  )
}
