import { createPortal } from "react-dom"
import type { DropHint } from "../attachment-feedback.js"

export function AttachmentDrop({
  hint,
  surface,
}: {
  hint: DropHint | undefined
  surface: boolean
}): React.JSX.Element | React.ReactPortal | null {
  if (hint === undefined) return null
  const overlay = (
    <div
      className={`composer-drop composer-drop--${hint.tone}${surface ? " composer-drop--surface" : ""}${hint.compact === true ? " composer-drop--notice" : ""}`}
      role="status"
    >
      <span>{hint.text}</span>
    </div>
  )
  return surface && typeof document !== "undefined" ? createPortal(overlay, document.body) : overlay
}
