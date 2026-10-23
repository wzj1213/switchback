import { reviewLabel, type ReviewFile } from "../../shared/review.js"
import { revealable } from "../reveal.js"
import { copyFeedbackTitle, useCopyFeedback } from "../use-copy-feedback.js"
import { useLocale, useMessages } from "../i18n.js"
import { REVIEW_FILE_HEAD } from "./review-file-head.messages.js"
import { CheckIcon, CopyIcon, RevealIcon } from "./icons.js"
import { FileIcon } from "./icons-activity.js"
import { splitPath } from "../diff.js"

export function ReviewFileHead({ file, copyDisabled, onReveal, onCopy, onPreview, onStage }: {
  file: ReviewFile
  copyDisabled: boolean
  onReveal: () => void
  onCopy: () => unknown
  onPreview?: (() => void) | undefined
  /** 暂存（`true`）或取消暂存（`false`）。缺席就不画这两颗。 */
  onStage?: ((stage: boolean) => void) | undefined
}): React.JSX.Element {
  const canGo = file.kind !== "delete" && revealable(file.path)
  const shown = splitPath(file.rel)
  const [copyFeedback, copy] = useCopyFeedback(onCopy)
  const locale = useLocale()
  const m = REVIEW_FILE_HEAD[locale]
  const copyTitle = copyDisabled
    ? m.copyWait
    : copyFeedbackTitle(copyFeedback, locale, m.copy, m.copied)
  return (
    <div className="rv__file">
      <span className={`rvl__kind rvl__kind--${file.kind}`} aria-hidden="true" />
      <span className="rv__kindtext">{reviewLabel(file.kind, locale)}</span>
      <span className="rv__path" title={file.rel}>
        <span className="rv__dir">{shown.dir}</span><strong>{shown.name}</strong>
      </span>
      {onStage === undefined ? null : <StageButtons staged={file.staged === true} onStage={onStage} />}
      {onPreview === undefined ? null : (
        <button type="button" className="rv__act" aria-label={m.preview} data-tip={m.preview} onClick={onPreview}>
          <FileIcon size={14} />
        </button>
      )}
      {canGo ? (
        <button type="button" className="rv__act" aria-label={m.reveal}
          data-tip={m.reveal} onClick={onReveal}>
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

/**
 * 「暂存」一直在（`git add` 本来就是幂等的：没什么可暂存时什么也不发生）；
 * 「取消暂存」只在 Git 说这个文件确实有一份在暂存区里时才出现。
 */
function StageButtons({ staged, onStage }: { staged: boolean; onStage: (stage: boolean) => void }): React.JSX.Element {
  const m = useMessages(REVIEW_FILE_HEAD)
  return (
    <>
      {staged ? (
        <button type="button" className="rv__stage" title={m.unstageTip} onClick={() => { onStage(false) }}>
          {m.unstage}
        </button>
      ) : null}
      <button type="button" className="rv__stage" title={m.stageTip} onClick={() => { onStage(true) }}>
        {m.stage}
      </button>
    </>
  )
}
