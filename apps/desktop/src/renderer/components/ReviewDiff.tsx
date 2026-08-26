import type { PatchSkip } from "../../shared/review.js"
import type { NumberedLine, SplitRow } from "../review.js"
import { splitRows } from "../review.js"

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
 * 窄的时候不给并排（父层判断），两列各 40 字符的代码谁也读不了。
 */

const SIGN: Readonly<Record<NumberedLine["kind"], string>> = {
  add: "+",
  del: "−",
  ctx: " ",
  hunk: " ",
  meta: " ",
}

const SKIP: Readonly<Record<PatchSkip, string>> = {
  binary: "二进制文件，不显示内容",
  large: "这份改动太大，画出来会把界面卡住——用 git 看它",
  gone: "取不到这个文件的改动",
  failed: "读取这份改动失败，请刷新后重试",
}

function Num({ n }: { n: number | undefined }): React.JSX.Element {
  return (
    <span className="rvd__n" aria-hidden="true">
      {n === undefined ? "" : n}
    </span>
  )
}

/** 单栏：行号两列（旧/新）+ 记号 + 正文。 */
function UniLine({ line }: { line: NumberedLine }): React.JSX.Element {
  return (
    <div className={`rvd__line rvd__line--${line.kind}`}>
      <Num n={line.old} />
      <Num n={line.new} />
      <span className="rvd__sign" aria-hidden="true">
        {SIGN[line.kind]}
      </span>
      <span className="rvd__text">{line.text === "" ? " " : line.text}</span>
    </div>
  )
}

/** 并排的一侧。空的那一侧要画出来——不画的话两列高度对不齐，整片就错位了。 */
function Side({ line, side }: { line: NumberedLine | undefined; side: "old" | "new" }): React.JSX.Element {
  if (line === undefined) return <div className="rvd__cell rvd__cell--void" />
  return (
    <div className={`rvd__cell rvd__line--${line.kind}`}>
      <Num n={side === "old" ? line.old : line.new} />
      <span className="rvd__text">{line.text === "" ? " " : line.text}</span>
    </div>
  )
}

function SplitLine({ row }: { row: SplitRow }): React.JSX.Element {
  if (row.full !== undefined) {
    return (
      <div className={`rvd__row rvd__row--full rvd__line--${row.full.kind}`}>
        <span className="rvd__text">{row.full.text}</span>
      </div>
    )
  }
  return (
    <div className="rvd__row">
      <Side line={row.left} side="old" />
      <Side line={row.right} side="new" />
    </div>
  )
}

export function ReviewDiff({ lines, skip, split, loading }: {
  lines: readonly NumberedLine[]
  skip?: PatchSkip
  split: boolean
  loading: boolean
}): React.JSX.Element {
  if (skip !== undefined) return <p className="rvd__note">{SKIP[skip]}</p>
  // **加载中不清空正文**：切文件时闪一下白比等半秒更难受。旧的先留着，压淡
  if (lines.length === 0) {
    return <p className="rvd__note">{loading ? "正在读改动…" : "当前没有可显示的净改动"}</p>
  }
  const body = split ? (
    <div className="rvd__body rvd__body--split">
      {splitRows(lines).map((row, i) => (
        // 行没有天然 id，这份数组在一次渲染里不变——用下标是正确的
        <SplitLine key={`${String(i)}-${row.full?.kind ?? "p"}`} row={row} />
      ))}
    </div>
  ) : (
    <div className="rvd__body">
      {lines.map((line, i) => (
        <UniLine key={`${String(i)}-${line.kind}`} line={line} />
      ))}
    </div>
  )
  return (
    <div
      className={loading ? "rvd rvd--stale" : "rvd"}
      role="region"
      aria-label={split ? "并排文件改动，可滚动" : "文件改动，可滚动"}
      tabIndex={0}
    >
      {body}
    </div>
  )
}
