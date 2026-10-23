import type { ReviewFile } from "../../shared/review.js"
import { reviewLabel } from "../../shared/review.js"
import { reviewDestination } from "./review-navigation.js"
import { ReviewTree } from "./review-tree.js"
import { useLocale, useMessages } from "../i18n.js"
import { REVIEW_LIST } from "./ReviewList.messages.js"

/**
 * 审核面板右侧文件栏：改了哪些文件。
 *
 * ## 目录优先、单链压缩
 *
 * 这里**不按「首次出现」排**（变更汇总卡那样）——审核的语境是逐个看过去，
 * 因此同目录聚在一起，目录排在文件前；只有一个子目录时合成 `apps/desktop/src`，
 * 避免把窄栏浪费在没有选择意义的中间层上。
 *
 * ## 已暂存的标出来
 *
 * `git diff` 默认看不见暂存区，而那恰恰是「马上要提交的东西」。不标的话，
 * 一个已经 `git add` 过的文件和一个没动过的在这列里长得一模一样。
 */

function moveSelection(event: React.KeyboardEvent<HTMLDivElement>, files: readonly ReviewFile[],
  active: string | undefined, onPick: (rel: string) => void): void {
  if (!(event.target instanceof HTMLElement)) return
  if (!event.target.classList.contains("rvl__input")) return
  const at = files.findIndex((file) => file.rel === active)
  const destination = reviewDestination(event.key, at, files.length)
  const file = destination === undefined ? undefined : files[destination]
  if (destination === undefined || file === undefined) return
  event.preventDefault()
  event.stopPropagation()
  onPick(file.rel)
}

function Notices({ more, ignored }: { more?: number; ignored: readonly string[] }): React.JSX.Element {
  const m = useMessages(REVIEW_LIST)
  return <>
    {more === undefined ? null : (
      <p className="rvl__none">{m.tooMany(more)}</p>
    )}
    {ignored.length === 0 ? null : (
      <p className="rvl__none">
        {m.ignored(ignored.length)}
        {m.join(ignored.slice(0, 3))}
        {ignored.length > 3 ? m.etc(ignored.length, 3) : ""}
      </p>
    )}
  </>
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
  const locale = useLocale()
  const m = REVIEW_LIST[locale]
  return (
    <div className="rvl" onKeyDown={(event) => { moveSelection(event, files, active, onPick) }}>
      <div className="rvl__filter">
        <input
          className="rvl__input"
          type="text"
          value={query}
          placeholder={m.placeholder}
          aria-label={m.filter}
          aria-keyshortcuts="ArrowUp ArrowDown Home End"
          onChange={(e) => {
            onQuery(e.target.value)
          }}
        />
      </div>
      {/* 一个文件都没有、又没在筛选：为什么没有由正文那一栏说（范围没快照、工作区干净），
          这里再说一遍「当前筛选条件下没有」是错的——根本没筛 */}
      {files.length === 0 ? <div className="rvl__rows">
        {query.trim() === "" && more === undefined ? null : (
          <p className="rvl__none">
            {more === undefined ? m.noneFiltered : m.noMatch}
          </p>
        )}
        <Notices more={more} ignored={ignored} />
      </div> : (
        <ReviewTree files={files} active={active} searching={query.trim() !== ""} onPick={onPick}>
          <Notices more={more} ignored={ignored} />
        </ReviewTree>
      )}
      {/* 图例解释的是文件行前那颗色点；没有文件行时它只是噪声 */}
      {files.length === 0 ? null : <p className="rvl__legend">
        {(["add", "update", "delete", "rename", "untracked"] as const).map((kind) => (
          <span key={kind} className="rvl__key">
            <span className={`rvl__kind rvl__kind--${kind}`} aria-hidden="true" />
            {reviewLabel(kind, locale)}
          </span>
        ))}
      </p>}
    </div>
  )
}
