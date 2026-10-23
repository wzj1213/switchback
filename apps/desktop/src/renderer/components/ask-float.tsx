/**
 * 选中转录区一段话之后浮出来的那颗「问一句」。
 *
 * **按下去之前不能让选中消失**：按钮上的 `pointerdown` 默认会清掉选区，
 * 于是这颗按钮在 `click` 到达之前就已经不在了——所以这里挡掉默认行为。
 *
 * 填回输入框的是一句**引文开头**（`关于「…」：`），光标落在冒号后面：
 * 上下文已经带上了，你只要把问题打完。
 */
import { useMessages } from "../i18n.js"
import { ASK_FLOAT } from "./ask-float.messages.js"

export function AskFloat({
  pick,
  onAsk,
}: {
  pick: { quote: string; x: number; y: number } | undefined
  onAsk?: (text: string, attachments?: readonly string[], aside?: boolean) => void
}): React.JSX.Element | null {
  const m = useMessages(ASK_FLOAT)
  if (pick === undefined || onAsk === undefined) return null
  return (
    <button
      type="button"
      className="askfloat"
      style={{ left: `${String(Math.round(pick.x))}px`, top: `${String(Math.round(pick.y))}px` }}
      onPointerDown={(event) => {
        event.preventDefault()
      }}
      onClick={() => {
        onAsk(m.prefill(pick.quote), [], true)
      }}
    >
      {m.ask}
    </button>
  )
}
