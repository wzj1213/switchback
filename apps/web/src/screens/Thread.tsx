import { useEffect } from "react"
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
  const { scroller, inner, atBottom, toBottom } = useStickToBottom<HTMLDivElement, HTMLDivElement>()

  // 打开一条会话就把它标成「我在看」，让宿主别为它再响一次。
  //
  // **依赖里只放 `remote.watch`（`useCallback(…, [])`，稳定），不放整个 `remote`。**
  // 后者每次渲染都是一个新对象字面量，等于没有依赖数组——而流式输出期间
  // 每收一帧都会重渲染，于是这个 effect 变成一秒几十帧的上行。
  const { watch } = remote
  useEffect(() => {
    watch(thread.id)
  }, [watch, thread.id])

  const running = thread.status === "running" || turn?.status === "running"
  const offline = remote.conn.kind !== "open"

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
        <div className="thread__inner" ref={inner}>
          {items.length === 0 && !remote.loaded.has(thread.id) ? (
            // **正文没到 ≠ 这条会话是空的。** 分级 replay 之后「正文晚一拍到」
            // 是常态（全量只带最近几条的正文，其余打开时才补），
            // 而说「还没有内容」是一句会让人以为记录丢了的假话
            <p className="empty">正在取这条会话的内容…</p>
          ) : items.length === 0 ? (
            <p className="empty">这条会话还没有内容。</p>
          ) : (
            items.map((item) => <ItemView key={item.id} item={item} send={remote.send} offline={offline} />)
          )}
          {running ? <p className="thread__running">正在跑…</p> : null}
        </div>
      </div>
      {atBottom ? null : (
        <button className="tobottom" type="button" onClick={toBottom}>
          ↓ 回到底部
        </button>
      )}
      <Composer
        disabled={thread.detached === true || offline}
        running={running}
        hint={hintOf(thread, offline)}
        onSend={(text) => remote.send({ type: "thread.prompt", threadId: thread.id, text })}
        onStop={() => {
          remote.send({ type: "thread.interrupt", threadId: thread.id })
        }}
      />
    </section>
  )
}

/** 输入框上面那行小字。**说清现在为什么不能发**，而不是只报引擎和档位。 */
function hintOf(thread: ThreadModel, offline: boolean): string {
  if (offline) return "没连上 omni，先等重连"
  if (thread.detached === true) return "这条会话没接引擎，去桌面上点「继续」"
  return `${thread.engine} · ${thread.trust}`
}
