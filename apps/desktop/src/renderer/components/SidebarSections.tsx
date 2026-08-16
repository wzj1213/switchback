import { useState } from "react"
import type { ThreadRow } from "@omni/store"
import { PROJECT_MAX, type Group, type Sections } from "../sidebar.js"
import { ChevronIcon, FolderIcon, PlusIcon } from "./icons.js"
import { Row } from "./SidebarRows.js"
import { GroupBlock } from "./SidebarGroup.js"
import type { RenameCtl } from "./RowName.js"

/**
 * 侧栏的三段：置顶 / 项目 / 最近。
 *
 * 分段本身就是说明：置顶排在最前而不单独成段的话，它和普通项目长得一样，
 * 用户看不出「这几个是我钉住的」，也就想不起来还能取消。
 */

/**
 * 分节标题。`›` 表示整段可折叠——codex 的三段也都是可折叠的。
 *
 * ## 悬停时右边那颗按钮
 *
 * 只有「项目」段有（`+` = 再开一个项目）。**另外两段故意没有。**
 *
 * 「置顶」段能想到的操作是「全部取消置顶」，那是一下子推翻用户所有安排的动作，
 * 藏在一个悬停才出现的小按钮后面太轻率；「最近」段能想到的是「清空」，
 * 而那一段里躺的是真会话，清掉的是记录本身，不是一份缓存。
 *
 * 为了让三段看起来整齐而各摆一颗按钮，是拿危险动作填版面。
 */
export function SectionHead({
  title,
  open,
  onToggle,
  action,
}: {
  title: string
  open: boolean
  onToggle: () => void
  /** 悬停时右边露出来的那颗。 */
  action?: { label: string; icon: React.ReactNode; run: () => void }
}): React.JSX.Element {
  return (
    <div className="sidebar__section">
      <button type="button" className="sidebar__section-main" onClick={onToggle}>
        <span>{title}</span>
        <ChevronIcon open={open} size={11} />
      </button>
      {action === undefined ? null : (
        <button
          type="button"
          className="row__act sidebar__section-act"
          aria-label={action.label}
          title={action.label}
          onClick={action.run}
        >
          {action.icon}
        </button>
      )}
    </div>
  )
}

export interface GroupHandlers {
  selectedId: string
  /** 这个项目现在是展开的吗。默认全折叠，见 `Sidebar.tsx`。 */
  isOpen: (cwd: string) => boolean
  onToggle: (cwd: string) => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRowMenu: (event: React.MouseEvent, row: ThreadRow, arm: () => void, ren: () => void) => void
  rename?: RenameCtl
  onGroupMenu: (event: React.MouseEvent, group: Group) => void
  /** 「项目」段标题上那颗 `+`。 */
  onOpenFolder: () => void
  /** 「对话」段头那颗 `+`：不挑项目，直接开一条。 */
  onNewChat: () => void
  /** 项目行悬停出来的 `+`：在**那个**项目里新建。 */
  onNewIn: (cwd: string) => void
}

function Groups({ groups, on }: { groups: readonly Group[]; on: GroupHandlers }): React.JSX.Element {
  return (
    <>
      {groups.map((group) => (
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
          rename={on.rename}
          onGroupMenu={on.onGroupMenu}
        />
      ))}
    </>
  )
}

/**
 * 项目段。超过 `PROJECT_MAX` 就折起来，留一行「展开显示」。
 *
 * 不做无限滚动也不做分页：项目数量是几十的量级，
 * 一行「展开显示」就够，多一套机制只会多一处出错的地方。
 */
function Projects({ groups, on }: { groups: readonly Group[]; on: GroupHandlers }): React.JSX.Element {
  const [all, setAll] = useState(false)
  const shown = all ? groups : groups.slice(0, PROJECT_MAX)
  return (
    <>
      <Groups groups={shown} on={on} />
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
function Chats({ rows, on }: { rows: readonly ThreadRow[]; on: GroupHandlers }): React.JSX.Element {
  return (
    <>
      {rows.map((row) => (
        <Row
          key={`recent-${row.thread.id}`}
          row={row}
          selected={row.thread.id === on.selectedId}
          flat
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
    </>
  )
}

export function SectionList({ sections, on }: { sections: Sections; on: GroupHandlers }): React.JSX.Element {
  const [shut, setShut] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string): void => {
    setShut((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const open = (key: string): boolean => !shut.has(key)

  return (
    <>
      {/* **空了也渲染段头。** 原来是空就整段不显示，于是「怎么置顶」这件事
          只有已经会用的人才看得见——而不会用的人恰恰是需要那行提示的人 */}
      <SectionHead
        title="置顶"
        open={open("pin")}
        onToggle={() => {
          toggle("pin")
        }}
      />
      {open("pin") ? (
        sections.pinned.length === 0 ? (
          <p className="sidebar__empty">右键项目 → 置顶项目，钉住的会排在这里。</p>
        ) : (
          <Groups groups={sections.pinned} on={on} />
        )
      ) : null}

      <SectionHead
        title="项目"
        open={open("proj")}
        onToggle={() => {
          toggle("proj")
        }}
        // **图标不能和「对话」段那颗 `+` 一样**：这颗是「加一个项目（选文件夹）」，
        // 那颗是「开一条对话」。同形不同义比没有图标更误导
        action={{ label: "打开一个文件夹", icon: <FolderIcon />, run: on.onOpenFolder }}
      />
      {open("proj") ? <Projects groups={sections.projects} on={on} /> : null}

      {/* **段头常驻，空了也在。** 上一版空了整段消失，于是「这里能放什么」
          只有已经知道的人才看得见——置顶段的老毛病同理 */}
      <SectionHead
        title="对话"
        open={open("chat")}
        onToggle={() => {
          toggle("chat")
        }}
        action={{ label: "新开一条对话", icon: <PlusIcon />, run: on.onNewChat }}
      />
      {open("chat") ? (
        sections.chats.length === 0 ? (
          <p className="sidebar__empty">还没有对话。点右边的 + 开一条，不用先选项目。</p>
        ) : (
          <Chats rows={sections.chats} on={on} />
        )
      ) : null}
    </>
  )
}
