import { useState } from "react"
import type { Item } from "@omni/protocol"
import type { ReviewFile } from "../../shared/review.js"
import { changeEvidenceOf, reconcileChanges, reportedChangesOf } from "../changes.js"
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
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onReview: () => void
}

/**
 * 这张卡这一帧该不该出现。
 *
 * **「正在问 git」只在还没有任何答案时才藏**。上一版是 `state.loading` 一真就藏，
 * 而 `loading` 在**重问**期间也是真的——于是切走再切回来（`window.focus` 触发重问）
 * 时，这张卡会整张消失再装回来，看起来就是闪了一下。
 *
 * 手上有旧答案就接着显示旧的：`useReview` 本来就特意不清空它
 *（「清空会让面板在每一轮结束时闪一下白」），这里跟上那条。
 */
export function shouldHide(state: {
  loading: boolean
  settled: boolean
  failed: boolean
  files: number
  others: number
}): boolean {
  if (state.loading && !state.settled) return true
  return state.files === 0 && state.others === 0 && !state.failed
}

/** 会话触达文件的当前净变更：总数 → 文件清单 → git 实时补丁。 */
export function Changed({
  items,
  threadId,
  cwd,
  stamp,
  onReveal,
  onCopy,
  onReview,
}: Props): React.JSX.Element | null {
  const reported = reportedChangesOf(items, cwd)
  const review = useReview(cwd, stamp, {
    threadId,
    wanted: reported.list.map((file) => file.path),
  })
  const evidence = changeEvidenceOf(review)
  const gitKnown = evidence !== "reported"
  const { files, added, removed, list } = gitKnown
    ? reconcileChanges(reported, review.files, review.root, {
        reported: cwd,
        real: review.cwd,
        ...(review.ignored === undefined ? {} : { ignored: review.ignored }),
      })
    : reported
  // **默认收起。** 它现在钉在输入框上方那一行里，和计划那枚药丸并排——
  // 一进来就摊开一张卡的话，那一行就又变回了上一版那条通栏带子
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const mine = new Set(list.flatMap((file) => file.review?.rel ?? []))
  const minePaths = new Set(list.map((file) => file.path))
  const others = evidence === "baseline"
    ? review.files.filter((file) => !mine.has(file.rel) && !minePaths.has(file.path))
    : []
  // `more` 是整个 Git 查询被截断的余量；只有开场基线能把它归到这次对话。
  // HEAD 回退若带进来，会把仓库里无关的海量脏文件重新画成历史会话改动。
  const othersTotal = evidence === "baseline" ? others.length + (review.more ?? 0) : 0
  if (
    shouldHide({
      loading: review.loading,
      settled: review.settled,
      failed: review.failed,
      files,
      others: othersTotal,
    })
  ) {
    return null
  }
  return (
    <section className="changed" data-open={open} aria-label="文件改动摘要">
      <div className="changed__card">
        <ChangedHead
          files={files}
          others={othersTotal}
          added={added}
          removed={removed}
          failed={review.failed}
          evidence={evidence}
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
        <ChangedOthers files={others} total={othersTotal} threadId={threadId}
          cwd={cwd} onReveal={onReveal} />
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
