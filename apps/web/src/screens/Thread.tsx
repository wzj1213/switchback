import { useEffect, useRef } from "react"
import type { Thread as ThreadModel } from "@omni/protocol"
import { itemsOf, turnOf, usageOf } from "@omni/store"
import type { Remote } from "../useRemote.js"
import { ItemView } from "../components/ItemView.js"
import { Composer } from "../components/Composer.js"
import { useStickToBottom } from "../useStickToBottom.js"

/** 上下文用量的条。引擎没报就整个不画——**没有数据时不要画一个空进度条**。 */
function Usage({ used, window: total }: { used: number; window: number | undefined }): React.JSX.Element | null {
  if (total === undefined || total === 0) return null
  const pct = Math.min(100, Math.round((used / total) * 100))
  return (
    <span className="usage" title={`上下文 ${String(used)} / ${String(total)}`}>
      <span className="usage__fill" style={{ width: `${String(pct)}%` }} />
    </span>
  )
}

export function Thread({
  remote,
  thread,
  onBack,
}: {
  remote: Remote
  thread: ThreadModel
  onBack: () => void
}): React.JSX.Element {
  const items = itemsOf(remote.state, thread.id)
  const turn = turnOf(remote.state, thread.id)
  const usage = usageOf(remote.state, thread.id)
  const scroller = useRef<HTMLDivElement>(null)
  useStickToBottom(scroller, items.length)

  // 打开一条会话就把它标成「我在看」，让宿主别为它再响一次
  useEffect(() => {
    remote.watch(thread.id)
  }, [remote, thread.id])

  const running = thread.status === "running" || turn?.status === "running"

  return (
    <section className="thread">
      <header className="thread__head">
        <button className="btn btn--ghost thread__back" type="button" onClick={onBack} aria-label="返回列表">
          ‹
        </button>
        <span className="thread__title">{thread.title}</span>
        <Usage used={usage?.contextUsed ?? 0} window={usage?.contextWindow} />
      </header>
      <div className="thread__body" ref={scroller}>
        {items.length === 0 ? (
          <p className="empty">这条会话还没有内容。</p>
        ) : (
          items.map((item) => <ItemView key={item.id} item={item} send={remote.send} />)
        )}
        {running ? <p className="thread__running">正在跑…</p> : null}
      </div>
      <Composer
        disabled={thread.detached === true}
        running={running}
        hint={thread.detached === true ? "这条会话没接引擎，去桌面上点「继续」" : `${thread.engine} · ${thread.trust}`}
        onSend={(text) => {
          remote.send({ type: "thread.prompt", threadId: thread.id, text })
        }}
        onStop={() => {
          remote.send({ type: "thread.interrupt", threadId: thread.id })
        }}
      />
    </section>
  )
}
