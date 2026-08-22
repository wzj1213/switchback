import { useState } from "react"
import type { Item } from "@omni/protocol"
import { reconcileChanges, reportedChangesOf } from "../changes.js"
import { useReview } from "../review.js"
import { ChevronIcon } from "./icons.js"
import { PencilIcon } from "./icons-activity.js"
import { ChangedOthers, CHANGED_PREVIEW, useOtherChanges } from "./changed-others.js"
import { ChangedRow } from "./ChangedRow.js"

interface Props {
  items: readonly Item[]
  cwd: string
  stamp: string
  /** 新一轮运行时保留数据订阅，但整张卡退出视线。 */
  hidden?: boolean
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onReview: () => void
}

/** 会话触达文件的当前净变更：总数 → 文件清单 → git 实时补丁。 */
export function Changed({
  items,
  cwd,
  stamp,
  hidden = false,
  onReveal,
  onCopy,
  onReview,
}: Props): React.JSX.Element | null {
  const reported = reportedChangesOf(items, cwd)
  const review = useReview(cwd, stamp)
  const { files, added, removed, list } = review.noRepo
    ? reported
    : reconcileChanges(reported, review.files, review.root)
  const [open, setOpen] = useState(true)
  const [all, setAll] = useState(false)
  // 归零文件靠 reported 记住旧路径；改名文件靠 list 记住 Git 解析出的新路径。
  // 两份都给，才能既不把回滚冒充额外变动，也不把改名后的新路径重复摆一遍。
  const others = useOtherChanges(cwd, stamp, [...reported.list, ...list])
  if (hidden || review.loading || (files === 0 && others.length === 0)) return null
  return (
    <section className="changed" aria-label="文件改动摘要">
      <div className="changed__card">
        <Head
          files={files}
          others={others.length}
          added={added}
          removed={removed}
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
            all={all}
            cwd={cwd}
            stamp={stamp}
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

function Head({
  files,
  others,
  added,
  removed,
  open,
  onOpen,
  onReview,
}: {
  files: number
  others: number
  added: number
  removed: number
  open: boolean
  onOpen: () => void
  onReview: () => void
}): React.JSX.Element {
  return (
    <div className="changed__head">
      <button type="button" className="changed__summary" aria-expanded={open} onClick={onOpen}>
        <span className="changed__glyph">
          <PencilIcon size={14} />
        </span>
        <span className="changed__copy">
          <span className="changed__title">{label(files, others)}</span>
          <span className="changed__total">
            {files > 0 && (added > 0 || removed > 0) ? (
              <Stat added={added} removed={removed} />
            ) : (
              "展开查看路径"
            )}
          </span>
        </span>
        <span className="changed__chev">
          <ChevronIcon open={open} size={12} />
        </span>
      </button>
      <button
        type="button"
        className="changed__review"
        title="逐个看一遍（⇧⌘R）"
        onClick={onReview}
      >
        审核
      </button>
    </div>
  )
}

function List({
  files,
  others,
  all,
  cwd,
  stamp,
  onReveal,
  onCopy,
  onAll,
}: {
  files: ReturnType<typeof reportedChangesOf>["list"]
  others: readonly string[]
  all: boolean
  cwd: string
  stamp: string
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onAll: () => void
}): React.JSX.Element {
  const shown = all ? files : files.slice(0, CHANGED_PREVIEW)
  return (
    <div className="changed__list">
      {shown.map((file) => (
        <ChangedRow
          key={file.path}
          file={file}
          cwd={cwd}
          stamp={stamp}
          onReveal={onReveal}
          onCopy={onCopy}
        />
      ))}
      {others.length === 0 ? null : <ChangedOthers paths={others} cwd={cwd} onReveal={onReveal} />}
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

function label(files: number, others: number): string {
  return files > 0 ? `已编辑 ${String(files)} 个文件` : `检测到 ${String(others)} 个额外变动`
}

function Stat({ added, removed }: { added: number; removed: number }): React.JSX.Element {
  return (
    <>
      {added > 0 ? <span className="diffstat__add">+{added}</span> : null}
      {removed > 0 ? <span className="diffstat__del">−{removed}</span> : null}
    </>
  )
}
