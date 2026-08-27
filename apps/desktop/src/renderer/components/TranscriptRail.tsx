import { useState } from "react"
import { railPeek, type RailMark } from "../transcript-rail.js"

/**
 * 转录区左边那条导航。一格 = **你问的一次**。
 *
 * 为什么是「你问的一次」而不是每条消息，见 `transcript-rail.ts` 开头。
 *
 * ## 三件事上跟着 `RowPeek` 的先例
 *
 * - **悬停卡里一个可点的东西都不放**：它是预览，真入口是点那一格本身。
 * - **不抢 Tab**：整条导航条只有一个 tab 停靠点（当下那一格），
 *   进去之后上下键在格之间走。二三十轮的会话如果每格都是一个 tab 停靠点，
 *   键盘用户从侧栏走到输入框要按三十次。
 * - **导航条自己不吃滚轮**：它只占左边十来像素，鼠标从正文划过去时
 *   不该在那儿卡一下（`pointer-events` 只给格子，条身不接）。
 */
export function TranscriptRail({ marks, activeId, onJump }: {
  marks: readonly RailMark[]
  activeId: string | undefined
  onJump: (id: string) => void
}): React.JSX.Element | null {
  const [hover, setHover] = useState<string | undefined>(undefined)
  if (marks.length === 0) return null
  const shown = marks.find((mark) => mark.id === hover)
  const peek = shown === undefined ? undefined : railPeek(shown.text)
  return (
    <nav className="rail" aria-label="按提问跳转">
      {marks.map((mark) => (
        <button
          key={mark.id}
          type="button"
          className="rail__tick"
          data-on={mark.id === activeId}
          style={{ top: mark.y }}
          // 二三十格各报一遍全文对读屏是灾难；名字给第一行就够认人
          aria-label={`跳到这一问：${railPeek(mark.text).title}`}
          aria-current={mark.id === activeId ? "true" : undefined}
          tabIndex={mark.id === activeId ? 0 : -1}
          onMouseEnter={() => {
            setHover(mark.id)
          }}
          onMouseLeave={() => {
            setHover((was) => (was === mark.id ? undefined : was))
          }}
          onFocus={() => {
            setHover(mark.id)
          }}
          onBlur={() => {
            setHover((was) => (was === mark.id ? undefined : was))
          }}
          onClick={() => {
            onJump(mark.id)
          }}
        />
      ))}
      {shown === undefined || peek === undefined ? null : (
        // 卡贴着那一格的高度浮出来；`pointer-events: none` 让鼠标穿过去，
        // 不然它自己会盖住下一格，划过去就闪
        <span className="rail__peek" style={{ top: shown.y }} aria-hidden="true">
          <span className="rail__peek-title">{peek.title}</span>
          {peek.body === "" ? null : <span className="rail__peek-body">{peek.body}</span>}
        </span>
      )}
    </nav>
  )
}
