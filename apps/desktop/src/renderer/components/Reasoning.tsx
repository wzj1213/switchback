import { useEffect, useRef, useState } from "react"
import { ChevronIcon } from "./icons.js"
import { ThinkIcon } from "./icons-activity.js"
import { Markdown } from "./Markdown.js"
import { headingOf, summaryOf } from "../reasoning.js"

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
 *
 * ## 收工之后显示什么：先问模型自己
 *
 * `summaryOf(text, false)` 取的是第一行，而第一行是一句**完整散文的开头**——
 * 齐着列宽一切，屏幕上就是半句读不完的英文，占满一整行、信息量接近零。
 *
 * 而模型其实已经给这一段起过名字了：推理文本几乎总是以一行 `**小标题**` 开头，
 * `headingOf` 就是取它的（状态行一直在用）。短标题撑不满一行，
 * 这一行于是从「一段被切断的正文」变回「一个标签」。
 *
 * 取不到就退回第一行——有些引擎配置根本不吐带标题的推理摘要，
 * 那时旧行为仍然是最好的兜底。
 */

export function Reasoning({ text, running }: { text: string; running: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const line = useRef<HTMLSpanElement>(null)
  const summary = running ? summaryOf(text, true) : (headingOf(text) ?? summaryOf(text, false))

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
          <ChevronIcon open={open} size={14} />
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
