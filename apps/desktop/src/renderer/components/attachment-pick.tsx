function PaperclipIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.25 8.75 9.8 4.2a2.1 2.1 0 0 1 3 3l-5.5 5.5a3.35 3.35 0 0 1-4.75-4.75l5.2-5.2M5.1 10.15l5.35-5.35"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function AttachmentPick({
  visible,
  disabled,
  onPick,
}: {
  visible: boolean
  disabled: boolean
  onPick: () => void
}): React.JSX.Element | null {
  if (!visible) return null
  return (
    <button
      type="button"
      className="attach-pick"
      title="添加图片（也可拖入或粘贴）"
      aria-label="添加图片"
      disabled={disabled}
      onClick={onPick}
    >
      <PaperclipIcon />
    </button>
  )
}
