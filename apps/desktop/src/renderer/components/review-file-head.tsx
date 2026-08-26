import { reviewLabel, type ReviewFile } from "../../shared/review.js"
import { revealable } from "../reveal.js"
import { CopyIcon, RevealIcon } from "./icons.js"

export function ReviewFileHead({ file, copyDisabled, onReveal, onCopy }: {
  file: ReviewFile
  copyDisabled: boolean
  onReveal: () => void
  onCopy: () => void
}): React.JSX.Element {
  const canGo = file.kind !== "delete" && revealable(file.path)
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
      <button type="button" className="rv__act" aria-label="复制这份文件改动"
        title={copyDisabled ? "文件改动读取完成后才能复制" : "复制这份文件改动"}
        disabled={copyDisabled} onClick={onCopy}>
        <CopyIcon size={12} />
      </button>
    </div>
  )
}
