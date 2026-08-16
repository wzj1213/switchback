import { useEffect, useRef, useState } from "react"
import type { ThreadRow } from "@omni/store"
import { filterRows } from "../filter.js"
import { sectionsOf } from "../sidebar.js"
import { GearIcon } from "./icons.js"
import { useContextMenu } from "./Menu.js"
import { useSidebarMenus, type Acts } from "./SidebarMenus.js"
import { Head } from "./SidebarHead.js"
import { Hits } from "./SidebarHits.js"
import { useRenaming } from "./RowName.js"
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
  rows: readonly ThreadRow[]
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusFilter > 0) box.current?.select()
  }, [focusFilter])

  const { open: openMenu, menu } = useContextMenu()
  const acts: Acts = { pinned, onNewIn, onTogglePin, onReveal, onCopy }
  const shown = filterRows(rows, query)
  const filtering = query !== ""
  // 筛选时**不分组**：命中的几条散在各组里，分组只会让人多点几下才看得见
  const sections = sectionsOf(shown, pinned)

  const toggle = (cwd: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(cwd)) next.delete(cwd)
      else next.add(cwd)
      return next
    })
  }

  // 当前会话所在的项目**始终展开**：选中的那一行必须看得见，
  // 否则点了侧栏别处再回来，它就藏进一个折叠组里了
  const here = rows.find((r) => r.thread.id === selectedId)?.thread.cwd
  const isOpen = (cwd: string): boolean => expanded.has(cwd) || cwd === here

  const rename = useRenaming(onRename, { at: askRename, id: selectedId })
  const { rowMenu, groupMenu } = useSidebarMenus(acts, openMenu)


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
          <Hits rows={shown} total={rows.length} selectedId={selectedId} on={{ onSelect, onDelete, rowMenu, rename }} />
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
              rename,
              onGroupMenu: groupMenu,
            }}
          />
        )}
      </div>
      <button type="button" className="row row--foot" onClick={onOpenSettings}>
        <span className="row__slot">
          <GearIcon />
        </span>
        <span className="row__label">设置</span>
        <span className="row__aside">⌘,</span>
      </button>
      {menu}
    </aside>
  )
}

