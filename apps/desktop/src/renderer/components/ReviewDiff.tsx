import { useMemo, useState } from "react"
import type { PatchSkip } from "../../shared/review.js"
import { paintPatch, type Seg } from "../review-paint.js"
import type { NumberedLine, SplitRow } from "../review.js"
import { splitRows } from "../review.js"
import { useMessages } from "../i18n.js"
import { REVIEW_DIFF } from "./ReviewDiff.messages.js"

/**
 * 审核面板右边那一片：一个文件的补丁。
 *
 * ## 为什么这里有行号，而转录区里那份没有
 *
 * 两者的下一步动作不同。转录区里读的是「它刚做了什么」，读完就往下走；
 * 审核读的是「这处对不对」，读完要去编辑器里打开那一行。**没有行号的审核视图
 * 等于每处都要自己去文件里找**。行号是自己算的（`review.ts` 的 `numbered`）——
 * git 的补丁里只有 hunk 头带行号。
 *
 * ## 并排是拼出来的
 *
 * git 不产出并排格式。规则见 `splitRows`：一段连续的删配一段连续的增。
 * **窄的时候不给并排**：闸门在 `Review.tsx`（`useNarrowPanel`），低于 420px
 * 时按钮置灰、正在并排的自动退回单栏——两列各 14 个字符的代码谁也读不了。
 *
 * ## 三层增删信号，不是一层
 *
 * 记号列（`+`/`−`）、行底色、词级高亮。**单栏一直有记号列，并排原来漏了**——
 * 于是并排下「这行是加的还是删的」只剩颜色一个信号，而那层 12% 的底色
 * 压在纸上只有 1.18:1，红绿色觉障碍者在并排视图下拿不到任何可判读的线索。
 * 补上之后灰度截图里增删仍然可分，那是这一条唯一真正的验收标准。
 */

const SIGN: Readonly<Record<NumberedLine["kind"], string>> = {
  add: "+",
  del: "−",
  ctx: " ",
  hunk: " ",
  meta: " ",
}


type Paint = ReadonlyMap<NumberedLine, readonly Seg[]>

/**
 * 行号槽。**三个槽，宽窄各用其中之一**（`review.css` 的容器查询决定谁显示）：
 * 宽面板下旧号 + 新号两列，窄面板下只留一个「按行别取」的号——
 * 那一档下两列行号要吃掉整块面板的三成，而窄面板下真正要读的是「改了什么」。
 */
function Num({ n, slot }: { n: number | undefined; slot: string }): React.JSX.Element {
  return (
    <span className={`rvd__n rvd__n--${slot}`} aria-hidden="true">
      {n === undefined ? "" : n}
    </span>
  )
}

/** 正文。没什么可画的行不进 `paint` 表，那时一个 span 都不多生。 */
function Text({ line, paint }: { line: NumberedLine; paint: Paint }): React.JSX.Element {
  const segs = paint.get(line)
  if (segs === undefined) {
    return <span className="rvd__text">{line.text === "" ? " " : line.text}</span>
  }
  return (
    <span className="rvd__text">
      {segs.map((seg, index) => {
        const cls = `${seg.cls ?? ""}${seg.hit === true ? " rvd__hit" : ""}`.trim()
        return (
          <span key={index} className={cls === "" ? undefined : cls}>
            {seg.text}
          </span>
        )
      })}
    </span>
  )
}

/**
 * hunk 头上的「引用」：把这一段连同位置放进输入框上方的一枚芯片（见 `review-quote.ts`）。
 * 引过的写成「已引用」，免得连点两次塞进去两份。
 */
function Quote({ quoted, onQuote }: { quoted: boolean; onQuote: () => void }): React.JSX.Element {
  const m = useMessages(REVIEW_DIFF)
  return (
    <button type="button" className="rvd__quote" disabled={quoted}
      title={quoted ? m.quotedTip : m.quoteTip} onClick={onQuote}>
      {quoted ? m.quoted : m.quote}
    </button>
  )
}

/** 引用那一格要的东西：哪几段已经引过、点了之后怎么办。缺席就不画按钮。 */
interface Quoting {
  quoted: ReadonlySet<number>
  onQuote: (at: number) => void
}

/** 单栏：行号（宽两列 / 窄一列）+ 记号 + 正文。hunk 头的末尾多一颗「引用」。 */
function UniLine({ line, at, paint, quoting }: { line: NumberedLine; at: number; paint: Paint; quoting?: Quoting | undefined }): React.JSX.Element {
  return (
    <div className={`rvd__line rvd__line--${line.kind}`}>
      <Num n={line.old} slot="old" />
      <Num n={line.new} slot="new" />
      <Num n={line.kind === "del" ? line.old : line.new} slot="one" />
      <span className="rvd__sign" aria-hidden="true">
        {SIGN[line.kind]}
      </span>
      <Text line={line} paint={paint} />
      {line.kind === "hunk" && quoting !== undefined ? (
        <Quote quoted={quoting.quoted.has(at)} onQuote={() => { quoting.onQuote(at) }} />
      ) : null}
    </div>
  )
}

/** 并排的一侧。空的那一侧要画出来——不画的话两列高度对不齐，整片就错位了。 */
function Side({ line, side, paint }: {
  line: NumberedLine | undefined
  side: "old" | "new"
  paint: Paint
}): React.JSX.Element {
  if (line === undefined) return <div className="rvd__cell rvd__cell--void" />
  return (
    <div className={`rvd__cell rvd__line--${line.kind}`}>
      <Num n={side === "old" ? line.old : line.new} slot="one" />
      <span className="rvd__sign" aria-hidden="true">
        {SIGN[line.kind]}
      </span>
      <Text line={line} paint={paint} />
    </div>
  )
}

function SplitLine({ row, at, paint, quoting }: { row: SplitRow; at: number; paint: Paint; quoting?: Quoting | undefined }): React.JSX.Element {
  if (row.full !== undefined) {
    return (
      <div className={`rvd__row rvd__row--full rvd__line--${row.full.kind}`}>
        <span className="rvd__text">{row.full.text}</span>
        {row.full.kind === "hunk" && quoting !== undefined ? (
          <Quote quoted={quoting.quoted.has(at)} onQuote={() => { quoting.onQuote(at) }} />
        ) : null}
      </div>
    )
  }
  return (
    <div className="rvd__row">
      <Side line={row.left} side="old" paint={paint} />
      <Side line={row.right} side="new" paint={paint} />
    </div>
  )
}

export function ReviewDiff({ lines, path, skip, split, loading, wrap = false, onQuote }: {
  lines: readonly NumberedLine[]
  /** 相对路径，**只用来取语言**——取不到就不染（沿用「没标语言就不猜」）。 */
  path?: string | undefined
  skip?: PatchSkip
  split: boolean
  loading: boolean
  wrap?: boolean
  /** 引用第 `at` 行起的那一段（`at` 是 hunk 头在 `lines` 里的下标）。缺席就不给「引用」。 */
  onQuote?: ((at: number) => void) | undefined
}): React.JSX.Element {
  // 着色和词级高亮一起算，一份补丁一次。切文件、换上下文档位才重算
  const paint = useMemo(() => paintPatch(path, lines), [path, lines])
  const m = useMessages(REVIEW_DIFF)
  const [quoted, setQuoted] = useState<ReadonlySet<number>>(new Set())
  const quoting: Quoting | undefined = onQuote === undefined ? undefined : {
    quoted,
    onQuote: (at) => {
      onQuote(at)
      setQuoted((had) => new Set([...had, at]))
    },
  }
  if (skip !== undefined) return <p className="rvd__note">{m.skip[skip]}</p>
  // **加载中不清空正文**：切文件时闪一下白比等半秒更难受。旧的先留着，压淡
  if (lines.length === 0) {
    return <p className="rvd__note">{loading ? m.reading : m.noNet}</p>
  }
  const body = split ? (
    <div className="rvd__body rvd__body--split">
      {splitRows(lines).map((row, i) => (
        // 行没有天然 id，这份数组在一次渲染里不变——用下标是正确的
        <SplitLine key={`${String(i)}-${row.full?.kind ?? "p"}`} row={row} paint={paint}
          at={row.full === undefined ? -1 : lines.indexOf(row.full)} quoting={quoting} />
      ))}
    </div>
  ) : (
    <div className="rvd__body">
      {lines.map((line, i) => (
        <UniLine key={`${String(i)}-${line.kind}`} line={line} at={i} paint={paint} quoting={quoting} />
      ))}
    </div>
  )
  return (
    <div
      className={`rvd${loading ? " rvd--stale" : ""}${wrap ? " rvd--wrap" : ""}`}
      role="region"
      aria-label={split ? m.splitLabel : m.label}
      tabIndex={0}
    >
      {body}
    </div>
  )
}
