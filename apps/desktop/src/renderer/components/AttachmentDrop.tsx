import type { DropHint } from "../attachment-feedback.js"

export function AttachmentDrop({ hint }: { hint: DropHint | undefined }): React.JSX.Element | null {
  if (hint === undefined) return null
  return (
    <div className={`composer-drop composer-drop--${hint.tone}`} role="status">
      <span>{hint.text}</span>
    </div>
  )
}
