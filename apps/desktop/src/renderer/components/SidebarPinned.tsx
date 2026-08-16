import { baseNameOf, type Sections } from "../sidebar.js"
import { Row } from "./SidebarRows.js"
import { SectionHead, type GroupHandlers } from "./SidebarSections.js"
import { GroupBlock } from "./SidebarGroup.js"

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
}): React.JSX.Element {
  return (
    <>
    {/* **整段都是落点。** 只让段头能放的话，落点是一条 24 像素高的线，
        而拖动时鼠标下面还压着一行——那种精度不该由用户来凑 */}
    <div
      className={`sidebar__droppin${on.overPinned === true ? " sidebar__droppin--over" : ""}`}
      onDragOver={(e) => {
        if (on.drag?.dragging === undefined) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        // **悬停要有反馈。** 漏了这一句的时候整段不会高亮，
        // 用户只能靠猜「松手会不会落在这儿」——而落点是一整段，猜不出来
        on.drag.hoverPinned()
      }}
      onDragLeave={() => {
        on.drag?.hoverRow("")
      }}
      onDrop={(e) => {
        if (on.drag?.dragging === undefined) return
        e.preventDefault()
        on.onDropPinned?.()
      }}
    >
      <SectionHead
        title="置顶"
        open={open}
        onToggle={() => {
          onToggle()
        }}
      />
      {open ? (
        sections.pinnedThreads.length === 0 && sections.pinned.length === 0 ? (
          <p className="sidebar__empty">把会话拖到这里就置顶了；右键项目可以置顶整个项目。</p>
        ) : (
          <>
            {sections.pinnedThreads.map((row) => (
              <Row
                key={`pin-${row.thread.id}`}
                row={row}
                selected={row.thread.id === on.selectedId}
                flat
                aside={baseNameOf(row.thread.cwd)}
                onSelect={() => {
                  on.onSelect(row.thread.id)
                }}
                onDelete={() => {
                  on.onDelete(row.thread.id)
                }}
                rename={on.rename}
                onMenu={(e, arm, ren) => {
                  on.onRowMenu(e, row, arm, ren)
                }}
              />
            ))}
            {sections.pinned.map((group) => (
                <GroupBlock
                  key={group.cwd}
                  group={group}
                  collapsed={!on.isOpen(group.cwd)}
                  selectedId={on.selectedId}
                  onToggle={() => {
                    on.onToggle(group.cwd)
                  }}
                  onSelect={on.onSelect}
                  onDelete={on.onDelete}
                  onRowMenu={on.onRowMenu}
                  onNewIn={on.onNewIn}
                  {...(on.drag === undefined ? {} : { drag: on.drag })}
                  icon={on.icons[group.cwd]}
                  rename={on.rename}
                  onGroupMenu={on.onGroupMenu}
                />
              ))}
          </>
        )
      ) : null}
    </div>
    </>
  )
}
