import { useState } from "react"
import type { Item } from "@omni/protocol"
import type { ReviewFile } from "../../shared/review.js"
import { reconcileChanges, reportedChangesOf } from "../changes.js"
import { useReview } from "../review.js"
import { ChangedOthers, CHANGED_PREVIEW } from "./changed-others.js"
import { ChangedRow } from "./ChangedRow.js"
import { ChangedHead } from "./changed-head.js"
import { changeNote } from "../changed-note.js"

interface Props {
  items: readonly Item[]
  threadId: string
  cwd: string
  stamp: string
  /** 新一轮运行时保留数据订阅，但整张卡退出视线。 */
  hidden?: boolean
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onReview: () => void
}

function shouldHide(state: { hidden: boolean; loading: boolean; failed: boolean; files: number; others: number }): boolean {
  return state.hidden || state.loading || (state.files === 0 && state.others === 0 && !state.failed)
}

/** 会话触达文件的当前净变更：总数 → 文件清单 → git 实时补丁。 */
export function Changed({
  items,
  threadId,
  cwd,
  stamp,
  hidden = false,
  onReveal,
  onCopy,
  onReview,
}: Props): React.JSX.Element | null {
  const reported = reportedChangesOf(items, cwd)
  const review = useReview(cwd, stamp, {
    threadId,
    wanted: reported.list.map((file) => file.path),
  })
  const verified = review.baseline && !review.failed
  const { files, added, removed, list } = !verified
    ? reported
    : reconcileChanges(reported, review.files, review.root, {
        reported: cwd,
        real: review.cwd,
        ...(review.ignored === undefined ? {} : { ignored: review.ignored }),
      })
  const [open, setOpen] = useState(true)
  const [all, setAll] = useState(false)
  const mine = new Set(list.flatMap((file) => file.review?.rel ?? []))
  const minePaths = new Set(list.map((file) => file.path))
  const others = verified
    ? review.files.filter((file) => !mine.has(file.rel) && !minePaths.has(file.path))
    : []
  const othersTotal = others.length + (review.more ?? 0)
  if (shouldHide({ hidden, loading: review.loading, failed: review.failed, files, others: othersTotal })) return null
  return (
    <section className="changed" aria-label="文件改动摘要">
      <div className="changed__card">
        <ChangedHead
          files={files}
          others={othersTotal}
          added={added}
          removed={removed}
          failed={review.failed}
          open={open}
          onOpen={() => {
            setOpen((was) => !was)
          }}
          onReview={onReview}
        />
        {open ? (
          <List
            files={list}
            others={others}
            othersTotal={othersTotal}
            all={all}
            cwd={cwd}
            stamp={`${stamp}\u0000${review.revision}`}
            threadId={threadId}
            note={changeNote(review, list)}
            onReveal={onReveal}
            onCopy={onCopy}
            onAll={() => {
              setAll((was) => !was)
            }}
          />
        ) : null}
      </div>
    </section>
  )
}

function List({
  files,
  others,
  othersTotal,
  all,
  cwd,
  stamp,
  threadId,
  note,
  onReveal,
  onCopy,
  onAll,
}: {
  files: ReturnType<typeof reportedChangesOf>["list"]
  others: readonly ReviewFile[]
  othersTotal: number
  all: boolean
  cwd: string
  stamp: string
  threadId: string
  note: string | undefined
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onAll: () => void
}): React.JSX.Element {
  const shown = all ? files : files.slice(0, CHANGED_PREVIEW)
  return (
    <div className="changed__list">
      {note === undefined ? null : <p className="changed__note">{note}</p>}
      {shown.map((file) => (
        <ChangedRow
          key={file.path}
          file={file}
          cwd={cwd}
          stamp={stamp}
          threadId={threadId}
          onReveal={onReveal}
          onCopy={onCopy}
        />
      ))}
      {othersTotal === 0 ? null : (
        <ChangedOthers files={others} total={othersTotal} cwd={cwd} onReveal={onReveal} />
      )}
      {files.length <= CHANGED_PREVIEW ? null : (
        <button type="button" className="changed__more" onClick={onAll}>
          {all
            ? `只显示前 ${String(CHANGED_PREVIEW)} 个文件`
            : `再显示 ${String(files.length - CHANGED_PREVIEW)} 个文件`}
        </button>
      )}
    </div>
  )
}
