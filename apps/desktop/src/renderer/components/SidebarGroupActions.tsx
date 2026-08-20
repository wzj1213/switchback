import type { Group } from "../sidebar.js"
import { EllipsisIcon, PlusIcon } from "./icons.js"
import { SIDEBAR_ICON } from "./icon-base.js"

export function GroupActions({
  group,
  onNewIn,
  onMenu,
}: {
  group: Group
  onNewIn: (cwd: string) => void
  onMenu: (event: React.MouseEvent, group: Group) => void
}): React.JSX.Element {
  return (
    <>
      <button
        type="button"
        className="row__act"
        aria-label={`在 ${group.label} 新建会话`}
        title={`在 ${group.cwd} 新建会话`}
        onClick={() => {
          onNewIn(group.cwd)
        }}
      >
        <PlusIcon size={SIDEBAR_ICON} />
      </button>
      <button
        type="button"
        className="row__act"
        aria-label="项目操作"
        title="项目操作"
        onClick={(event) => {
          onMenu(event, group)
        }}
      >
        <EllipsisIcon size={SIDEBAR_ICON} />
      </button>
    </>
  )
}
