import type { Command } from "./Menu.js"
import type { Group } from "../sidebar.js"
import type { ThreadRow } from "@omni/store"
import { CopyIcon, PinIcon, PlusIcon, RevealIcon, SparkIcon, TrashIcon } from "./icons.js"
import { PencilIcon } from "./icons-activity.js"
import type { MoveDirection, SidebarMoveActions } from "../sidebarMove.js"

/*
 * 侧栏右键菜单的内容：能做什么（`workspaceCommands`）、点的是什么（`ProjectHead`）。
 * 从 `Sidebar.tsx` 拆出来是行数闸门逼的，但这一刀也顺：那边管的是**结构**
 * （分区、筛选、展开态），这边管的是**菜单里放什么**。
 */

export interface Acts extends SidebarMoveActions {
  /** 给项目设图标。空字符串 = 清掉。 */
  onSetIcon?: (cwd: string, icon: string) => void
  pinned: readonly string[]
  /** 已置顶的**会话** id。菜单据此显示「置顶」还是「取消置顶」。 */
  pinnedThreads: readonly string[]
  /** 置顶 / 取消置顶一条会话。 */
  onPinThread: (id: string, pin: boolean) => void
  /** 把一个**空**项目移出侧栏。会话和磁盘上的东西都不动。 */
  onDropProject: (cwd: string) => void
  onNewIn: (cwd: string) => void
  onTogglePin: (cwd: string) => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
}

function moveCommands(
  id: string,
  canMove: (id: string, direction: MoveDirection) => boolean,
  move: (id: string, direction: MoveDirection) => void,
): readonly Command[] {
  return [
    ...(canMove(id, -1) ? [{ label: "上移", run: () => move(id, -1) }] : []),
    ...(canMove(id, 1) ? [{ label: "下移", run: () => move(id, 1) }] : []),
  ]
}

/**
 * 项目和会话共用的那几条菜单命令。
 *
 * 共用是有意的：两者的右键菜单**前四项必须一样**——用户不该记得
 * 「在会话上右键有复制路径，在项目上右键没有」。会话那边只是多一条删除。
 */
export function workspaceCommands(cwd: string, acts: Acts): readonly Command[] {
  return [
    {
      label: "在此新建会话",
      icon: <PlusIcon />,
      run: () => {
        acts.onNewIn(cwd)
      },
    },
    {
      label: acts.pinned.includes(cwd) ? "取消置顶" : "置顶项目",
      icon: <PinIcon />,
      run: () => {
        acts.onTogglePin(cwd)
      },
    },
    {
      label: "在访达中显示",
      icon: <RevealIcon />,
      run: () => {
        acts.onReveal(cwd)
      },
    },
    {
      label: "复制路径",
      icon: <CopyIcon />,
      run: () => {
        acts.onCopy(cwd)
      },
    },
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
      // 置顶排在最前：它是这个菜单里唯一**改变这条会话在侧栏位置**的动作，
      // 而拖拽虽然更快，但得先知道能拖——菜单是给还不知道的人准备的
      const isPinned = acts.pinnedThreads.includes(row.thread.id)
      openMenu(event, [
        {
          label: isPinned ? "取消置顶" : "置顶这个会话",
          icon: <PinIcon />,
          run: () => {
            acts.onPinThread(row.thread.id, !isPinned)
          },
        },
        { label: "重命名", icon: <PencilIcon />, run: ren },
        ...moveCommands(row.thread.id, acts.canMoveThread, acts.moveThread),
        ...workspaceCommands(row.thread.cwd, acts),
        { label: "删除会话…", icon: <TrashIcon />, danger: true, run: arm },
      ])
    },
    groupMenu: (event, group) => {
      openMenu(
        event,
        [
          ...workspaceCommands(group.cwd, acts),
          ...moveCommands(group.cwd, acts.canMoveProject, acts.moveProject),
          ...iconCommands(group.cwd, acts),
          // **只有空项目才给这一条。** 有会话的项目是从会话推出来的，
          // 移不走——摆一个点了没反应的菜单项比没有更糟
          ...(group.rows.length === 0
            ? [
                {
                  label: "移出侧栏",
                  icon: <TrashIcon />,
                  run: () => {
                    acts.onDropProject(group.cwd)
                  },
                },
              ]
            : []),
        ],
        <ProjectHead group={group} />,
      )
    },
  }
}

/**
 * 项目图标那几条。
 *
 * ## 为什么是一小撮固定的 emoji，不是完整选择器
 *
 * 这件事要解决的问题是「一列长得一样的文件夹图标里一眼认出哪个是哪个」——
 * **需要的是「好认」，不是「好看」**。给一个能选 3000 个 emoji 的面板，
 * 人会花两分钟挑一个，然后下次挑了个长得差不多的，于是又认不出来了。
 *
 * 八个形状差异极大、颜色也分得开的，够用而且选起来是一秒钟的事。
 * 想要别的，偏好文件里可以手写任意 emoji（主进程只校验长度）。
 */
const ICONS = ["🟦", "🟩", "🟧", "🟪", "🔴", "⚫️", "🐳", "🧪"] as const

function iconCommands(cwd: string, acts: Acts): readonly Command[] {
  const set = acts.onSetIcon
  if (set === undefined) return []
  return [
    {
      label: "图标",
      icon: <SparkIcon />,
      // 这一条的 `run` 是「清掉图标」（菜单里那个 ×）
      run: () => {
        set(cwd, "")
      },
      pick: ICONS.map((icon) => ({
        icon,
        run: () => {
          set(cwd, icon)
        },
      })),
    },
  ]
}
