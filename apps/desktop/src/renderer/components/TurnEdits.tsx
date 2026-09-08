import { useId, useState } from "react"
import type { Changes } from "../changes.js"
import { ChangedRow } from "./ChangedRow.js"
import { CaretIcon, CompareIcon } from "./icons.js"
import { PencilIcon } from "./icons-activity.js"

/** 展开摘要后默认露几个文件，长清单再按需展开。 */
const PREVIEW = 4

/**
 * 一轮改了哪些文件。**跟在那一轮的末尾，就地摆着。**
 *
 * ## 为什么从「输入框上方那一条」搬回流里
 *
 * 上一版是**整条会话共用一张卡**，钉在输入框上方。它答的是「这条会话到现在
 * 一共动过哪些文件」——而人真正要问的是「**刚才那一轮**动了什么」：
 * 你正在读第三轮的答案，那张卡说的却是十轮累计的结果，两者对不上。
 * 往回翻更糟：翻到第三轮，卡还钉在下面，写着现在的总账。
 *
 * 现在一轮一张，谁改的跟着谁。这也让「撤销这一轮」「只看这一轮的 diff」
 * 这类事将来有地方挂——它们本来就以轮次为单位。
 *
 * ## 数字是**引擎报的那一轮**，不是 git 的当前净值
 *
 * 一轮的改动是**已经发生的事实**，拿它去和此刻的磁盘核对是问错了问题：
 * 后面几轮很可能又改过同几行，核出来的净值不属于这一轮。所以这里如实写
 * 引擎当时报的那份；要看「现在相对开场还剩什么」，那是审核面板的事——
 * 「审核」那颗就是去那儿的门。
 */
export function TurnEdits({ edits, cwd, threadId, onReveal, onCopy, onReview, onOpen }: {
  edits: Changes
  cwd: string
  threadId: string
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  /** 「审一遍」那颗：打开右侧面板（不指定文件）。 */
  onReview: () => void
  /** 点某个文件：打开右侧面板并落在它上面。 */
  onOpen: (path: string) => void
}): React.JSX.Element | null {
  const [all, setAll] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  if (edits.files === 0) return null
  const shown = all ? edits.list : edits.list.slice(0, PREVIEW)
  return (
    <section className="edits" aria-label={`这一轮编辑了 ${String(edits.files)} 个文件`}>
      <div className="edits__head">
        <button type="button" className="edits__toggle" aria-expanded={expanded} aria-controls={listId}
          onClick={() => { setExpanded((was) => !was) }}>
          <span className="edits__glyph"><PencilIcon size={13} /></span>
          <span className="edits__title">已编辑 {edits.files} 个文件</span>
          <span className="edits__stat">
            {edits.added > 0 ? <span className="diffstat__add">+{edits.added}</span> : null}
            {edits.removed > 0 ? <span className="diffstat__del">−{edits.removed}</span> : null}
          </span>
          <CaretIcon size={12} />
        </button>
        <button type="button" className="edits__review" aria-label="审一遍（⇧⌘R）"
          data-tip="审一遍（⇧⌘R）" onClick={onReview}>
          <CompareIcon size={14} />
        </button>
      </div>
      <div id={listId} className="edits__list" hidden={!expanded}>
        {expanded ? shown.map((file) => (
          <ChangedRow key={file.path} file={file} cwd={cwd} threadId={threadId}
            onReveal={onReveal} onCopy={onCopy} onOpen={onOpen} />
        )) : null}
        {!expanded || edits.list.length <= PREVIEW ? null : (
          <button type="button" className="changed__more" onClick={() => { setAll((was) => !was) }}>
            {all ? `只显示前 ${String(PREVIEW)} 个文件` : `再显示 ${String(edits.list.length - PREVIEW)} 个文件`}
          </button>
        )}
      </div>
    </section>
  )
}
