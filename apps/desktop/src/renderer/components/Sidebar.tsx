import { useEffect, useRef, useState } from "react"
import type { ThreadRow } from "@omni/store"
import { filterRows } from "../filter.js"
import { groupByWorkspace } from "../sidebar.js"
import { FolderIcon, PlusIcon, SearchIcon } from "./icons.js"
import { GroupBlock, Row } from "./SidebarRows.js"

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
  /**
   * 变一次就把焦点送进筛选框。
   *
   * 传的是**次数不是布尔**：连按两次 ⌘K 应该两次都聚焦，
   * 布尔在第二次不会变化，于是第二下没反应——这类「偶尔失灵」最难查。
   */
  focusFilter: number
}

/** 侧栏顶部：品牌、两个动作、筛选框。三块都是同一套 `.row`，所以天然对齐。 */
function Head({
  onNew,
  onOpenFolder,
  box,
  query,
  onQuery,
}: {
  onNew: () => void
  onOpenFolder: () => void
  box: React.RefObject<HTMLInputElement | null>
  query: string
  onQuery: (next: string) => void
}): React.JSX.Element {
  return (
    <>
      <div className="sidebar__head">
        <div className="sidebar__brand">
          omni<span>同文</span>
        </div>
      </div>

      <nav className="sidebar__nav">
        <button type="button" className="row row--nav" onClick={onNew}>
          <span className="row__slot">
            <PlusIcon />
          </span>
          <span className="row__label">新建会话</span>
        </button>
        <button type="button" className="row row--nav" onClick={onOpenFolder}>
          <span className="row__slot">
            <FolderIcon />
          </span>
          <span className="row__label">打开文件夹…</span>
        </button>
      </nav>

      <div className="row row--search">
        <span className="row__slot">
          <SearchIcon />
        </span>
        <input
          className="sidebar__filter"
          ref={box}
          type="text"
          value={query}
          placeholder="筛选会话…"
          aria-label="筛选会话"
          onChange={(e) => {
            onQuery(e.target.value)
          }}
          onKeyDown={(e) => {
            // Esc 清空而不是失焦：清空之后列表立刻全回来，
            // 这是「我搜错了」时想要的那个动作
            if (e.key === "Escape") onQuery("")
          }}
        />
      </div>
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
  focusFilter,
}: Props): React.JSX.Element {
  const [query, setQuery] = useState("")
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusFilter > 0) box.current?.select()
  }, [focusFilter])

  const shown = filterRows(rows, query)
  const filtering = query !== ""
  // 筛选时**不分组**：命中的几条散在各组里，分组只会让人多点几下才看得见
  const groups = filtering ? [] : groupByWorkspace(shown)

  const toggle = (cwd: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cwd)) next.delete(cwd)
      else next.add(cwd)
      return next
    })
  }

  const flat = (row: ThreadRow): React.JSX.Element => (
    <Row
      key={row.thread.id}
      row={row}
      selected={row.thread.id === selectedId}
      onSelect={() => {
        onSelect(row.thread.id)
      }}
      onDelete={() => {
        onDelete(row.thread.id)
      }}
    />
  )

  return (
    <aside className="sidebar">
      <Head onNew={onNew} onOpenFolder={onOpenFolder} box={box} query={query} onQuery={setQuery} />

      <div className="sidebar__list">
        <div className="sidebar__section">
          {filtering ? `命中 ${String(shown.length)} / ${String(rows.length)}` : "项目"}
        </div>
        {filtering && shown.length === 0 ? (
          // 空列表什么都不说的话，看起来像「会话全没了」
          <p className="sidebar__empty">没有匹配的会话。</p>
        ) : null}
        {filtering
          ? shown.map(flat)
          : groups.map((group) => (
              <GroupBlock
                key={group.cwd}
                group={group}
                collapsed={collapsed.has(group.cwd)}
                selectedId={selectedId}
                onToggle={() => {
                  toggle(group.cwd)
                }}
                onSelect={onSelect}
                onDelete={onDelete}
              />
            ))}
      </div>
    </aside>
  )
}
