import type { EngineInfo, Thread } from "@switchback/protocol"
import { CompareIcon, ForkIcon } from "./icons.js"
import { PanelIcon } from "./icons-panel.js"

const canForkFrom = (thread: Thread): boolean =>
  thread.detached !== true && (thread.status === "idle" || thread.status === "failed")

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
          data-tip={`和「${peer.title}」并排比一比（⇧⌘D）`}
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
          data-tip={`用 ${next.label} 另开一条同工作区分支（原会话保留，不自动发送内容）`}
          aria-label={`分叉到 ${next.label}`}
          onClick={() => {
            onFork(next.id)
          }}
        >
          <ForkIcon size={14} />
        </button>
      )}
      {/* 面板开关是顶栏的最后一颗（拖拽区的 no-drag 只在它的子树里生效——
          挪出顶栏就点不动了，踩过两回）。视觉上的「钉在原地」由 CSS 反向
          translate 给：顶栏随会话列收窄多少，它就往右平移多少（app-main.css）。 */}
      <button className={`iconbtn paneltoggle${panelVisible ? " iconbtn--on" : ""}`} type="button"
        data-tip={panelVisible ? "隐藏侧边面板（⌥⌘B）" : "显示侧边面板（⌥⌘B）"}
        aria-label={panelVisible ? "隐藏侧边面板" : "显示侧边面板"}
        aria-pressed={panelVisible} onClick={onPanel}>
        <PanelIcon />
      </button>
    </>
  )
}
