import { useMemo, useState } from "react"
import type { ChangedFile } from "../changes.js"
import { reportBody, reportedLines, reportedReviewFile } from "../turn-review.js"
import { requestFilePreview } from "../file-preview-request.js"
import { reveal } from "../reveal.js"
import { useLocale } from "../i18n.js"
import { REPORTED_REVIEW_PANE } from "./reported-review-pane.messages.js"
import { ReviewDiff } from "./ReviewDiff.js"
import { ReviewFileHead } from "./review-file-head.js"

/** 按原始顺序翻阅多次编辑；不把中间补丁拼成虚构的净差异。 */
export function ReportedReviewPane({ file, cwd, threadId, split, wrap, onCopy, onGit }: {
  file: ChangedFile
  cwd: string
  threadId: string
  split: boolean
  wrap: boolean
  onCopy: (text: string) => unknown
  onGit: () => void
}): React.JSX.Element {
  const history = file.edits ?? [file.last]
  const [picked, setPicked] = useState(history.length - 1)
  const edit = history[picked] ?? file.last
  const locale = useLocale()
  const m = REPORTED_REVIEW_PANE[locale]
  const note = reportBody(edit, locale)
  const lines = useMemo(() => note === undefined ? reportedLines(edit) : [], [edit, note])
  const current = reportedReviewFile({ ...file, last: edit }, cwd)
  const preview = (): void => { requestFilePreview(threadId, cwd, file.path) }
  return (
    <>
      <ReviewFileHead file={current} copyDisabled={note !== undefined}
        onReveal={() => { reveal(file.path) }} onPreview={edit.kind === "delete" ? undefined : preview}
        onCopy={() => onCopy(`${file.path}\n\n${edit.diff ?? ""}`)} />
      <div className="review-record">
        <span>{m.record}</span>
        {history.length > 1 ? (
          <label>{m.nthBefore}<select aria-label={m.pick} value={picked}
            onChange={(event) => { setPicked(Number(event.target.value)) }}>
            {history.map((_, index) => <option key={index} value={index}>{index + 1}</option>)}
          </select>{m.nthAfter(history.length)}</label>
        ) : <span>{m.reported}</span>}
      </div>
      {note === undefined ? (
        <ReviewDiff key={`${file.path}:${String(picked)}`} lines={lines} path={file.path}
          split={split} wrap={wrap} loading={false} />
      ) : (
        <div className="review-unavailable" role="status">
          <p>{note}</p>
          <div>
            {edit.kind === "delete" ? null : <button type="button" className="rv__seg" onClick={preview}>{m.preview}</button>}
            <button type="button" className="rv__seg" onClick={onGit}>{m.git}</button>
          </div>
        </div>
      )}
    </>
  )
}
