import type { Thread, ThreadStatus } from "@omni/protocol"

const DOT_CLASS: Record<ThreadStatus, string> = {
  idle: "",
  running: " thread__dot--running",
  waiting_approval: " thread__dot--waiting",
  failed: "",
}

interface Props {
  threads: readonly Thread[]
  selectedId: string
  onSelect: (id: string) => void
}

export function Sidebar({ threads, selectedId, onSelect }: Props): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <div className="sidebar__brand">
          omni<span>同文</span>
        </div>
      </div>
      <div className="sidebar__group">会话</div>
      <div className="sidebar__list">
        {threads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            className="thread"
            aria-selected={thread.id === selectedId}
            onClick={() => {
              onSelect(thread.id)
            }}
          >
            <span className={`thread__dot${DOT_CLASS[thread.status]}`} />
            <span className="thread__label">{thread.title}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
