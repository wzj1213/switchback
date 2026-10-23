import { reviewLabel, type ReviewFile } from "../../shared/review.js"
import { revealable } from "../reveal.js"
import { copyFeedbackTitle, useCopyFeedback } from "../use-copy-feedback.js"
import { useLocale } from "../i18n.js"
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
  const copyTitle = copyDisabled
    ? "文件改动读取完成后才能复制"
    : copyFeedbackTitle(copyFeedback, locale, "复制这份文件改动", "文件改动已复制")
  return (
    <div className="rv__file">
      <span className={`rvl__kind rvl__kind--${file.kind}`} aria-hidden="true" />
      <span className="rv__kindtext">{reviewLabel(file.kind)}</span>
      <span className="rv__path" title={file.rel}>
        <span className="rv__dir">{shown.dir}</span><strong>{shown.name}</strong>
      </span>
      {onStage === undefined ? null : <StageButtons staged={file.staged === true} onStage={onStage} />}
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

/**
 * 「暂存」一直在（`git add` 本来就是幂等的：没什么可暂存时什么也不发生）；
 * 「取消暂存」只在 Git 说这个文件确实有一份在暂存区里时才出现。
 */
function StageButtons({ staged, onStage }: { staged: boolean; onStage: (stage: boolean) => void }): React.JSX.Element {
  return (
    <>
      {staged ? (
        <button type="button" className="rv__stage" title="把这个文件从暂存区拿出来（工作区里的改动不动）" onClick={() => { onStage(false) }}>
          取消暂存
        </button>
      ) : null}
      <button type="button" className="rv__stage" title="把这个文件现在的改动放进暂存区，之后「提交已暂存」只提交暂存的那些" onClick={() => { onStage(true) }}>
        暂存
      </button>
    </>
  )
}
