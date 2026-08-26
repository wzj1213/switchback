import type { ReviewFile } from "../../shared/review.js"
import { reviewLabel } from "../../shared/review.js"
import { splitPath } from "../diff.js"
import { reviewDestination } from "./review-navigation.js"

/**
 * 审核面板左边那一列：改了哪些文件。
 *
 * ## 排序照 git 给的来
 *
 * 也就是字母序。这里**不按「首次出现」排**（变更汇总卡那样）——那份的语境是
 * 「它刚才动了什么」，这份的语境是「我要逐个看过去」，而逐个看的时候
 * 同一个目录下的文件挨在一起才好读。
 *
 * ## 已暂存的标出来
 *
 * `git diff` 默认看不见暂存区，而那恰恰是「马上要提交的东西」。不标的话，
 * 一个已经 `git add` 过的文件和一个没动过的在这列里长得一模一样。
 */

function Stat({ added, removed }: { added: number; removed: number }): React.JSX.Element | null {
  if (added === 0 && removed === 0) return null
  return (
    <span className="rvl__stat">
      {added > 0 ? <span className="diffstat__add">+{added}</span> : null}
      {removed > 0 ? <span className="diffstat__del">−{removed}</span> : null}
    </span>
  )
}

function Row({ file, active, onPick }: {
  file: ReviewFile
  active: boolean
  onPick: (rel: string) => void
}): React.JSX.Element {
  const { dir, name } = splitPath(file.rel)
  return (
    <button
      type="button"
      className={`rvl__row${active ? " rvl__row--on" : ""}`}
      data-review-rel={file.rel}
      tabIndex={active ? 0 : -1}
      title={file.rel}
      aria-current={active}
      aria-keyshortcuts="ArrowUp ArrowDown Home End"
      onClick={() => {
        onPick(file.rel)
      }}
    >
      <span className={`rvl__kind rvl__kind--${file.kind}`} aria-hidden="true" />
      <span className="rvl__name">
        {/* 末尾那个 `\u200e` 是 LRM，**不能删**：这一列的目录是从左边截断的
            （`direction: rtl`，见 review.css），而 `/` 是双向算法里的中性字符——
            处在 LTR 文本和 rtl 段落末尾之间时它会被搬到最前面，
            `src/main/` 就显示成 `/src/main`。补一个强 LTR 记号把它夹住 */}
        <span className="rvl__dir">{dir === "" ? "" : `${dir}\u200e`}</span>
        <span className="rvl__base">{name}</span>
      </span>
      {file.staged === true ? <span className="rvl__staged" title="已在暂存区">已暂存</span> : null}
      <Stat added={file.added} removed={file.removed} />
    </button>
  )
}

function moveSelection(event: React.KeyboardEvent<HTMLDivElement>, files: readonly ReviewFile[],
  active: string | undefined, onPick: (rel: string) => void): void {
  if (!(event.target instanceof HTMLElement)) return
  const row = event.target.closest<HTMLButtonElement>(".rvl__row")
  if (row === null && !event.target.classList.contains("rvl__input")) return
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".rvl__row")]
  const at = row === null ? files.findIndex((file) => file.rel === active) : rows.indexOf(row)
  const destination = reviewDestination(event.key, at, files.length)
  const file = destination === undefined ? undefined : files[destination]
  if (destination === undefined || file === undefined) return
  event.preventDefault()
  event.stopPropagation()
  onPick(file.rel)
  if (row !== null) {
    rows[destination]?.focus()
    rows[destination]?.scrollIntoView({ block: "nearest" })
  }
}

export function ReviewList({ files, active, query, onQuery, onPick, more, ignored }: {
  files: readonly ReviewFile[]
  active: string | undefined
  query: string
  onQuery: (text: string) => void
  onPick: (rel: string) => void
  /** 被截掉的条数。**必须说出来**——「500 个文件」看起来像是全部。 */
  more?: number
  /** 被 Git ignore 排除、无法生成可信补丁的引擎上报路径。 */
  ignored: readonly string[]
}): React.JSX.Element {
  return (
    <div className="rvl" onKeyDown={(event) => { moveSelection(event, files, active, onPick) }}>
      <div className="rvl__filter">
        <input
          className="rvl__input"
          type="text"
          value={query}
          placeholder="筛选路径…"
          aria-label="筛选文件"
          aria-keyshortcuts="ArrowUp ArrowDown Home End"
          onChange={(e) => {
            onQuery(e.target.value)
          }}
        />
      </div>
      <div className="rvl__rows">
        {files.map((file) => (
          <Row key={file.rel} file={file} active={file.rel === active} onPick={onPick} />
        ))}
        {files.length === 0 ? (
          <p className="rvl__none">
            {more === undefined ? "当前筛选条件下没有可显示的文件" : "已列出的文件里没有匹配项"}
          </p>
        ) : null}
        {more === undefined ? null : (
          <p className="rvl__none">改动太多，这里只列了前面这些，还有 {more} 个没显示</p>
        )}
        {ignored.length === 0 ? null : (
          <p className="rvl__none">
            另有 {ignored.length} 个 Git 忽略文件无法核实：
            {ignored.slice(0, 3).join("、")}
            {ignored.length > 3 ? ` 等 ${String(ignored.length)} 个` : ""}
          </p>
        )}
      </div>
      <p className="rvl__legend">
        {(["add", "update", "delete", "rename", "untracked"] as const).map((kind) => (
          <span key={kind} className="rvl__key">
            <span className={`rvl__kind rvl__kind--${kind}`} aria-hidden="true" />
            {reviewLabel(kind)}
          </span>
        ))}
      </p>
    </div>
  )
}
