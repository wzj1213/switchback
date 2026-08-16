import { FolderIcon, PlusIcon, SearchIcon } from "./icons.js"
import { baseNameOf } from "../sidebar.js"

/*
 * 侧栏顶上那一块：品牌、新建、打开文件夹、筛选。
 * 从 `Sidebar.tsx` 拆出来是行数闸门逼的，但边界也顺：
 * 那边管「有哪些会话、怎么分段」，这边管「怎么开始一件新的」。
 */

/** 侧栏顶部：品牌、两个动作、筛选框。三块都是同一套 `.row`，所以天然对齐。 */
export function Head({
  onNew,
  onOpenFolder,
  here,
  hereKind,
  box,
  query,
  onQuery,
}: {
  onNew: () => void
  onOpenFolder: () => void
  /**
   * 点「新建会话」会开在哪。
   *
   * **必须在点之前就看得见。** 原来这个按钮连 `title` 都没有，
   * 点下去静默在当前会话的目录里建一条——而「当前会话是哪个」
   * 恰恰是刚打开应用时最不清楚的事。
   */
  here?: string
  hereKind?: "project" | "chat"
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
        <button
          type="button"
          className="row row--nav"
          onClick={onNew}
          title={here === undefined ? "还没有会话，会先让你选一个文件夹" : `在 ${here} 新建`}
        >
          <span className="row__slot">
            <PlusIcon />
          </span>
          <span className="row__label">新建会话</span>
          {/* 落点写在右边，和底部「设置 ⌘,」同一套排版。
              **不写进按钮文字里**——中文按钮跟着目录名忽长忽短，读起来更差 */}
          <span className="row__aside">
            {here === undefined ? "选文件夹…" : hereKind === "chat" ? "对话" : baseNameOf(here)}
          </span>
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
