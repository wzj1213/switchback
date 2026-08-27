import { useRef } from "react"
import { copyFeedbackTitle, useCopyFeedback } from "../use-copy-feedback.js"
import { CheckIcon, CopyIcon } from "./icons.js"

/**
 * 代码块自带的一条工具栏：**这是什么语言**，还有**把它拿走**。
 *
 * ## 为什么不靠整条消息那颗「复制」
 *
 * 那颗拿走的是**整条回答**——一段解释加三个代码块。而人对着代码块要的
 * 十有八九只是这一块：贴进编辑器、贴进终端。用整条复制再回去删，
 * 是把界面该做的事推给人手工做。
 *
 * ## 语言名从哪儿来
 *
 * `rehype-highlight` 把识别出来的语言写成 `<code class="hljs language-ts">`。
 * **认它写下的那一个，不自己猜**：从内容猜语言是另一件难事，猜错了比不写更糟。
 * 一个字都没写的（围栏上没标语言、或者认不出来）就写「代码」——
 * 不编一个语言名出来。
 */

/** 从 `language-xxx` 里取出语言名；没有就返回 undefined，不猜。 */
export function langOf(className: string | undefined): string | undefined {
  const found = /(?:^|\s)language-([\w+#-]+)/.exec(className ?? "")?.[1]
  return found === undefined || found === "" ? undefined : found
}

/** 代码块里那段纯文本。**取 DOM 的 `textContent`**：高亮之后正文散在几十个 span 里。 */
function textOf(node: HTMLElement | null): string {
  return node?.querySelector("code")?.textContent ?? node?.textContent ?? ""
}

/**
 * 复制走主进程那条桥（`window.omni.copy`），和界面上别处的每一颗复制同一条路——
 * 不自己碰 `navigator.clipboard`：那条在没有用户手势时会静默失败，
 * 而「点了没反应也不报错」正是这套界面一直在躲的东西。
 */
async function copyVia(text: string): Promise<boolean> {
  const bridge = typeof window === "undefined" ? undefined : window.omni
  try {
    return (await bridge?.copy(text)) ?? false
  } catch {
    return false
  }
}

export function CodeBlock({ children, lang }: {
  children?: React.ReactNode
  lang: string | undefined
}): React.JSX.Element {
  const box = useRef<HTMLPreElement>(null)
  const [feedback, copy] = useCopyFeedback(() => copyVia(textOf(box.current)))
  return (
    <div className="cblock">
      <div className="cblock__bar">
        <span className="cblock__lang">{lang ?? "代码"}</span>
        <button
          type="button"
          className="cblock__copy"
          aria-live="polite"
          data-state={feedback}
          aria-label={copyFeedbackTitle(feedback, "复制这段代码")}
          data-tip={copyFeedbackTitle(feedback, "复制这段代码")}
          onClick={copy}
        >
          {feedback === "copied" ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
        </button>
      </div>
      {/* 代码块保留行结构并横向滚动，因此本身必须能从键盘进入 */}
      <pre ref={box} tabIndex={0}>{children}</pre>
    </div>
  )
}
