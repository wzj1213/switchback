import { reviewLabel, type ReviewFile } from "../../shared/review.js"
import { revealable } from "../reveal.js"
import { copyFeedbackTitle, useCopyFeedback } from "../use-copy-feedback.js"
import { CheckIcon, CopyIcon, RevealIcon } from "./icons.js"

export function ReviewFileHead({ file, copyDisabled, onReveal, onCopy }: {
  file: ReviewFile
  copyDisabled: boolean
  onReveal: () => void
  onCopy: () => unknown
}): React.JSX.Element {
  const canGo = file.kind !== "delete" && revealable(file.path)
  const [copyFeedback, copy] = useCopyFeedback(onCopy)
  const copyTitle = copyDisabled
    ? "文件改动读取完成后才能复制"
    : copyFeedbackTitle(copyFeedback, "复制这份文件改动", "文件改动已复制")
  return (
    <div className="rv__file">
      <span className={`rvl__kind rvl__kind--${file.kind}`} aria-hidden="true" />
      <span className="rv__kindtext">{reviewLabel(file.kind)}</span>
      <span className="rv__path" title={file.rel}>{file.rel}</span>
      {canGo ? (
        <button type="button" className="rv__act" aria-label="在访达中显示"
          title="在访达中显示" onClick={onReveal}>
          <RevealIcon size={12} />
        </button>
      ) : null}
      <button type="button" className="rv__act" aria-label={copyTitle}
        aria-live="polite" data-state={copyFeedback} title={copyTitle}
        disabled={copyDisabled} onClick={copy}>
        {copyFeedback === "copied" ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      </button>
    </div>
  )
}
