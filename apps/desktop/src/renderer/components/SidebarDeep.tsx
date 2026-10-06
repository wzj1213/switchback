import type { ThreadRow } from "@switchback/store"
import type { DeepHit } from "../useDeepSearch.js"
import { whenOf } from "./ForeignRow.js"

/**
 * 「标题里没有，但正文里提过」的那几条。
 *
 * ## 为什么单独一段，不并进上面的命中里
 *
 * 两份结果的**置信度不一样**：上面那份是标题/首句/目录对上了，一眼就能确认；
 * 这一份是「某一轮里提到过这个词」——可能正是要找的那条，也可能只是顺口说了一句。
 * 混在一起排的话，人没法一眼分辨自己在看哪一种。
 *
 * 而且这一份**慢半拍**（要翻磁盘）。混进去意味着上面那份也得等它，
 * 而那份必须逐字即时——它是主路径。
 *
 * ## 摘要就是这一段存在的理由
 *
 * 只给一行标题的话，你还是得逐个点开去确认。摘要以命中的词为中心截，
 * 一眼就能判断「是不是这条」。
 */

function Line({ row, hit, selected, onSelect }: {
  row: ThreadRow
  hit: DeepHit
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button type="button" className={`deep__row${selected ? " deep__row--on" : ""}`} onClick={onSelect}>
      <span className="deep__head">
        <span className="deep__title">{row.thread.title}</span>
        {/* **时间不是装饰**：同名会话很常见（同一个项目开了好几条），
            光靠标题分不出是哪一条，而「上周那次」恰恰是人记得住的线索 */}
        <span className="deep__count">
          {hit.count} 处{hit.at > 0 ? ` · ${whenOf(hit.at)}` : ""}
        </span>
      </span>
      <span className="deep__snip">{hit.snippet}</span>
    </button>
  )
}

export function Deep({ hits, rows, shown, selectedId, busy, skipped, onSelect }: {
  hits: readonly DeepHit[]
  /** 全部会话，用来把 id 换成标题。 */
  rows: readonly ThreadRow[]
  /** 上面那份命中里已经有的 id：**不重复列**。 */
  shown: ReadonlySet<string>
  selectedId: string
  busy: boolean
  skipped: number
  onSelect: (id: string) => void
}): React.JSX.Element | null {
  const byId = new Map(rows.map((r) => [r.thread.id, r]))
  const extra = hits.filter((h) => !shown.has(h.threadId) && byId.has(h.threadId))
  // 一条都没多出来的时候整段不画：一个永远写着「0 条」的小节是纯噪音。
  // **但正在找的时候要画**，否则「还在找」和「没找到」在屏幕上是同一个样子
  if (extra.length === 0 && !busy) return null
  return (
    <>
      <div className="sidebar__section sidebar__section--static" title="只搜说过的话，不搜工具调用的命令原文">
        正文里提到{busy ? "…" : ` ${String(extra.length)} 条`}
      </div>
      {extra.map((hit) => {
        const row = byId.get(hit.threadId)
        return row === undefined ? null : (
          <Line
            key={hit.threadId}
            row={row}
            hit={hit}
            selected={hit.threadId === selectedId}
            onSelect={() => {
              onSelect(hit.threadId)
            }}
          />
        )
      })}
      {skipped > 0 ? <p className="sidebar__empty">历史太多，还有 {skipped} 条会话没来得及翻</p> : null}
    </>
  )
}
