import { useState } from "react"
import { useMessages } from "../i18n.js"
import { TOOL_OUTPUT } from "./ToolOutput.messages.js"

/*
 * 工具行展开出来的那段输出。从 `ToolRun.tsx` 拆出来是行数闸门逼的，
 * 但它确实自成一件事：**这段东西有多长、给不给看全**。
 */

/** 展开的输出夹到多少行。12 行约 232px——一屏能扫完，又不至于把上下文挤没。 */
const CLIP_AT = 12

/**
 * 展开出来的那段输出。
 *
 * ## 为什么不给它内滚
 *
 * 上一版是 `max-height: 320px` + `overflow-y: auto`，而它外面就是转录区的滚动区。
 * 指针停在输出上滚轮，**先被框内那 320px 吃掉**，到底了才传给外层——
 * 而工具输出恰恰是你最常一路划过去的东西。
 *
 * 320 还是个定高，跟内容没关系：一个高度写死的框摆在 760 的列里像块补丁，
 * 而按行夹断的边缘是内容自己的边缘。
 *
 * 展开之后不封顶，直接长在流里——转录区本来就会滚，那是它的活。
 */
export function Output({ text }: { text: string }): React.JSX.Element {
  const m = useMessages(TOOL_OUTPUT)
  const [all, setAll] = useState(false)
  const lines = text.split("\n").length
  const clip = !all && lines > CLIP_AT
  return (
    <>
      <pre className={`step__out${clip ? " step__out--clip" : ""}`}>{text}</pre>
      {lines > CLIP_AT ? (
        <button
          type="button"
          className="step__more"
          onClick={() => {
            setAll((v) => !v)
          }}
        >
          {all ? m.less : m.all(lines - CLIP_AT)}
        </button>
      ) : null}
    </>
  )
}
