import type { ReactNode } from "react"
import type { Item } from "@omni/protocol"
import { textOf } from "../export.js"
import { copyFeedbackTitle, useCopyFeedback } from "../use-copy-feedback.js"
import { CheckIcon, CopyIcon } from "./icons.js"

/**
 * 给一条消息挂一排动作。
 *
 * ## 只有最后那条挂得住
 *
 * 上一版是**每一条都挂**：思考、回答、提问、通知，一条一个悬停出现的「复制」。
 * 挂着的时候它是隐形的，可它**照样占着一行的高度**（`opacity: 0` 不是
 * `display: none`），于是每两条消息之间凭空多出二十来像素——
 * `app-main.css` 里那套「8 是连着干的几件事、16 是换人说话」的间距体系，
 * 说的话没有一句在屏幕上是真的。
 *
 * 而它多出来的那些也没人用：往回翻十屏去复制第三条思考不是真实动作，
 * 真实动作是「把刚才那段答案拿走」。所以只有**每轮最后一条回答**挂
 *（哪几条算，见 `transcript-row.tsx` 的 `answerActs`），而且**悬停才现**——
 * 常驻过一版，一屏三四轮就是三四颗小按钮钉在正文边上，在你不需要的时候
 * 也一直在说话（完整经过见 `items-composer.css` 里 `.msgacts` 的注释）。
 *
 * 审批卡不挂——那上面有需要点的按钮，再放一个只会误点。
 */
export function Copyable({
  item,
  acts,
  onCopy,
  children,
  extra,
}: {
  item: Item
  /**
   * 这条挂不挂那排动作（复制）。给了才画——悬停才现，不是常驻。
   * 哪几条算，见 `transcript-row.tsx` 的 `answerActs`。
   */
  acts: boolean
  onCopy: (text: string) => unknown
  children: ReactNode
  /** 同一条动作栏里再挂几颗（「改一改再发」走这里）。 */
  extra?: ReactNode
}): React.JSX.Element {
  const [feedback, copy] = useCopyFeedback(() => onCopy(textOf(item)))
  if (item.kind === "approval") return <>{children}</>
  // 左边那条导航按「你问的一次」摆格子，位置只能从 DOM 量（见 `use-transcript-rail.ts`），
  // 所以人话这一层要留一个认得出的锚点
  const nav = item.kind === "user_message" ? { "data-nav": item.id } : {}
  // 一颗都没有就连那个盒子也别要：它占的那行高度正是上一版间距失真的来源
  if (!acts && extra === undefined) return <div className="copyable" {...nav}>{children}</div>
  return (
    <div className="copyable" data-acts={acts ? "answer" : "extra"} {...nav}>
      {children}
      {/*
        动作栏在消息**下面**，不是压在它身上。
        上一版是 `position: absolute; top: 0; right: 0`——于是那颗「复制」
        正好盖住气泡右上角的第一行文字，而用户消息恰恰是右对齐的，
        第一行的末尾就在那儿。悬停才出现也救不了：**你要复制的那条，
        正是鼠标停在上面的那条**。
      */}
      <div className="msgacts">
        {acts ? (
          <button
            className="msgact"
            type="button"
            aria-live="polite"
            data-state={feedback}
            aria-label={copyFeedbackTitle(feedback, "复制", "已复制")}
            data-tip={copyFeedbackTitle(feedback, "复制", "已复制")}
            onClick={copy}
          >
            {feedback === "copied" ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          </button>
        ) : null}
        {extra}
      </div>
    </div>
  )
}
