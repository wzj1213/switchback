import type { ChangeEvidence } from "../changes.js"
import { ChevronIcon } from "./icons.js"

/**
 * 这条会话改了哪些文件——收起来时的那一行。
 *
 * ## 为什么标题要写「引擎报了」
 *
 * 上一版这一行是「编辑记录 9 个文件 / 未核实当前净值」。两句都对，
 * 可它们都没回答**你看着它时唯一的问题**：这九个数是谁给的、为什么不敢作准。
 * 「编辑记录」像是本子的名字，「未核实当前净值」像是会计科目。
 *
 * 现在按证据分三档说人话：**核实过的**说「已编辑」，**只对得上 HEAD 的**说
 * 「相关文件仍有改动」，**只有引擎一面之词的**就直说「引擎报了」，
 * 并把原因摆在下一行（不是 Git 仓库 / 读不到差异 / 还在核对）。
 * 这也正是产品边界那一条：引擎报的就是引擎报的，omni 不替它担保、也不含糊过去。
 */

/** 只有引擎一面之词时，这份记录为什么核不了。 */
export type ReportReason = "noRepo" | "failed" | "pending"

function label(files: number, others: number, failed: boolean, evidence: ChangeEvidence): string {
  if (failed) return "无法核实文件改动"
  if (evidence === "reported") return `引擎报了 ${String(files)} 个文件`
  if (evidence === "head") return `相关文件 ${String(files)} 个仍有改动`
  return files > 0 ? `已编辑 ${String(files)} 个文件` : `检测到 ${String(others)} 个额外变动`
}

/** 收起时这一行和「计划」并排住在同一条带子里，长了会把那一行挤成两行——短句是硬要求。 */
const WHY: Readonly<Record<ReportReason, string>> = {
  noRepo: "不是 Git 仓库，没核对",
  failed: "读不到 Git 差异",
  pending: "正在核对…",
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

function detail(
  evidence: ChangeEvidence,
  reason: ReportReason,
  added: number,
  removed: number,
): React.JSX.Element | string {
  if (evidence === "reported") return WHY[reason]
  if (evidence === "head") return (
    <><span>相对 HEAD</span>{added > 0 || removed > 0 ? <Stat added={added} removed={removed} /> : null}</>
  )
  return added > 0 || removed > 0 ? <Stat added={added} removed={removed} /> : "展开查看路径"
}

export function ChangedHead({ files, others, added, removed, failed, evidence, reason, open, anchor, onOpen, onReview }: {
  files: number
  others: number
  added: number
  removed: number
  failed: boolean
  evidence: ChangeEvidence
  /** `evidence === "reported"` 时这一行写什么原因。 */
  reason: ReportReason
  open: boolean
  /** 清单浮层贴着这颗摘要弹，Esc 之后焦点也还给它。 */
  anchor: (node: HTMLButtonElement | null) => void
  onOpen: () => void
  onReview: () => void
}): React.JSX.Element {
  return (
    <div className="changed__head">
      <button type="button" className="changed__summary" ref={anchor} aria-expanded={open} onClick={onOpen}>
        <span className="changed__copy">
          <span className="changed__title">{label(files, others, failed, evidence)}</span>
          <span className="changed__total">
            {failed ? "展开看原因" : detail(evidence, reason, added, removed)}
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
