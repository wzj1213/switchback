import { PaperclipIcon } from "./icons-panel.js"
import { useMessages } from "../i18n.js"
import { ATTACHMENT_PICK } from "./attachment-pick.messages.js"

export function AttachmentPick({ onPick }: { onPick: () => void }): React.JSX.Element {
  const m = useMessages(ATTACHMENT_PICK)
  return (
    <button
      type="button"
      className="attach-pick"
      data-tip={m.tip}
      aria-label={m.label}
      onClick={onPick}
    >
      <PaperclipIcon />
    </button>
  )
}
