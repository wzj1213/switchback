import type { Command, Thread } from "@switchback/protocol"
import { useMessages } from "../i18n.js"
import { QUEUED } from "./Queued.messages.js"

/**
 * 排着队、还没发出去的那几句（「待发送」）。
 *
 * 手机上原来看不见它：上一轮失败留下的、跑着的时候补的，都只在桌面上有一条排队条，
 * 人在外面既不知道还有几句在等，也没法改主意。现在照样列出来，每句一颗「取回」——
 * 回到输入框（走宿主的 `Thread.draft`，这一端的输入框会并进来，见 `useDraft`）。
 * 历史会话上也能取回：宿主改记录，接回来之后输入框里就有。
 */
export function Queued({
  thread,
  send,
  offline,
}: {
  thread: Thread
  send: (command: Command) => boolean
  offline: boolean
}): React.JSX.Element | null {
  const m = useMessages(QUEUED)
  const waiting = thread.queued ?? []
  if (waiting.length === 0) return null
  return (
    <div className="queued" role="list" aria-label={m.label}>
      <div className="queued__head">{m.head(waiting.length)}</div>
      {waiting.map((text, index) => {
        const images = thread.queuedAttachments?.[index]?.length ?? 0
        return (
          <div className="queued__row" role="listitem" key={`${String(index)}-${text}`}>
            <span className="queued__text">{images > 0 ? m.images(text, images) : text}</span>
            <button
              className="btn btn--ghost queued__take"
              type="button"
              disabled={offline}
              onClick={() => {
                send({ type: "thread.unqueue", threadId: thread.id, index })
              }}
            >
              {m.take}
            </button>
          </div>
        )
      })}
    </div>
  )
}
