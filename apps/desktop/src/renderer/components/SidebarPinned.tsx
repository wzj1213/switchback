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
        // 会话和项目都能往这儿放
        if (on.dragKind === undefined) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        // **悬停要有反馈。** 漏了这一句的时候整段不会高亮，
        // 用户只能靠猜「松手会不会落在这儿」——而落点是一整段，猜不出来
        on.drag?.hoverPinned()
      }}
      onDragLeave={() => {
        on.drag?.hoverRow("")
      }}
      onDrop={(e) => {
        if (on.dragKind === undefined) return
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
          /* **平时不说这句话。** 它讲的是一个拖拽动作，而人需要它的那一刻
             正是手里已经拖着东西的那一刻。常驻的话它是 3 行 13px（连内边距 78px，
             比整个「项目」段的四行还高一半），而且读一次就够——之后永远是噪声。
             `dragKind` 一有值就现出来：要教的时候才教。 */
          on.dragKind === undefined ? null : (
            <p className="sidebar__empty">松手就置顶了；拖回「项目」那一段取消。</p>
          )
        ) : (
          <>
            {sections.pinnedThreads.map((row) => (
              <Row
                key={`pin-${row.thread.id}`}
                row={row}
                selected={row.thread.id === on.selectedId}
                flat
                pinned
                {...(on.drag === undefined ? {} : { drag: on.drag })}
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
                  pinned
                  {...(on.onDropOnProject === undefined ? {} : { onDropOnProject: on.onDropOnProject })}
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
