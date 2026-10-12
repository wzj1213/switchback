import type { Item, Lane } from "@switchback/protocol"
import { ActivityDock } from "./ActivityDock.js"
import { PlanPanel } from "./PlanPanel.js"

/**
 * 输入卡顶上那条托盘：后台在跑的那一条 + 计划进度。
 *
 * 它原来是转录区与输入框之间单独的一行（`Between` 里的 `.brief`），漂在正文和桌宠之间、
 * 和谁都不对齐（UI 重构方案诊断第 6 条）。说的是「你按下回车之前该知道的东西」，
 * 那就长在输入卡上——内容、交互、「最多一行」的验收数都不变，只是换了个家。
 * 两样都没有时整条不占高（`.brief:empty`）。
 */
export function ComposerTray({
  threadId,
  items,
  running,
  lanes,
  onOpenLane,
}: {
  threadId: string
  items: readonly Item[]
  running: boolean
  lanes: readonly Lane[]
  onOpenLane: (laneId: string) => void
}): React.JSX.Element {
  return (
    <div className="brief">
      <ActivityDock lanes={lanes} onOpen={onOpenLane} />
      <PlanPanel key={threadId} items={items} running={running} />
    </div>
  )
}
