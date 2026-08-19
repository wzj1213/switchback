import { useRef, useState } from "react"
import type { Thread } from "@omni/protocol"
import { Popover } from "./Popover.js"

/**
 * 侧问：问一句不打断主线的问题。
 *
 * ## 为什么是一个浮层，不是第三栏
 *
 * 因为这一版的侧问**就是一问一答的纯文本**——claude 的 `askSideQuestion` 返回一个字符串，
 * 没有工具调用、没有轮次、不流式。为它开一整栏、再配一套 lane 数据轴，
 * 是照着一个**不存在的富流式世界**盖房子（详见 `docs/侧栏与引擎状态方案.md`
 * 「批 3 之前的实测更正」）。真出现「一条支线里有多条流式 item」的消费者时再说。
 *
 * ## 为什么问答留在这儿而不是拼进 transcript
 *
 * 「不打断主线」是这件事的全部定义。进了 transcript，它就在那条会话的正文里，
 * 而正文正是模型下一轮要读的东西——那就不叫侧问了。
 */
export function Asides({
  thread,
  onAsk,
}: {
  thread: Thread
  onAsk: (text: string) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const anchor = useRef<HTMLButtonElement>(null)
  // **能力位报 false 就整个不存在**，不是给一个灰的：
  // 这是「给不给入口」那一类，不是「这条信息可信到什么程度」那一类
  if (thread.capabilities?.sideQuestion !== true) return null
  // **还没说过一句话的会话上不给这个入口**：侧问的定义是「不打断主线」，
  // 而这时根本没有主线——那一屏还写着「在 xxx 里做点什么？」。
  // `provisional` 正是「发出第一句话之前」（见 `Thread.provisional`）
  if (thread.provisional === true) return null
  const asides = thread.asides ?? []
  const submit = (): void => {
    const trimmed = text.trim()
    if (trimmed === "") return
    setText("")
    onAsk(trimmed)
  }
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="composer__aside"
        title="问一句不打断主线的问题——问答不进这条会话的正文"
        onClick={() => {
          setOpen(true)
        }}
      >
        侧问{asides.length === 0 ? "" : ` · ${String(asides.length)}`}
      </button>
      <Popover
        open={open}
        anchor={anchor.current}
        minWidth={360}
        onClose={() => {
          setOpen(false)
        }}
      >
        <div className="aside">
          {asides.length === 0 ? (
            <p className="aside__empty">问一句不打断主线的问题。问和答都不进这条会话的正文。</p>
          ) : (
            asides.map((a) => (
              <div key={a.at} className="aside__pair">
                <p className="aside__q">{a.question}</p>
                <p className="aside__a">{a.answer}</p>
              </div>
            ))
          )}
          <textarea
            className="aside__input"
            value={text}
            rows={2}
            placeholder="问一句…（⌘↩ 发送）"
            onChange={(e) => {
              setText(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit()
            }}
          />
        </div>
      </Popover>
    </>
  )
}
