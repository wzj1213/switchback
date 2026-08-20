import { useState } from "react"
import { PROJECT_MAX, type Group, type Sections } from "../sidebar.js"
import { FolderIcon } from "./icons.js"
import { SIDEBAR_ICON } from "./icon-base.js"
import { GroupBlock } from "./SidebarGroup.js"
import { SectionHead, type GroupHandlers } from "./SidebarSections.js"

/**
 * 「项目」那一段。
 *
 * ## 整段是落点，**和置顶段互为反向**
 *
 * 从置顶里拖出来的东西（一条会话、或者一整个项目）落在这一段上就是**取消置顶**。
 * 上一版只有「拖进置顶」没有「拖出来」——**一个只进不出的落点是陷阱**：
 * 用户拖了一下发现回不去，只能去右键菜单里找，而他多半不知道那儿有一项。
 *
 * 从 `SidebarSections.tsx` 拆出来是行数闸门逼的，边界也顺：那边是「侧栏分哪几段」，
 * 这边是「项目这一段怎么画、怎么接落点」——和 `SidebarPinned.tsx` 对称。
 */
export function ProjectsSection({
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
    <div
      className={`sidebar__dropproj${on.overProjects === true ? " sidebar__dropproj--over" : ""}`}
      onDragOver={(e) => {
        // 只认「已经置顶的东西」。没置顶的会话拖到这儿没有意义——
        // 它要么落在某一行上（那条路管排序），要么落在置顶段（那条路管置顶）
        if (on.draggingPinned !== true) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        on.onHoverProjects?.()
      }}
      onDrop={(e) => {
        if (on.draggingPinned !== true) return
        e.preventDefault()
        on.onDropProjects?.()
      }}
    >
      <SectionHead
        title="项目"
        open={open}
        onToggle={onToggle}
        // **图标不能和「对话」段那颗 `+` 一样**：这颗是「加一个项目（选文件夹）」，
        // 那颗是「开一条对话」。同形不同义比没有图标更误导
        action={{ label: "打开一个文件夹", icon: <FolderIcon size={SIDEBAR_ICON} />, run: on.onOpenFolder }}
        // 拖着一个置顶过的东西时才说：落在这一段上是**取消置顶**。
        // 「只进不出的落点是陷阱」那条规矩得有人说出口，而这是唯一说得起的位置——
        // 它绝对定位、不占位（拖起来时挪动任何一行都会让 Chromium 取消拖拽）
        {...(on.draggingPinned === true ? { hint: "松手取消置顶" } : {})}
      />
      {open ? <Projects groups={sections.projects} on={on} /> : null}
    </div>
  )
}

/**
 * 超过 `PROJECT_MAX` 就折起来，留一行「展开显示」。
 *
 * 不做无限滚动也不做分页：项目数量是几十的量级，一行「展开显示」就够，
 * 多一套机制只会多一处出错的地方。
 */
function Projects({ groups, on }: { groups: readonly Group[]; on: GroupHandlers }): React.JSX.Element {
  const [all, setAll] = useState(false)
  const shown = all ? groups : groups.slice(0, PROJECT_MAX)
  return (
    <>
      {shown.map((group) => (
        <GroupBlock
          key={group.cwd}
          group={group}
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
      {groups.length <= PROJECT_MAX ? null : (
        <button
          type="button"
          className="sidebar__more"
          onClick={() => {
            setAll((was) => !was)
          }}
        >
          {all ? "收起" : `展开显示（还有 ${String(groups.length - PROJECT_MAX)} 个）`}
        </button>
      )}
    </>
  )
}
