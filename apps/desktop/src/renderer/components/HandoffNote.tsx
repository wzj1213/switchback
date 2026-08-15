import { useState } from "react"
import { ChevronIcon, ForkIcon } from "./icons.js"
import { Markdown } from "./Markdown.js"

/**
 * 接力时发给下一家的那份**交接包**。
 *
 * ## 为什么不能长得像用户消息
 *
 * 它走的是和普通提问同一条路——引擎那边本来就该按「用户说的」来读。
 * 但界面上照原样渲染的话，一段几百字的机器生成简报会顶着右对齐气泡出现，
 * 而右对齐气泡在这套界面里只有一个意思：**这句话是你说的**。
 * 用户翻历史时会以为自己发过这段话。
 *
 * ## 为什么不干脆藏起来
 *
 * 因为「接手的那家究竟被告知了什么」是接力功能唯一值得怀疑的地方。
 * 交接包是宿主从 transcript 里提炼的，提炼就有可能漏——
 * 而漏了什么只有把原文摊开才看得出来。所以是**默认折叠、点开看全文**。
 */
export function HandoffNote({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="handoff" data-open={open}>
      <button
        type="button"
        className="handoff__row"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v)
        }}
      >
        <span className="handoff__icon">
          <ForkIcon size={13} />
        </span>
        <span className="handoff__label">交接包</span>
        <span className="handoff__hint">已告知接手的引擎</span>
        <ChevronIcon open={open} size={12} />
      </button>
      {open ? (
        <div className="handoff__body">
          <Markdown text={text} streaming={false} />
        </div>
      ) : null}
    </div>
  )
}
