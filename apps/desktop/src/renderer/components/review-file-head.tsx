import { reviewLabel, type ReviewFile } from "../../shared/review.js"
import { revealable } from "../reveal.js"
import { copyFeedbackTitle, useCopyFeedback } from "../use-copy-feedback.js"
import { CheckIcon, CopyIcon, RevealIcon } from "./icons.js"
import { FileIcon } from "./icons-activity.js"
import { splitPath } from "../diff.js"

export function ReviewFileHead({ file, copyDisabled, onReveal, onCopy, onPreview }: {
  file: ReviewFile
  copyDisabled: boolean
  onReveal: () => void
  onCopy: () => unknown
  onPreview?: (() => void) | undefined
}): React.JSX.Element {
  const canGo = file.kind !== "delete" && revealable(file.path)
  const shown = splitPath(file.rel)
  const [copyFeedback, copy] = useCopyFeedback(onCopy)
  const copyTitle = copyDisabled
    ? "文件改动读取完成后才能复制"
    : copyFeedbackTitle(copyFeedback, "复制这份文件改动", "文件改动已复制")
  return (
    <div className="rv__file">
      <span className={`rvl__kind rvl__kind--${file.kind}`} aria-hidden="true" />
      <span className="rv__kindtext">{reviewLabel(file.kind)}</span>
      <span className="rv__path" title={file.rel}>
        <span className="rv__dir">{shown.dir}</span><strong>{shown.name}</strong>
      </span>
      {onPreview === undefined ? null : (
        <button type="button" className="rv__act" aria-label="预览当前文件" data-tip="预览当前文件" onClick={onPreview}>
          <FileIcon size={14} />
        </button>
      )}
      {canGo ? (
        <button type="button" className="rv__act" aria-label="在访达中显示"
          data-tip="在访达中显示" onClick={onReveal}>
          <RevealIcon size={14} />
        </button>
      ) : null}
      <button type="button" className="rv__act" aria-label={copyTitle}
        aria-live="polite" data-state={copyFeedback} data-tip={copyTitle}
        disabled={copyDisabled} onClick={copy}>
        {copyFeedback === "copied" ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      </button>
    </div>
  )
}
