import type { EngineInfo, Thread } from "@omni/protocol"
import { CompareIcon, ForkIcon } from "./icons.js"

const canForkFrom = (thread: Thread): boolean =>
  thread.detached !== true && (thread.status === "idle" || thread.status === "failed")

function PanelIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M10.5 2.5v11" />
    </svg>
  )
}

export function TopBarActions({
  peer,
  next,
  thread,
  panelVisible,
  onPanel,
  onCompare,
  onFork,
}: {
  peer: Thread | undefined
  next: EngineInfo | undefined
  thread: Thread
  panelVisible: boolean
  onPanel: () => void
  onCompare: () => void
  onFork: (to: string) => void
}): React.JSX.Element {
  return (
    <>
      {peer === undefined ? null : (
        <button
          className="iconbtn"
          type="button"
          title={`和「${peer.title}」并排比一比（⇧⌘D）`}
          aria-label="对比分叉"
          onClick={onCompare}
        >
          <CompareIcon size={14} />
        </button>
      )}
      {next === undefined || !canForkFrom(thread) ? null : (
        <button
          className="iconbtn"
          type="button"
          title={`用 ${next.label} 另开一条同工作区分支（原会话保留，不自动发送内容）`}
          aria-label={`分叉到 ${next.label}`}
          onClick={() => {
            onFork(next.id)
          }}
        >
          <ForkIcon size={14} />
        </button>
      )}
      <button className={`iconbtn${panelVisible ? " iconbtn--on" : ""}`} type="button"
        title={panelVisible ? "隐藏侧边面板" : "显示侧边面板"}
        aria-label={panelVisible ? "隐藏侧边面板" : "显示侧边面板"} onClick={onPanel}>
        <PanelIcon />
      </button>
    </>
  )
}
