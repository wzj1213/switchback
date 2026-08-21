import { useState } from "react"
import type { Item } from "@omni/protocol"
import { changesOf, relPath, type ChangedFile } from "../tool.js"
import { splitPath } from "../diff.js"
import { FileDiff } from "./Diff.js"
import { ChevronIcon, CopyIcon, RevealIcon } from "./icons.js"
import { PencilIcon } from "./icons-activity.js"
import { ChangedOthers, CHANGED_PREVIEW, useOtherChanges } from "./changed-others.js"

interface Props {
  items: readonly Item[]
  cwd: string
  stamp: string
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onReview: () => void
}

/** 会话截至当前的变更账：总数 → 文件清单 → 单文件最后一份补丁。 */
export function Changed({
  items,
  cwd,
  stamp,
  onReveal,
  onCopy,
  onReview,
}: Props): React.JSX.Element | null {
  const { files, added, removed, list } = changesOf(items)
  const [open, setOpen] = useState(true)
  const [all, setAll] = useState(false)
  const others = useOtherChanges(cwd, stamp, list)
  if (files === 0 && others.length === 0) return null
  const shown = all ? list : list.slice(0, CHANGED_PREVIEW)
  return (
    <section className="changed" aria-label="文件改动摘要">
      <div className="changed__card">
        <div className="changed__head">
          <button
            type="button"
            className="changed__summary"
            aria-expanded={open}
            onClick={() => {
              setOpen((was) => !was)
            }}
          >
            <span className="changed__glyph">
              <PencilIcon size={14} />
            </span>
            <span className="changed__copy">
              <span className="changed__title">{label(files, others.length)}</span>
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
        {open ? (
          <div className="changed__list">
            {shown.map((file) => (
              <Row key={file.path} file={file} cwd={cwd} onReveal={onReveal} onCopy={onCopy} />
            ))}
            {others.length === 0 ? null : (
              <ChangedOthers paths={others} cwd={cwd} onReveal={onReveal} />
            )}
            {list.length <= CHANGED_PREVIEW ? null : (
              <button
                type="button"
                className="changed__more"
                onClick={() => {
                  setAll((was) => !was)
                }}
              >
                {all
                  ? `只显示前 ${String(CHANGED_PREVIEW)} 个文件`
                  : `再显示 ${String(list.length - CHANGED_PREVIEW)} 个文件`}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </section>
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

function Row({
  file,
  cwd,
  onReveal,
  onCopy,
}: {
  file: ChangedFile
  cwd: string
  onReveal: (path: string) => void
  onCopy: (text: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const shown = splitPath(relPath(file.path, cwd))
  return (
    <div className="changed__file">
      <div className="changed__row">
        <button
          type="button"
          className="changed__name"
          title={file.path}
          aria-expanded={open}
          onClick={() => {
            setOpen((was) => !was)
          }}
        >
          <span className="changed__dir">{shown.dir}</span>
          <span className="changed__base">{shown.name}</span>
        </button>
        <span className="changed__stat">
          <Stat added={file.added} removed={file.removed} />
        </span>
        <button
          type="button"
          className="changed__act"
          aria-label="在访达中显示"
          title="在访达中显示"
          onClick={() => {
            onReveal(file.path)
          }}
        >
          <RevealIcon size={12} />
        </button>
        <button
          type="button"
          className="changed__act"
          aria-label="复制这份改动"
          title="复制这份改动"
          onClick={() => {
            onCopy(`${file.path}\n\n${file.last.diff ?? "（这次编辑没有带补丁）"}`)
          }}
        >
          <CopyIcon size={12} />
        </button>
      </div>
      {open ? <FileDiff file={file.last} /> : null}
    </div>
  )
}
