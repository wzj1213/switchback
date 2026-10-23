import { baseNameOf, type Sections } from "../sidebar.js"
import { Row } from "./SidebarRows.js"
import { SectionHead, type GroupHandlers } from "./SidebarSections.js"
import { GroupBlock } from "./SidebarGroup.js"
import { useMessages } from "../i18n.js"
import { SIDEBAR_PINNED } from "./SidebarPinned.messages.js"

/**
 * 「置顶」那一段：钉住的**会话**和钉住的**项目**。
 *
 * 会话排在项目前面——一条被单独钉住的对话比一整个文件夹更具体，
 * 也更可能是你现在要点的。
 *
 * 从 `SidebarSections.tsx` 拆出来是行数闸门逼的，但边界顺：
 * 那边是「侧栏分哪几段」，这边是「置顶这一段怎么画、怎么接落点」。
 */
export function PinnedSection({
  sections,
  on,
  open,
  onToggle,
}: {
  sections: Sections
  on: GroupHandlers
  open: boolean
  onToggle: () => void
}): React.JSX.Element | null {
  const m = useMessages(SIDEBAR_PINNED)
  const empty = sections.pinnedThreads.length === 0 && sections.pinned.length === 0
  /*
   * **一条都没置顶时整段不画**（UI 重构 P1 拍板）：空的段头 + 常驻垫高在 681 高的
   * 窗口里白占 8%。拖动开始时它作为落点**浮出来**——浮在列表顶上、不占布局：
   * 拖拽开始那一帧只要被拖的那一行动了，Chromium 就取消整次拖拽
   * （见 `SectionHead` 的 `hint`），所以不能用「拖起来才插进来一段」的写法。
   */
  if (empty) return on.dragKind === undefined ? null : <PinFloat on={on} />
  return (
    <>
      {/* **整段都是落点。** 只让段头能放的话，落点是一条 24 像素高的线，
        而拖动时鼠标下面还压着一行——那种精度不该由用户来凑 */}
      <div
        className={`sidebar__droppin${on.overPinned === true ? " sidebar__droppin--over" : ""}`}
        onDragOver={(e) => {
          // 会话和项目都能往这儿放
          if (on.dragKind === undefined) return
          e.preventDefault()
          e.dataTransfer.dropEffect = "move"
          // **悬停要有反馈。** 漏了这一句的时候整段不会高亮，
          // 用户只能靠猜「松手会不会落在这儿」——而落点是一整段，猜不出来
          on.drag?.hoverPinned()
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          on.drag?.hoverRow("")
        }}
        onDrop={(e) => {
          if (on.dragKind === undefined) return
          e.preventDefault()
          on.onDropPinned?.()
        }}
      >
        <SectionHead
          title={m.title}
          open={open}
          onToggle={() => {
            onToggle()
          }}
          {...(on.dragKind !== undefined && on.draggingPinned !== true
            ? { hint: m.dropToPin }
            : {})}
        />
        {open ? <PinnedItems sections={sections} on={on} /> : null}
      </div>
    </>
  )
}

/**
 * 空置顶在拖动时浮出来的落点。外层 `sticky` 且高 0：钉在列表可视区顶上、
 * 一个像素都不挤下面的行；里层绝对定位，盖在「项目」段头那一带。
 */
function PinFloat({ on }: { on: GroupHandlers }): React.JSX.Element {
  const m = useMessages(SIDEBAR_PINNED)
  return (
    <div className="sidebar__pinfloat">
      <div
        className={`sidebar__droppin sidebar__droppin--float${on.overPinned === true ? " sidebar__droppin--over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = "move"
          on.drag?.hoverPinned()
        }}
        onDragLeave={() => {
          on.drag?.hoverRow("")
        }}
        onDrop={(e) => {
          e.preventDefault()
          on.onDropPinned?.()
        }}
      >
        {m.dropToPin}
      </div>
    </div>
  )
}

function PinnedItems({
  sections,
  on,
}: {
  sections: Sections
  on: GroupHandlers
}): React.JSX.Element {
  return (
    <>
      {sections.pinnedThreads.map((row) => (
        <Row
          key={`pin-${row.thread.id}`}
          row={row}
          selected={row.thread.id === on.selectedId}
          flat
          pinned
          engines={on.engines}
          {...(on.drag === undefined ? {} : { drag: on.drag })}
          aside={baseNameOf(row.thread.cwd)}
          onSelect={() => on.onSelect(row.thread.id)}
          onDelete={() => on.onDelete(row.thread.id)}
          selectOnPress
          rename={on.rename}
          onMove={(direction) => on.moveThread(row.thread.id, direction)}
          onMenu={(event, arm, rename) => on.onRowMenu(event, row, arm, rename)}
        />
      ))}
      {sections.pinned.map((group) => (
        <GroupBlock
          key={group.cwd}
          group={group}
          pages={on.view.pages}
          pinned
          engines={on.engines}
          {...(on.onDropOnProject === undefined ? {} : { onDropOnProject: on.onDropOnProject })}
          collapsed={!on.isOpen(group.cwd)}
          selectedId={on.selectedId}
          onToggle={() => on.onToggle(group.cwd)}
          onSelect={on.onSelect}
          onDelete={on.onDelete}
          onRowMenu={on.onRowMenu}
          onNewIn={on.onNewIn}
          {...(on.drag === undefined ? {} : { drag: on.drag })}
          icon={on.icons[group.cwd]}
          rename={on.rename}
          onGroupMenu={on.onGroupMenu}
          onMove={(direction) => on.moveProject(group.cwd, direction)}
          onMoveThread={on.moveThread}
        />
      ))}
    </>
  )
}
