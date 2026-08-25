import type { EngineInfo, Thread } from "@omni/protocol"
import type { WorkbenchPage } from "../workbench.js"
import { DotBoxIcon, FileIcon } from "./icons-activity.js"
import { CompareIcon, ForkIcon } from "./icons.js"

const canForkFrom = (thread: Thread): boolean =>
  thread.detached !== true && (thread.status === "idle" || thread.status === "failed")

export function TopBarActions({
  activityCount,
  page,
  visible,
  peer,
  next,
  thread,
  onActivity,
  onFiles,
  onCompare,
  onFork,
}: {
  activityCount: number
  page: WorkbenchPage
  visible: boolean
  peer: Thread | undefined
  next: EngineInfo | undefined
  thread: Thread
  onActivity: () => void
  onFiles: () => void
  onCompare: () => void
  onFork: (to: string) => void
}): React.JSX.Element {
  return (
    <>
      <button
        className={`iconbtn${activityCount === 0 ? "" : " iconbtn--count"}${visible && page === "activity" ? " iconbtn--on" : ""}`}
        type="button"
        title="后台活动"
        aria-label={activityCount === 0 ? "打开后台活动" : `后台活动，${String(activityCount)} 条正在进行`}
        onClick={onActivity}
      >
        <DotBoxIcon size={14} />
        {activityCount === 0 ? null : <span>{activityCount}</span>}
      </button>
      <button
        className={`iconbtn${visible && page === "files" ? " iconbtn--on" : ""}`}
        type="button"
        title="文件预览"
        aria-label="打开文件预览"
        onClick={onFiles}
      >
        <FileIcon size={14} />
      </button>
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
    </>
  )
}
