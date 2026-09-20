import { PlusIcon } from "./icons.js"
import { FolderIcon } from "./icons-folder.js"
import { SIDEBAR_ICON } from "./icon-base.js"
import { baseNameOf } from "../sidebar.js"
import { OmniMark } from "./omni-mark.js"
import { SidebarSearch } from "./sidebar-search.js"

/*
 * 侧栏顶上那一块：品牌、新建、打开文件夹、筛选。
 * 从 `Sidebar.tsx` 拆出来是行数闸门逼的，但边界也顺：
 * 那边管「有哪些会话、怎么分段」，这边管「怎么开始一件新的」。
 */

/**
 * 侧栏顶部：品牌、一颗主按钮 + 一颗图标键、筛选框。
 *
 * **上一版是三条一模一样的 `.row`**（新建 / 打开文件夹 / 筛选，96px 一摞）。
 * 这三样的性质完全不同：新建是全 app 最高频的动作，打开文件夹一天点不了一次。
 * `SidebarFoot.tsx` 那段注释批评过同一个形状——「三行等重、等宽、等间距，
 * 你要找的那一行和你不找的那两行长得一模一样」。底部照着改过了，顶部一直没有。
 *
 * 现在两行：新建仍吃掉主要宽度，打开文件夹退成一颗方图标键。两颗都使用
 * 轻量导航行，不在侧栏里竖一块与正文争夺注意力的深色招牌。
 */
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
  // 落点名的取值沿用原来按钮右侧附注那一套：没会话 → 选文件夹；
  // 对话态 → 「对话」；否则项目目录名
  const where = here === undefined ? "选文件夹…" : hereKind === "chat" ? "对话" : baseNameOf(here)
  return (
    <>
      <div className="sidebar__head">
        <div className="sidebar__brand">
          <span className="row__slot"><OmniMark /></span>
          <span className="sidebar__wordmark">omni<span className="sidebar__name">同文</span></span>
        </div>
      </div>

      <div className="sidebar__act">
        {/* 落点（开在哪）收进 tooltip：它是这颗按钮唯一说不清的事，
            **必须在点之前就看得见**，但写进按钮里的话中文按钮跟着目录名
            忽长忽短。走全局自绘层 `data-tip`（见 `tips.tsx`），不用原生
            `title`——慢、长得不像这个应用、自动化出图拍不到。 */}
        <button
          type="button"
          className="sidebar__new"
          onClick={onNew}
          data-tip={`新建会话 —— 落在 ${where}`}
        >
          <PlusIcon size={SIDEBAR_ICON} />
          <span className="sidebar__new-label">新建会话</span>
        </button>
        {/* 低频动作让位给高频动作，这一条就是这次改动的全部意思 */}
        <button
          type="button"
          className="sidebar__folder"
          onClick={onOpenFolder}
          data-tip="打开文件夹…"
          aria-label="打开文件夹…"
        >
          <FolderIcon size={SIDEBAR_ICON} />
        </button>
      </div>

      <SidebarSearch box={box} query={query} onQuery={onQuery} />
    </>
  )
}
