import type { Command } from "./Menu.js"
import type { Group } from "../sidebar.js"
import type { ThreadRow } from "@omni/store"
import { CopyIcon, PinIcon, PlusIcon, RevealIcon, TrashIcon } from "./icons.js"
import { PencilIcon } from "./icons-activity.js"

/*
 * 侧栏右键菜单的内容：能做什么（`workspaceCommands`）、点的是什么（`ProjectHead`）。
 * 从 `Sidebar.tsx` 拆出来是行数闸门逼的，但这一刀也顺：那边管的是**结构**
 * （分区、筛选、展开态），这边管的是**菜单里放什么**。
 */

export interface Acts {
  pinned: readonly string[]
  onNewIn: (cwd: string) => void
  onTogglePin: (cwd: string) => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
}

/**
 * 项目和会话共用的那几条菜单命令。
 *
 * 共用是有意的：两者的右键菜单**前四项必须一样**——用户不该记得
 * 「在会话上右键有复制路径，在项目上右键没有」。会话那边只是多一条删除。
 */
export function workspaceCommands(cwd: string, acts: Acts): readonly Command[] {
  return [
    { label: "在此新建会话", icon: <PlusIcon />, run: () => { acts.onNewIn(cwd) } },
    {
      label: acts.pinned.includes(cwd) ? "取消置顶" : "置顶项目",
      icon: <PinIcon />,
      run: () => { acts.onTogglePin(cwd) },
    },
    { label: "在访达中显示", icon: <RevealIcon />, run: () => { acts.onReveal(cwd) } },
    { label: "复制路径", icon: <CopyIcon />, run: () => { acts.onCopy(cwd) } },
  ]
}

/**
 * 项目菜单顶上那块。
 *
 * 侧栏里项目只剩一个截断的目录名（`agent-lea…`），而人真正要确认的是
 * **「是不是我以为的那个目录」**——同名目录在不同路径下太常见了。
 * 所以这里把完整路径摊开，顺带交代「几个会话、几个在跑」。
 */
export function ProjectHead({ group }: { group: Group }): React.JSX.Element {
  const running = group.rows.filter((r) => r.thread.status === "running").length
  return (
    <>
      <div className="pop__head-title">{group.label}</div>
      {/* 路径可能很长，从**左边**截断——尾巴（真正的项目名）才是要看的。
          `direction: rtl` 是实现左截断的老办法，但它会把开头那个 `/` 甩到行尾
          （`/Users/you/…` 显示成 `Users/you/…/`）——因为斜杠是中性字符，
          方向跟着段落走。`<bdi>` 把这段隔离成一个 LTR 片段，字符顺序就不动了 */}
      <div className="pop__head-path" title={group.cwd}>
        <bdi>{group.cwd}</bdi>
      </div>
      <div className="pop__head-meta">
        {group.rows.length} 个会话
        {running > 0 ? ` · ${String(running)} 个在跑` : ""}
      </div>
    </>
  )
}

/**
 * 两个右键菜单：会话行的、项目行的。
 *
 * **前四项必须一样**（见 `workspaceCommands`），差别只在两头：
 * 会话多「重命名」和「删除」，项目多一张说明卡片。
 */
export function useSidebarMenus(
  acts: Acts,
  openMenu: (event: React.MouseEvent, commands: readonly Command[], head?: React.ReactNode) => void,
): {
  rowMenu: (event: React.MouseEvent, row: ThreadRow, arm: () => void, ren: () => void) => void
  groupMenu: (event: React.MouseEvent, group: Group) => void
} {
  return {
    rowMenu: (event, row, arm, ren) => {
      openMenu(event, [
        { label: "重命名", icon: <PencilIcon />, run: ren },
        ...workspaceCommands(row.thread.cwd, acts),
        { label: "删除会话…", icon: <TrashIcon />, danger: true, run: arm },
      ])
    },
    groupMenu: (event, group) => {
      openMenu(event, workspaceCommands(group.cwd, acts), <ProjectHead group={group} />)
    },
  }
}
