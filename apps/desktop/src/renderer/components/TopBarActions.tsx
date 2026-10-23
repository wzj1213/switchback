import type { EngineInfo, Thread } from "@switchback/protocol"
import { CompareIcon, ForkIcon } from "./icons.js"
import { PanelIcon } from "./icons-panel.js"
import { useMessages } from "../i18n.js"
import { TOP_BAR_ACTIONS } from "./TopBarActions.messages.js"

/** 历史会话也能分：岔出来的那条由它自己的新进程起，来源不必活着（宿主 `branch.ts` 的 `sourceOf`）。 */
const canForkFrom = (thread: Thread): boolean => thread.status === "idle" || thread.status === "failed"

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
  const m = useMessages(TOP_BAR_ACTIONS)
  return (
    <>
      {peer === undefined ? null : (
        <button
          className="iconbtn"
          type="button"
          data-tip={m.compareTip(peer.title)}
          aria-label={m.compare}
          onClick={onCompare}
        >
          <CompareIcon size={14} />
        </button>
      )}
      {next === undefined || !canForkFrom(thread) ? null : (
        <button
          className="iconbtn"
          type="button"
          data-tip={m.forkTip(next.label)}
          aria-label={m.forkTo(next.label)}
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
        data-tip={panelVisible ? m.hidePanelTip : m.showPanelTip}
        aria-label={panelVisible ? m.hidePanel : m.showPanel}
        aria-pressed={panelVisible} onClick={onPanel}>
        <PanelIcon />
      </button>
    </>
  )
}
