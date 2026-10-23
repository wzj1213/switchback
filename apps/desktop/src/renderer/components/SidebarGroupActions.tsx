import type { Group } from "../sidebar.js"
import { EllipsisIcon, PlusIcon } from "./icons.js"
import { SIDEBAR_ICON } from "./icon-base.js"
import { useMessages } from "../i18n.js"
import { GROUP_ACTIONS } from "./SidebarGroupActions.messages.js"

export function GroupActions({
  group,
  onNewIn,
  onMenu,
}: {
  group: Group
  onNewIn: (cwd: string) => void
  onMenu: (event: React.MouseEvent, group: Group) => void
}): React.JSX.Element {
  const m = useMessages(GROUP_ACTIONS)
  return (
    <>
      <button
        type="button"
        className="row__act"
        aria-label={m.newIn(group.label)}
        title={m.newIn(group.cwd)}
        onClick={() => {
          onNewIn(group.cwd)
        }}
      >
        <PlusIcon size={SIDEBAR_ICON} />
      </button>
      <button
        type="button"
        className="row__act"
        aria-label={m.menu}
        title={m.menu}
        onClick={(event) => {
          onMenu(event, group)
        }}
      >
        <EllipsisIcon size={SIDEBAR_ICON} />
      </button>
    </>
  )
}
