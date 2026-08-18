import type { Thread, ThreadId } from "@omni/protocol"
import { itemsOf, threadRowsOf } from "@omni/store"
import type { Remote } from "../useRemote.js"
import { PushToggle } from "../components/PushToggle.js"

/**
 * 会话列表。
 *
 * **等审批的排最前**，不按时间。这一端的用途就是「它卡住了，我去放行」——
 * 而卡住的那条按时间排可能在第七位。次序是：等审批 → 在跑 → 其余按活跃度。
 */

const STATUS_TEXT: Readonly<Record<Thread["status"], string>> = {
  starting: "正在起引擎",
  idle: "空闲",
  running: "在跑",
  waiting_approval: "等你确认",
  failed: "出错了",
}

function rank(thread: Thread): number {
  if (thread.status === "waiting_approval") return 0
  if (thread.status === "running" || thread.status === "starting") return 1
  return 2
}

function lastAt(items: readonly { at: number }[]): number {
  return items[items.length - 1]?.at ?? 0
}

export function Threads({
  remote,
  selected,
  onOpen,
  onUnpair,
  token,
}: {
  remote: Remote
  selected: ThreadId | undefined
  onOpen: (id: ThreadId) => void
  onUnpair: () => void
  token: string
}): React.JSX.Element {
  const rows = [...threadRowsOf(remote.state)]
    .filter((row) => row.thread.provisional !== true)
    .sort((a, b) => {
      const byRank = rank(a.thread) - rank(b.thread)
      return byRank === 0 ? b.thread.updatedAt - a.thread.updatedAt : byRank
    })

  return (
    <div className="threads">
      <header className="threads__head">
        <span className="threads__title">会话</span>
        <button className="btn btn--ghost" type="button" onClick={onUnpair}>
          解除配对
        </button>
      </header>
      {rows.length === 0 ? (
        <p className="empty">还没有会话。到桌面上新建一条，这里就会出现。</p>
      ) : (
        <ul className="threads__list">
          {rows.map(({ thread, preview }) => (
            <li key={thread.id}>
              <button
                className="row"
                type="button"
                aria-current={thread.id === selected}
                onClick={() => {
                  onOpen(thread.id)
                }}
              >
                <span className={`dot dot--${thread.status}`} aria-hidden="true" />
                <span className="row__body">
                  <span className="row__title">{thread.title}</span>
                  <span className="row__sub">
                    {STATUS_TEXT[thread.status]} · {thread.engine}
                    {thread.detached === true ? " · 未接引擎" : ""}
                  </span>
                  {preview === undefined ? null : <span className="row__preview">{preview}</span>}
                </span>
                <span className="row__count">{itemsOf(remote.state, thread.id).length || ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <footer className="threads__foot">
        <PushToggle token={token} />
        {remote.me === undefined ? null : (
          <span className="threads__who">
            {remote.me.name} · 远程上限 {remote.me.maxTrust}
          </span>
        )}
      </footer>
    </div>
  )
}

/** 最后一条 item 的时间。列表暂时按 `updatedAt` 排，留着给将来更细的排序用。 */
export { lastAt }
