import { ChevronIcon } from "./icons.js"
import { PencilIcon } from "./icons-activity.js"

function label(files: number, others: number, failed: boolean): string {
  if (failed) return "无法核实文件改动"
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

export function ChangedHead({ files, others, added, removed, failed, open, onOpen, onReview }: {
  files: number
  others: number
  added: number
  removed: number
  failed: boolean
  open: boolean
  onOpen: () => void
  onReview: () => void
}): React.JSX.Element {
  return (
    <div className="changed__head">
      <button type="button" className="changed__summary" aria-expanded={open} onClick={onOpen}>
        <span className="changed__glyph"><PencilIcon size={14} /></span>
        <span className="changed__copy">
          <span className="changed__title">{label(files, others, failed)}</span>
          <span className="changed__total">
            {failed ? "请展开查看原因" : files > 0 && (added > 0 || removed > 0)
              ? <Stat added={added} removed={removed} />
              : "展开查看路径"}
          </span>
        </span>
        <span className="changed__chev"><ChevronIcon open={open} size={12} /></span>
      </button>
      <button type="button" className="changed__review" title="逐个看一遍（⇧⌘R）" onClick={onReview}>
        审核
      </button>
    </div>
  )
}
