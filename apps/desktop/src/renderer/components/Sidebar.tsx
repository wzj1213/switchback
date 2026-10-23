import { useEffect, useMemo, useRef } from "react"
import type { EngineInfo, EngineThread } from "@switchback/protocol"
import { filterRows } from "../filter.js"
import { useDeepSearch } from "../useDeepSearch.js"
import { sectionsOf, type SidebarRow } from "../sidebar.js"
import { useSidebarDrag } from "../sidebarDrag.js"
import { useSidebarOpen } from "../useSidebarOpen.js"
import { SidebarFoot, type AccountLine } from "./SidebarFoot.js"
import { useContextMenu } from "./Menu.js"
import { useSidebarMenus, type Acts } from "./SidebarMenus.js"
import { Head } from "./SidebarHead.js"
import { useRenaming, type RenameCtl } from "./RowName.js"
import { RenameDialog } from "./RenameDialog.js"
import { rowLabelOf } from "../sidebar.js"
import { useLocale } from "../i18n.js"
import { SectionList } from "./SidebarSections.js"
import { sidebarMoves } from "../sidebarMove.js"
import { SidebarFound } from "./SidebarFound.js"
import { revealSidebarResult, useSidebarNavigation } from "../use-sidebar-navigation.js"

/**
 * 侧栏。
 *
 * ## 一条槽，所有东西对着它
 *
 * 上一版每样东西各有各的左边距：品牌 12px、按钮 8px、组标题 8px、
 * 行内文字 32px。看上去就是「没对齐」——而这件事没有任何理由，
 * 纯粹是每加一个元素就随手写了一个 padding。
 *
 * 现在只有两个量：`--sb-pad`（行的外边距）与 `--sb-slot`（图标列宽）。
 * 所有行共用同一套：图标落在同一列，文字落在同一列，组标题对着图标列。
 * **新加东西也只能用这两个量**——写第三个 padding 就是这条规则失效的开始。
 *
 * ## 为什么按项目分组
 *
 * 会话标题默认取目录名，于是同一个项目下的五个会话在侧栏里长得一模一样，
 * 而真正能区分它们的第一句话被排版成了灰色小字。
 * 分组之后：目录名说一次（组标题），每行说自己是干什么的。见 `../sidebar.ts`。
 */

interface Props {
  /** **带着未读旗子的那一份**（见 `SidebarRow`）——旗子由 `useUnread` 挂上。 */
  rows: readonly SidebarRow[]
  selectedId: string
  onSelect: (id: string) => void
  /** 在当前工作区另开一个会话 */
  onNew: () => void
  /** 弹系统目录框，选一个工作区再开会话 */
  onOpenFolder: () => void
  /** 删除会话。**不可撤销**，所以由行内二次确认把关。 */
  onDelete: (id: string) => void
  /** 改名。空名字不会传到这里——`RowName` 已经按撤销处理了。 */
  onRename: (id: string, title: string) => void
  /** 在指定工作区新建会话（右键菜单用）。 */
  onNewIn: (cwd: string) => void
  /** 在访达里定位。 */
  onReveal: (path: string) => void
  /** 写剪贴板。 */
  onCopy: (text: string) => void
  /** 已置顶的工作区路径。 */
  pinned: readonly string[]
  /** 打开过的项目。没有会话的也要出现在侧栏里。 */
  knownProjects: readonly string[]
  /** 把一个空项目移出侧栏。 */
  onDropProject: (cwd: string) => void
  /** 已置顶的会话 id。 */
  pinnedThreads: readonly string[]
  /** 各项目内会话的手动顺序：路径 → 会话 id。 */
  threadOrder: Readonly<Record<string, readonly string[]>>
  /** 项目之间的手动顺序（路径数组）。空 = 还没拖过，按活跃度排。 */
  projectOrder: readonly string[]
  /** 拖完项目之后把整段新顺序存下来。 */
  onReorderProjects: (order: readonly string[]) => void
  /** 置顶区内的项目与会话顺序。 */
  onReorderPinnedProjects: (order: readonly string[]) => void
  onReorderPinnedThreads: (order: readonly string[]) => void
  /** 拖完之后把这个项目的新顺序整段存下来。 */
  onReorder: (cwd: string, ids: readonly string[]) => void
  /** 把一条会话置顶 / 取消置顶。 */
  onPinThread: (id: string, pin: boolean) => void
  /** 各项目设过的图标。 */
  icons: Readonly<Record<string, string>>
  /** 给项目设图标；传空字符串表示清掉。 */
  onSetIcon: (cwd: string, icon: string) => void
  /** 报过历史的每一家，各一段。 */
  foreign: readonly { engine: string; threads: readonly EngineThread[] }[]
  /** 把某一家那边的一条会话接过来。 */
  onAdopt: (engine: string, item: EngineThread) => void
  /** 引擎登录的账号 + 额度，画在底部那一行。没有就不画。 */
  account?: AccountLine
  /** 引擎清单：行的悬停卡要把 engine id 翻成人话。 */
  engines: readonly EngineInfo[]
  onTogglePin: (cwd: string) => void
  onOpenSettings: () => void
  /** 收起侧栏（顶带右端那颗开关）。 */
  onRail: () => void
  /** 变一次就把当前会话切进改名态。`/rename` 命令走这条路。 */
  askRename: number
  /** 开一条不挑项目的对话。「对话」段头那颗 `+` 用。 */
  onNewChat: () => void
  /**
   * 变一次就把焦点送进筛选框。
   *
   * 传的是**次数不是布尔**：连按两次 ⌘K 应该两次都聚焦，
   * 布尔在第二次不会变化，于是第二下没反应——这类「偶尔失灵」最难查。
   */
  focusFilter: number
}

/**
 * 正在改名的那一行 → 一张对话框。
 *
 * **名字取 `rowLabelOf`**：对话框里要能在完整的当前名字上改，而侧栏显示的就是它
 *（人亲自起的名 > 引擎起的名 > 第一句话）。抽出来是函数行数闸门逼的。
 */
function Renaming({ row, ctl }: { row: SidebarRow | undefined; ctl: RenameCtl }): React.JSX.Element | null {
  const locale = useLocale()
  if (row === undefined) return null
  return (
    <RenameDialog
      title={rowLabelOf(row, locale)}
      onSave={(title) => {
        ctl.commit(row.thread.id, title)
      }}
      onClose={ctl.done}
    />
  )
}

/** 外面请求「去筛选框」时把它全选。抽出来是函数行数闸门逼的。 */
function useFilterFocus(at: number): React.RefObject<HTMLInputElement | null> {
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (at > 0) box.current?.select()
  }, [at])
  return box
}

function useSections(props: Props, query: string) {
  const pins = useMemo(() => ({
    projects: props.pinned,
    threads: props.pinnedThreads,
    order: props.threadOrder,
    known: props.knownProjects,
    projectOrder: props.projectOrder,
  }), [props.pinned, props.pinnedThreads, props.threadOrder, props.knownProjects, props.projectOrder])
  const found = useMemo(() => filterRows(props.rows, query), [props.rows, query])
  const sections = useMemo(() => sectionsOf(found, pins), [found, pins])
  return { pins, found, sections }
}

export function Sidebar(props: Props): React.JSX.Element {
  const { query, onQuery, view, list } = useSidebarNavigation(props.selectedId)
  const box = useFilterFocus(props.focusFilter)
  const { open: openMenu, menu } = useContextMenu()
  // 筛选时**不分组**：命中的几条散在各组里，分组只会让人多点几下才看得见
  const filtering = query.trim() !== ""
  const { pins, found, sections } = useSections(props, query)
  const moves = sidebarMoves({
    sections,
    onThreads: props.onReorderPinnedThreads,
    onGroupThreads: props.onReorder,
    onPinnedProjects: props.onReorderPinnedProjects,
    onProjects: props.onReorderProjects,
  })
  const acts: Acts = {
    pinned: props.pinned,
    pinnedThreads: props.pinnedThreads,
    onPinThread: props.onPinThread,
    onDropProject: props.onDropProject,
    onNewIn: props.onNewIn,
    onTogglePin: props.onTogglePin,
    onReveal: props.onReveal,
    onCopy: props.onCopy,
    ...moves,
  }
  // 正文搜索**跟在后面出现**：它要翻磁盘，而上面那份必须逐字即时
  const deep = useDeepSearch(query)
  // 拖放整套在 `sidebarDrag.ts`：谁能拖、拖到哪儿会发生什么，都在那儿
  const dragging = useSidebarDrag({
    filtering,
    sections,
    onReorder: props.onReorder,
    onReorderProjects: props.onReorderProjects,
    onPinThread: props.onPinThread,
    onTogglePin: props.onTogglePin,
  })
  const selected = props.rows.find((row) => row.thread.id === props.selectedId)?.thread
  const { isOpen, toggle, reveal } = useSidebarOpen(selected?.cwd)
  const rename = useRenaming(props.onRename, { at: props.askRename, id: props.selectedId })
  const renaming = props.rows.find((row) => row.thread.id === rename.id)
  const { rowMenu, groupMenu } = useSidebarMenus({ ...acts, onSetIcon: props.onSetIcon }, openMenu)
  const { onDelete, engines } = props
  const onSelect = (id: string): void => {
    const row = props.rows.find(item => item.thread.id === id)
    if (row !== undefined) {
      revealSidebarResult(view, sectionsOf(props.rows, pins), row)
      reveal(row.thread.cwd)
    }
    props.onSelect(id)
  }
  const foundOn = { onSelect, onDelete, rowMenu, rename, engines }

  return (
    <aside className="sidebar">
      <Head
        onNew={props.onNew}
        onOpenFolder={props.onOpenFolder} onRail={props.onRail}
        here={selected?.cwd}
        hereKind={selected?.workspaceKind}
        box={box}
        query={query} onQuery={onQuery}
      />

      <div className="sidebar__list" ref={list}>
        {filtering ? (
          <SidebarFound
            key={query.trim()}
            rows={props.rows}
            found={found}
            deep={deep}
            selectedId={props.selectedId}
            on={foundOn}
          />
        ) : (
          <SectionList
            sections={sections}
            on={{
              view,
              selectedId: props.selectedId,
              engines: props.engines,
              isOpen,
              onToggle: toggle,
              onSelect: props.onSelect,
              onDelete: props.onDelete,
              onRowMenu: rowMenu,
              onOpenFolder: props.onOpenFolder,
              onNewChat: props.onNewChat,
              onNewIn: props.onNewIn,
              icons: props.icons,
              rename,
              onGroupMenu: groupMenu,
              foreign: props.foreign,
              onAdopt: props.onAdopt,
              ...dragging,
              ...moves,
            }}
          />
        )}
      </div>
      <SidebarFoot account={props.account} onOpenSettings={props.onOpenSettings} />
      {menu}
      <Renaming row={renaming} ctl={rename} />
    </aside>
  )
}
