import { useState } from "react"
import type { ThreadRow } from "@omni/store"
import type { EngineInfo, EngineThread } from "@omni/protocol"
import { type Group, type Sections, type SidebarRow } from "../sidebar.js"
import { ChevronIcon, PlusIcon } from "./icons.js"
import { SIDEBAR_ICON, SIDEBAR_ICON_SMALL } from "./icon-base.js"
import { Row, type RowDrag } from "./SidebarRows.js"
import { ForeignSection } from "./ForeignRow.js"
import { PinnedSection } from "./SidebarPinned.js"
import { ProjectsSection } from "./SidebarProjects.js"
import type { RenameCtl } from "./RowName.js"
import type { SidebarMoveActions } from "../sidebarMove.js"

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
  hint,
}: {
  title: string
  open: boolean
  onToggle: () => void
  /** 悬停时右边露出来的那颗。 */
  action?: { label: string; icon: React.ReactNode; run: () => void }
  /**
   * 拖着东西时这一段要说的那半句（「松手就置顶」）。
   *
   * **绝对定位，不占位**——这不是排版洁癖，是一条硬约束：
   * 拖拽开始的那一帧只要**被拖的那一行动了位置**，Chromium 就把这次拖拽整个取消
   * （实测：往上面插一块 60px 的提示，行从 y=333 掉到 391，`dragstart` 照常触发、
   * 也没人 `preventDefault`，但拖拽再也起不来）。上一版正是把这句提示做成
   * 「拖起来才出现的一段正文」，于是**这句教你怎么拖的话，让拖拽本身失效了**。
   */
  hint?: string
}): React.JSX.Element {
  return (
    <div className="sidebar__section">
      <button type="button" className="sidebar__section-main" onClick={onToggle}>
        <span>{title}</span>
        <ChevronIcon open={open} size={SIDEBAR_ICON_SMALL} />
      </button>
      {hint === undefined ? null : <span className="sidebar__section-hint">{hint}</span>}
      {action === undefined ? null : (
        <button
          type="button"
          className="row__act sidebar__section-act"
          aria-label={action.label}
          data-tip={action.label}
          onClick={action.run}
        >
          {action.icon}
        </button>
      )}
    </div>
  )
}

export interface GroupHandlers extends SidebarMoveActions {
  selectedId: string
  /** 引擎清单：行的悬停卡要把 engine id 翻成人话。 */
  engines: readonly EngineInfo[]
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
  /** 各项目设过的图标：路径 → emoji。 */
  icons: Readonly<Record<string, string>>
  /**
   * 报过历史的每一家，各一段（你在终端、别的界面里跑过的会话）。
   * **一家一段而不是合并**：找的时候人想的是「我昨天在 Claude 里跑的那个」，
   * 引擎本身就是最强的筛选条件。
   */
  foreign: readonly { engine: string; threads: readonly EngineThread[] }[]
  /** 把某一家那边的一条会话接过来，在 omni 里接着聊。 */
  onAdopt: (engine: string, item: EngineThread) => void
  /** 拖动接线。不给就是这次不能拖（筛选结果里就不给）。 */
  drag?: RowDrag
  /** 拖到「置顶」那一段上放手。 */
  onDropPinned?: () => void
  /** 现在正悬在「置顶」上（画一条高亮）。 */
  overPinned?: boolean
  /** 取消置顶一条会话。 */
  onUnpinThread?: (id: string) => void
  /**
   * 现在拖的是哪一类。`undefined` = 没在拖。
   *
   * 两段互为**反向落点**：置顶段两类都收（置顶），项目段收置顶过来的那些（取消置顶）。
   * 只看 `drag.dragging` 的话项目就漏了——它不是一条会话，没有 id。
   */
  dragKind?: "thread" | "project"
  /** 现在拖的东西已经是置顶的（项目段据此决定认不认这次落点）。 */
  draggingPinned?: boolean
  /** 拖到「项目」那一段上放手：**取消置顶**。 */
  onDropProjects?: () => void
  /** 现在正悬在「项目」段上。 */
  overProjects?: boolean
  /** 悬到「项目」段上了（画高亮）。 */
  onHoverProjects?: () => void
  /** 把项目拖到另一个项目上：排序。 */
  onDropOnProject?: (cwd: string) => void
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
          rename={on.rename}
          onMenu={(e, arm, ren) => {
            on.onRowMenu(e, row, arm, ren)
          }}
        />
      ))}
    </>
  )
}

/**
 * 这一段默认展开还是折叠。
 *
 * **历史段默认折叠**：装的是你在别处跑的会话（实测 codex 25 条、Claude 40 条），
 * 展开着的话侧栏一打开就被一段你没在 omni 里建过的东西占满，
 * 而你八成是来找自己那几条的。
 *
 * 做成函数而不是一张初始集合：历史段的键带引擎名，
 * **挂载时还不知道有哪几家**（那要等引擎握手报上来）。
 */
function defaultOpen(key: string): boolean {
  return !key.startsWith("hist")
}

export function SectionList({
  sections,
  on,
}: {
  sections: Sections
  on: GroupHandlers
}): React.JSX.Element {
  // 记的是「被人扳过的段」，不是「收起来的段」——默认值由 `defaultOpen` 说了算
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string): void => {
    setToggled((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const open = (key: string): boolean => defaultOpen(key) !== toggled.has(key)

  return (
    <>
      {/* **空了也渲染段头。** 原来是空就整段不显示，于是「怎么置顶」这件事
          只有已经会用的人才看得见——而不会用的人恰恰是需要那行提示的人 */}
      <PinnedSection
        sections={sections}
        on={on}
        open={open("pin")}
        onToggle={() => {
          toggle("pin")
        }}
      />

      <ProjectsSection
        sections={sections}
        on={on}
        open={open("proj")}
        onToggle={() => {
          toggle("proj")
        }}
      />

      {/* **段头常驻，空了也在。** 上一版空了整段消失，于是「这里能放什么」
          只有已经知道的人才看得见——置顶段的老毛病同理 */}
      <SectionHead
        title="对话"
        open={open("chat")}
        onToggle={() => {
          toggle("chat")
        }}
        action={{
          label: "新开一条对话",
          icon: <PlusIcon size={SIDEBAR_ICON} />,
          run: on.onNewChat,
        }}
      />
      {open("chat") ? (
        sections.chats.length === 0 ? (
          /* 压成一行：那颗 `+` 就在段头右边，「点右边的 +」这半句是在说一个
             你已经看得见的东西；「不用先选项目」也只有在你以为必须先选时才有意义 */
          <p className="sidebar__empty sidebar__empty--one">还没有独立对话</p>
        ) : (
          <Chats rows={sections.chats} on={on} />
        )
      ) : null}

      {/*
        **一家一段，但这几段收在同一个抬头底下。**

        分家的理由没变（找的时候人想的是「我昨天在 Claude 里跑的那个」，
        引擎本身就是最强的筛选条件），变的是它们**平摊在顶层的代价**：
        接了几家就是几行段头常驻在侧栏底部，占的地方和它们被点开的频率
        完全不成比例——实测四家就是四行，而你自己那几条会话被挤到上面去。
        收进一层之后静息状态只剩一行，点开里面还是一家一段。
      */}
      {on.foreign.length === 0 ? null : (
        <>
          <SectionHead
            title="别处的历史"
            open={open("hist")}
            onToggle={() => {
              toggle("hist")
            }}
          />
          {open("hist")
            ? on.foreign.map((group) => (
                <ForeignSection
                  key={group.engine}
                  engine={group.engine}
                  threads={group.threads}
                  open={open(`hist:${group.engine}`)}
                  onToggle={() => {
                    toggle(`hist:${group.engine}`)
                  }}
                  onAdopt={on.onAdopt}
                />
              ))
            : null}
        </>
      )}
    </>
  )
}
