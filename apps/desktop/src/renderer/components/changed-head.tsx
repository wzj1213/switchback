import type { ChangeEvidence } from "../changes.js"
import { ChevronIcon } from "./icons.js"
import { PencilIcon } from "./icons-activity.js"

function label(files: number, others: number, failed: boolean, evidence: ChangeEvidence): string {
  if (failed) return "无法核实文件改动"
  if (evidence === "reported") return `编辑记录 ${String(files)} 个文件`
  if (evidence === "head") return `相关文件 ${String(files)} 个仍有改动`
  return files > 0 ? `已编辑 ${String(files)} 个文件` : `检测到 ${String(others)} 个额外变动`
}

function Stat({ added, removed }: { added: number; removed: number }): React.JSX.Element {
  /* 外层定宽：`added === 0` 时整段不渲染、9 → 10 多一个字符，
     这行的宽度不该跟着内容变（tabular-nums 管得住数字宽度，管不住位数） */
  return (
    <span className="diffstat">
      {added > 0 ? <span className="diffstat__add">+{added}</span> : null}
      {removed > 0 ? <span className="diffstat__del">−{removed}</span> : null}
    </span>
  )
}

function detail(evidence: ChangeEvidence, added: number, removed: number): React.JSX.Element | string {
  if (evidence === "reported") return "未核实当前净值"
  if (evidence === "head") return (
    <><span>相对 HEAD</span>{added > 0 || removed > 0 ? <Stat added={added} removed={removed} /> : null}</>
  )
  return added > 0 || removed > 0 ? <Stat added={added} removed={removed} /> : "展开查看路径"
}

export function ChangedHead({ files, others, added, removed, failed, evidence, open, onOpen, onReview }: {
  files: number
  others: number
  added: number
  removed: number
  failed: boolean
  evidence: ChangeEvidence
  open: boolean
  onOpen: () => void
  onReview: () => void
}): React.JSX.Element {
  return (
    <div className="changed__head">
      <button type="button" className="changed__summary" aria-expanded={open} onClick={onOpen}>
        <span className="changed__glyph"><PencilIcon size={14} /></span>
        <span className="changed__copy">
          <span className="changed__title">{label(files, others, failed, evidence)}</span>
          <span className="changed__total">
            {failed ? "请展开查看原因" : detail(evidence, added, removed)}
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
