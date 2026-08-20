import { useEffect, useRef, useState } from "react"
import type { EngineThread } from "@omni/protocol"
import { filterRows } from "../filter.js"
import { useDeepSearch } from "../useDeepSearch.js"
import { Deep } from "./SidebarDeep.js"
import { sectionsOf, type SidebarRow } from "../sidebar.js"
import { useSidebarDrag } from "../sidebarDrag.js"
import { SidebarFoot, type AccountLine } from "./SidebarFoot.js"
import { useContextMenu } from "./Menu.js"
import { useSidebarMenus, type Acts } from "./SidebarMenus.js"
import { Head } from "./SidebarHead.js"
import { Hits } from "./SidebarHits.js"
import { useRenaming, type RenameCtl } from "./RowName.js"
import { SectionList } from "./SidebarSections.js"

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
  onTogglePin: (cwd: string) => void
  onOpenSettings: () => void
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
 * 筛选时的两段结果：标题/首句/目录命中的（即时），正文里提到的（慢半拍）。
 *
 * 拆出来是行数闸门逼的，但边界对：`Sidebar` 管「侧栏长什么样」，
 * 这里管「搜出来的东西怎么摆」。
 */
function Found({ rows, found, deep, selectedId, on }: {
  rows: readonly SidebarRow[]
  found: readonly SidebarRow[]
  deep: ReturnType<typeof useDeepSearch>
  selectedId: string
  on: {
    onSelect: (id: string) => void
    onDelete: (id: string) => void
    rowMenu: (event: React.MouseEvent, row: SidebarRow, arm: () => void, ren: () => void) => void
    rename: RenameCtl
  }
}): React.JSX.Element {
  return (
    <>
      <Hits rows={found} total={rows.length} selectedId={selectedId} on={on} />
      <Deep
        hits={deep.hits}
        rows={rows}
        shown={new Set(found.map((r) => r.thread.id))}
        selectedId={selectedId}
        busy={deep.busy}
        skipped={deep.skipped}
        onSelect={on.onSelect}
      />
    </>
  )
}

export function Sidebar({
  rows,
  selectedId,
  onSelect,
  onNew,
  onOpenFolder,
  onDelete,
  onRename,
  onNewIn,
  onReveal,
  onCopy,
  pinned,
  knownProjects,
  onDropProject,
  pinnedThreads,
  threadOrder,
  projectOrder,
  onReorder,
  onReorderProjects,
  onPinThread,
  icons,
  onSetIcon,
  foreign,
  onAdopt,
  account,
  onTogglePin,
  onOpenSettings,
  onNewChat,
  askRename,
  focusFilter,
}: Props): React.JSX.Element {
  const [query, setQuery] = useState("")
  /**
   * **手动展开过的项目**（不是「折叠过的」）。
   *
   * 默认全折叠，只有当前会话所在的那个自动展开。上一版反过来——默认全展开——
   * 于是一个有八个会话的项目自己就占满了整列，而「最近」那一段被顶到屏幕外面，
   * 等于白做。codex 的项目段也只列文件夹，不把聊天铺开。
   */
  /**
   * 用户**明确点过**的项目：true = 他要展开，false = 他要收起。
   *
   * 没点过的项目按默认走（当前会话所在的那个默认展开，其余默认收起）。
   * 原来这里只存「手动展开过的」，而当前会话所在的项目是**强制展开**的——
   * 于是点它的箭头毫无反应：`toggle` 把它从集合里拿掉了，
   * 但 `cwd === here` 又把它扳回展开。**一个按了没反应的控件比没有更糟。**
   */
  const [choice, setChoice] = useState<ReadonlyMap<string, boolean>>(new Map())
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusFilter > 0) box.current?.select()
  }, [focusFilter])

  const { open: openMenu, menu } = useContextMenu()
  const acts: Acts = { pinned, pinnedThreads, onPinThread, onDropProject, onNewIn, onTogglePin, onReveal, onCopy }
  const filtering = query !== ""
  // 筛选时**不分组**：命中的几条散在各组里，分组只会让人多点几下才看得见
  const pins = { projects: pinned, threads: pinnedThreads, order: threadOrder, known: knownProjects, projectOrder }
  const found = filterRows(rows, query)
  const sections = sectionsOf(found, pins)
  // 正文搜索**跟在后面出现**：它要翻磁盘，而上面那份必须逐字即时
  const deep = useDeepSearch(query)
  // 拖放整套在 `sidebarDrag.ts`：谁能拖、拖到哪儿会发生什么，都在那儿
  const dragging = useSidebarDrag({ filtering, sections, onReorder, onReorderProjects, onPinThread, onTogglePin })

  const toggle = (cwd: string): void => {
    setChoice((prev) => {
      const next = new Map(prev)
      next.set(cwd, !isOpen(cwd))
      return next
    })
  }

  // 当前会话所在的项目**默认**展开：选中的那一行该看得见，
  // 否则点了侧栏别处再回来，它就藏进一个折叠组里了。
  // 但这只是默认——用户明确收起来就听他的
  const here = rows.find((r) => r.thread.id === selectedId)?.thread.cwd
  const isOpen = (cwd: string): boolean => choice.get(cwd) ?? cwd === here

  const rename = useRenaming(onRename, { at: askRename, id: selectedId })
  const { rowMenu, groupMenu } = useSidebarMenus({ ...acts, onSetIcon }, openMenu)


  return (
    <aside className="sidebar">
      <Head
        onNew={onNew}
        onOpenFolder={onOpenFolder}
        here={here}
        hereKind={rows.find((r) => r.thread.id === selectedId)?.thread.workspaceKind}
        box={box}
        query={query}
        onQuery={setQuery}
      />

      <div className="sidebar__list">
        {filtering ? (
          <Found rows={rows} found={found} deep={deep} selectedId={selectedId} on={{ onSelect, onDelete, rowMenu, rename }} />
        ) : (
          <SectionList
            sections={sections}
            on={{
              selectedId,
              isOpen,
              onToggle: toggle,
              onSelect,
              onDelete,
              onRowMenu: rowMenu,
              onOpenFolder,
              onNewChat,
              onNewIn,
              icons,
              rename,
              onGroupMenu: groupMenu,
              foreign,
              onAdopt,
              ...dragging,
            }}
          />
        )}
      </div>
      <SidebarFoot account={account} onOpenSettings={onOpenSettings} />
      {menu}
    </aside>
  )
}

