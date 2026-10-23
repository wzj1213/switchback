import type { Sections, SidebarRow } from "../sidebar.js"
import { PlusIcon } from "./icons.js"
import { SIDEBAR_ICON } from "./icon-base.js"
import { Row } from "./SidebarRows.js"
import { SectionHead, type GroupHandlers } from "./SidebarSections.js"
import { useMessages } from "../i18n.js"
import { SIDEBAR_CHATS } from "./SidebarChats.messages.js"

/**
 * 对话段：**不属于任何项目的会话**。
 *
 * 上一版这段叫「最近」，装的是全量会话按时间排前六条——和项目树重复，
 * 于是同一条会话两行同时高亮、双击改名两个输入框一起进编辑态。
 * 换成「属不属于项目」之后互斥是天然的（见 `sidebar.ts` 的 `sectionsOf`）。
 *
 * 这里**不挂项目名**（上一版挂了，因为那段是跨项目的）：
 * 这一段里的会话本来就没有项目。
 */
function Chats({
  rows,
  on,
}: {
  rows: readonly SidebarRow[]
  on: GroupHandlers
}): React.JSX.Element {
  return (
    <>
      {rows.map((row) => (
        <Row
          key={`recent-${row.thread.id}`}
          row={row}
          selected={row.thread.id === on.selectedId}
          flat
          engines={on.engines}
          onSelect={() => {
            on.onSelect(row.thread.id)
          }}
          onDelete={() => {
            on.onDelete(row.thread.id)
          }}
          selectOnPress
          rename={on.rename}
          onMenu={(e, arm, ren) => {
            on.onRowMenu(e, row, arm, ren)
          }}
        />
      ))}
    </>
  )
}

/** 侧栏「对话」那一段。和置顶、项目两段一样各占一个文件，`SidebarSections` 只管摆顺序与开合。 */
export function ChatsSection({
  sections,
  on,
  open,
  onToggle,
}: {
  sections: Sections
  on: GroupHandlers
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const m = useMessages(SIDEBAR_CHATS)
  return (
    <>
      {/* **段头常驻，空了也在。** 上一版空了整段消失，于是「这里能放什么」
          只有已经知道的人才看得见——置顶段的老毛病同理 */}
      <SectionHead
        title={m.chats}
        open={open}
        onToggle={onToggle}
        action={{
          label: m.newChat,
          icon: <PlusIcon size={SIDEBAR_ICON} />,
          run: on.onNewChat,
        }}
      />
      {open ? (
        sections.chats.length === 0 ? (
          /* 压成一行：那颗 `+` 就在段头右边，「点右边的 +」这半句是在说一个
             你已经看得见的东西；「不用先选项目」也只有在你以为必须先选时才有意义 */
          <p className="sidebar__empty sidebar__empty--one">{m.noChats}</p>
        ) : (
          <Chats rows={sections.chats} on={on} />
        )
      ) : null}
    </>
  )
}
