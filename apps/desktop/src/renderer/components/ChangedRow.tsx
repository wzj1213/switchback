import type { ChangedFile } from "../changes.js"
import { splitPath } from "../diff.js"
import { relPath } from "../tool.js"
import { requestFilePreview } from "../file-preview-request.js"
import { CheckIcon, CopyIcon, RevealIcon } from "./icons.js"
import { FileIcon } from "./icons-activity.js"
import { outside } from "./file-row.js"
import { copyFeedbackTitle, useCopyFeedback } from "../use-copy-feedback.js"
import { useLocale, useMessages } from "../i18n.js"
import { CHANGED_ROW } from "./ChangedRow.messages.js"

interface Props {
  file: ChangedFile
  cwd: string
  threadId: string
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  /** 点文件名去哪儿：**右侧审核面板里那份 diff**。 */
  onOpen: (path: string) => void
}

function Stat({ added, removed }: { added: number; removed: number }): React.JSX.Element {
  return (
    <>
      {added > 0 ? <span className="diffstat__add">+{added}</span> : null}
      {removed > 0 ? <span className="diffstat__del">−{removed}</span> : null}
    </>
  )
}

function RevealFile({ file, onReveal }: { file: ChangedFile; onReveal: (path: string) => void }): React.JSX.Element | null {
  const m = useMessages(CHANGED_ROW)
  const review = file.review
  if (review?.kind === "delete" || (review === undefined && file.last.kind === "delete")) return null
  return (
    <button
      type="button"
      className="changed__act"
      aria-label={m.reveal}
      title={m.reveal}
      onClick={() => {
        onReveal(file.path)
      }}
    >
      <RevealIcon size={14} />
    </button>
  )
}

function PreviewFile({ file, threadId, cwd }: {
  file: ChangedFile
  threadId: string
  cwd: string
}): React.JSX.Element | null {
  const m = useMessages(CHANGED_ROW)
  const deleted = file.review?.kind === "delete" || (file.review === undefined && file.last.kind === "delete")
  if (deleted) return null
  return (
    <button
      type="button"
      className="changed__act"
      aria-label={m.preview}
      title={m.previewTip}
      onClick={() => {
        requestFilePreview(threadId, cwd, file.path)
      }}
    >
      <FileIcon size={14} />
    </button>
  )
}

/** 点文件名打开该轮原始编辑记录；预览按钮读取当前文件。 */
export function ChangedRow({
  file,
  cwd,
  threadId,
  onReveal,
  onCopy,
  onOpen,
}: Props): React.JSX.Element {
  const locale = useLocale()
  const m = CHANGED_ROW[locale]
  const shown = splitPath(relPath(file.path, cwd))
  const [feedback, copy] = useCopyFeedback(() => onCopy(`${file.path}\n\n${file.last.diff ?? m.noPatch}`))
  const copyTitle = copyFeedbackTitle(feedback, locale, m.copy, m.copied)
  return (
    <div className="changed__file">
      <div className="changed__row">
        <button
          type="button"
          className="changed__name"
          title={m.open(file.path)}
          onClick={() => {
            onOpen(file.path)
          }}
        >
          <span className="changed__dir">{shown.dir}</span>
          <span className="changed__base">{shown.name}</span>
        </button>
        {/* 「对话不在目标改动目录」时，这一行是唯一能看出来的地方——
            而那正是补丁看不看得到、文件点不点得开的分水岭 */}
        {outside(file.path, cwd) ? <span className="changed__tag">{m.outside}</span> : null}
        <span className="changed__stat">
          <Stat added={file.added} removed={file.removed} />
        </span>
        <PreviewFile file={file} threadId={threadId} cwd={cwd} />
        <RevealFile file={file} onReveal={onReveal} />
        <button
          type="button"
          className="changed__act"
          aria-label={copyTitle}
          title={copyTitle}
          data-state={feedback}
          aria-live="polite"
          onClick={copy}
        >
          {feedback === "copied" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
        </button>
      </div>
    </div>
  )
}
