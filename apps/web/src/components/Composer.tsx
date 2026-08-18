import { useRef, useState } from "react"

/**
 * 输入框。
 *
 * 三条是为手机定的：
 *
 * - **回车换行，发送靠按钮。** 桌面上回车发送是对的（有 ⇧⏎ 换行），
 *   手机键盘上那个键就是换行键，抢过来当发送等于每写一行就发一次。
 * - **`font-size` 不小于 16px。** iOS Safari 在小于 16px 的输入框上会
 *   **自动放大整个页面**，而放大之后不会缩回去——界面从此歪着。
 * - **跟随内容长高，但有上限。** 长到半屏就自己滚，不然键盘一弹出来
 *   就什么都看不见了。
 */

const MAX_ROWS = 6

export function Composer({
  disabled,
  running,
  hint,
  onSend,
  onStop,
}: {
  disabled: boolean
  running: boolean
  hint: string
  /** 返回有没有真的发出去。**发不出去就不能清空输入框**。 */
  onSend: (text: string) => boolean
  onStop: () => void
}): React.JSX.Element {
  const [text, setText] = useState("")
  const box = useRef<HTMLTextAreaElement>(null)

  const grow = (): void => {
    const el = box.current
    if (el === null) return
    el.style.height = "auto"
    const line = Number.parseFloat(window.getComputedStyle(el).lineHeight) || 22
    el.style.height = `${String(Math.min(el.scrollHeight, line * MAX_ROWS))}px`
  }

  const submit = (): void => {
    const value = text.trim()
    if (value === "" || disabled) return
    // **没发出去就把字留着。** 断线时清空输入框等于把用户刚打的一段话
    // 扔了，而界面上没有任何东西说这里出过事——那是这一端最坏的失败方式
    if (!onSend(value)) return
    setText("")
    // 高度要跟着回到一行，否则清空之后留着一个六行高的空框
    queueMicrotask(grow)
  }

  return (
    <div className="composer">
      <div className="composer__hint">{hint}</div>
      <div className="composer__row">
        <textarea
          ref={box}
          className="composer__box"
          value={text}
          rows={1}
          disabled={disabled}
          placeholder={disabled ? "这条会话现在不能发消息" : "说点什么…"}
          onChange={(e) => {
            setText(e.target.value)
            grow()
          }}
        />
        {running ? (
          <button className="btn btn--stop" type="button" onClick={onStop} aria-label="停下">
            ◼
          </button>
        ) : (
          <button
            className="btn btn--primary composer__send"
            type="button"
            onClick={submit}
            disabled={disabled || text.trim() === ""}
            aria-label="发送"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  )
}
