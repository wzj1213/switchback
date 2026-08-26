import type { ReactNode } from "react"
import type { Item } from "@omni/protocol"
import { textOf } from "../export.js"
import { copyFeedbackLabel, copyFeedbackTitle, useCopyFeedback } from "../use-copy-feedback.js"
import { CheckIcon, CopyIcon } from "./icons.js"

/**
 * 给一条消息挂一个悬停才出现的复制按钮。
 *
 * 审批卡不挂——那上面有需要点的按钮，再放一个只会误点。
 */
export function Copyable({
  item,
  onCopy,
  children,
  extra,
}: {
  item: Item
  onCopy: (text: string) => unknown
  children: ReactNode
  /** 同一条动作栏里再挂几颗（「改一改再发」走这里）。 */
  extra?: ReactNode
}): React.JSX.Element {
  const [feedback, copy] = useCopyFeedback(() => onCopy(textOf(item)))
  if (item.kind === "approval") return <>{children}</>
  return (
    <div className="copyable">
      {children}
      {/*
        动作栏在消息**下面**，不是压在它身上。
        上一版是 `position: absolute; top: 0; right: 0`——于是那颗「复制」
        正好盖住气泡右上角的第一行文字，而用户消息恰恰是右对齐的，
        第一行的末尾就在那儿。悬停才出现也救不了：**你要复制的那条，
        正是鼠标停在上面的那条**。
      */}
      <div className="msgacts">
        <button
          className="act"
          type="button"
          aria-live="polite"
          data-state={feedback}
          title={copyFeedbackTitle(feedback, "复制这条内容")}
          onClick={copy}
        >
          {feedback === "copied" ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
          {copyFeedbackLabel(feedback)}
        </button>
        {extra}
      </div>
    </div>
  )
}
