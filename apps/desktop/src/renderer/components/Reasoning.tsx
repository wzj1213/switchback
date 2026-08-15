import { useEffect, useRef, useState } from "react"
import { ChevronIcon, ThinkIcon } from "./icons.js"
import { Markdown } from "./Markdown.js"
import { summaryOf } from "../reasoning.js"

/**
 * 推理。**跑的时候是一行，不是一大段。**
 *
 * ## 为什么折成一行
 *
 * 上一版把 reasoning 当正文铺开：一条长思考会把整个对话一直往上顶，
 * 而你正在读的回答被推出屏幕。更别扭的是它还在变——**读到一半那段字自己长了**。
 *
 * dsh 的做法（`ReasoningRow.tsx`）是：流式期间只画**最后一行**，
 * 定高一行、`nowrap` + `overflow:hidden`，横向滚到末尾跟着走。
 * 于是 DOM 高度恒定，它长它的，下面的东西一动不动。
 * 收工之后折叠成第一行，点开才看全文。
 *
 * ## 为什么不是「跑完就删掉」
 *
 * 推理是唯一能解释「它为什么这么做」的东西。跑的时候它是过程噪声，
 * 跑完之后它是证据——所以是折叠，不是丢弃。
 */

export function Reasoning({ text, running }: { text: string; running: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const line = useRef<HTMLSpanElement>(null)
  const summary = summaryOf(text, running)

  // 横向跟到末尾：一行放不下时，要看见的是**刚写出来的那几个字**，不是开头
  useEffect(() => {
    const el = line.current
    if (el === null) return
    el.scrollLeft = running ? el.scrollWidth - el.clientWidth : 0
  }, [running, summary])

  return (
    <div className="think" data-state={running ? "running" : "done"}>
      <button
        type="button"
        className="think__row"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v)
        }}
      >
        <span className="think__icon">
          <ThinkIcon />
        </span>
        <span className="think__label">思考</span>
        <span className="think__dot" aria-hidden="true" />
        <span className="think__line" ref={line}>
          {summary}
        </span>
        <span className="think__chev">
          <ChevronIcon open={open} size={12} />
        </span>
      </button>
      {open ? (
        <div className="think__body">
          <Markdown text={text} streaming={running} />
        </div>
      ) : null}
    </div>
  )
}
