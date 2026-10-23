import { displayStatus, type ThreadRow } from "@switchback/store"
import type { Locale } from "@switchback/i18n"
import { SIDEBAR } from "./sidebar.messages.js"

/**
 * 侧栏的分组与行文案。
 *
 * ## 为什么要按工作区分组
 *
 * 会话的标题默认取目录名，于是同一个项目下的五个会话在侧栏里长得一模一样：
 * 五行 `tmp.90I2Fsagi6`。真正能区分它们的是**第一句话**，但那一行现在是
 * 灰色小字缩在下面。等于把最有用的信息排版成了最不显眼的。
 *
 * 换成「项目分组 + 每行显示第一句话」之后：目录名说一次（组标题），
 * 每行说自己是干什么的。这也正是 codex 侧栏的结构（项目 → 聊天）。
 */

/**
 * 侧栏那份行：`ThreadRow` 加一个**渲染层自己的**旗子。
 *
 * 未读不属于 `@switchback/store`——那份状态是「世界现在长什么样」，两端共用一个归约器，
 * 而「你看没看过」只有这扇窗知道（它甚至不知道另一台机器上你看没看过）。
 * 旗子挂在行上而不是另开一个集合往下传：它描述的就是这一行，
 * 而侧栏从段到组到行有五层，多传一个集合就是五处都要接一遍。
 */
export interface SidebarRow extends ThreadRow {
  /** 后台跑完了、你还没打开过。判据在 `unread.ts`。 */
  unread?: boolean
}

export interface Group {
  /** 工作区绝对路径。折叠状态按它记。 */
  cwd: string
  /** 组标题：目录名。 */
  label: string
  rows: readonly SidebarRow[]
}

/**
 * 折叠起来的项目行要说什么。**三件事各说各的**：转圈说「它在忙，你可以走开」，
 * 待批说「它停下来等你，你不回来它就一直停着」，未读说「它跑完了，结果在里面等你看」。
 *
 * 上一版只数了前两个——而**折叠是默认状态**，于是「后台那条跑完了」
 * 在最常见的情形下一点痕迹都没有。
 */
export function tallyOf(group: Group): { running: number; waiting: number; unread: number } {
  return {
    running: group.rows.filter((r) => r.thread.status === "running").length,
    waiting: group.rows.filter((r) => displayStatus(r.thread) === "waiting_approval").length,
    unread: group.rows.filter((r) => r.unread === true).length,
  }
}

/** 目录名。根目录退化成 `/`，不要显示成空字符串。 */
export function baseNameOf(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? "/"
}

/**
 * 一行显示什么。三档，从硬到软。
 *
 * 1. **人亲自起的名字最大。** 不加这一条的话改名会「没反应」——
 *    下面那句 preview 永远赢，而 preview 是自动的。
 * 2. **引擎自己起的名字次之。** 各家原生客户端都会给会话起名（ACP 走
 *    `session_info`，Claude 走 `generateSessionTitle`），宿主收到就落进 `title`
 *    （见 `host` 的 `rememberTitle`，它同样让着上面那一条）。上一版这层不存在，
 *    于是引擎起好的名字**一个字都没显示出来**：preview 永远赢。而 preview 是
 *    第一句话的原文——第一句话经常是一整段 `curl … | bash && git clone …`，
 *    侧栏一列下来全是命令行开头的那几个字，认不出哪条是哪条。
 * 3. 都没有才回落到第一句话；连话都还没说的显示「新会话」。
 *
 * 「有没有名字」的判据是**它还是不是出生时那个目录名**：新建会话的 title
 * 就取自 cwd 末级（`useWorkspaceActions`），所以只要它变过，就一定是
 * 上面两条之一写的。不为此另加一个字段——那要同时改协议、落盘和回放。
 */
export function rowLabelOf(row: ThreadRow, locale: Locale): string {
  if (row.thread.named === true) return row.thread.title
  if (row.thread.title !== baseNameOf(row.thread.cwd)) return row.thread.title
  const preview = row.preview?.trim()
  return preview === undefined || preview === "" ? SIDEBAR[locale].untitled : preview
}

/**
 * 按工作区分组，**保持传入的顺序**。
 *
 * 组的先后由「组里最新的那个会话」决定，而 `rows` 本来就是最新在前——
 * 所以按首次出现的顺序收集即可，不用再排一次。再排一次的风险是
 * 和侧栏「最近的在上面」这条规则打架，而那条规则刚修好过一次。
 */
export function groupByWorkspace(rows: readonly SidebarRow[]): readonly Group[] {
  const groups = new Map<string, { cwd: string; label: string; rows: SidebarRow[] }>()
  for (const row of rows) {
    const cwd = row.thread.cwd
    const existing = groups.get(cwd)
    if (existing === undefined) {
      groups.set(cwd, { cwd, label: baseNameOf(cwd), rows: [row] })
      continue
    }
    existing.rows.push(row)
  }
  return [...groups.values()]
}

/** 项目多到一定程度才折叠。少于这个数时「展开显示」只是白多一行。 */
export const PROJECT_MAX = 6

/**
 * 「codex 历史」段最多列几条。**和引擎那边的取数上限是同一个数**
 *（见 `catalog.ts` 的 `HISTORY_MAX`）——两处不一致的话，
 * 界面会说「只列最近 40 条」而其实只拿到了 20 条。
 */
export const FOREIGN_MAX = 40

export interface Sections {
  /**
   * 置顶的**会话**。和置顶的项目同处「置顶」那一段，但排在项目前面——
   * 一条被单独钉住的对话，比一整个文件夹更具体，也更可能是你现在要点的。
   */
  pinnedThreads: readonly SidebarRow[]
  pinned: readonly Group[]
  projects: readonly Group[]
  /** 不属于任何项目的对话，扁平，最近动过的在前。 */
  chats: readonly SidebarRow[]
}

/**
 * 侧栏分三段：置顶 / 项目 / 对话。
 *
 * ## 一条会话**只出现一次**，这是硬约束
 *
 * 上一版的第二段叫「最近」，装的是**全量会话按时间排前六条**，
 * 注释里写着「和项目树重复是有意的：两条路通向同一个东西」。
 * 想法本身不坏，但它和这套界面的状态模型根本不兼容——
 * 选中、改名、删除确认全部按 `thread.id` 判定，**一条会话渲染两行，
 * 这些状态就同时亮两处**：
 *
 * - 正在用的那条必然重复（它 `updatedAt` 最大，必进前六），两行一起高亮
 * - 双击改名，两个输入框同时进编辑态，光标落到你没点的那一行
 * - 删除确认的「再点一次」武装在一行上，另一行看不出来
 *
 * 所以第二段的判据换成**「属不属于项目」**，而不是「最不最近」——
 * 互斥是天然的，上面那三个现象是同一个根因，一起消失。
 *
 * 而「不需要先有项目就能开的对话」本来就是缺的一块：
 * 想随手问一句，现在必须先挑一个文件夹。
 *
 * ## 置顶为什么单独一段而不是排在最前
 *
 * 排在最前的话，它和普通项目长得一样，用户就看不出「这几个是我钉住的」——
 * 于是也想不起来还能取消置顶。分段本身就是那条说明。
 */
export interface Pins {
  /** 置顶的项目路径，按置顶先后。 */
  projects: readonly string[]
  /**
   * 项目的手动顺序。**拖过一次，整段就归你排**——和会话那条规矩一样，
   * 不做「一半手动一半自动」：那种混合排序没人说得清一个新项目该落在哪。
   *
   * 表里没提到的（刚打开的、刚建了第一条会话的）排在最前：它最新。
   */
  projectOrder?: readonly string[]
  /**
   * 打开过的项目。**没有会话的也要出现在侧栏里**——
   * 一个项目不必有会话，你可能只是先把它放进来，明天再开工。
   */
  known?: readonly string[]
  /** 置顶的会话 id，按置顶先后。 */
  threads: readonly string[]
  /** 项目内会话的手动顺序：路径 → 会话 id。只有拖过的项目才有。 */
  order: Readonly<Record<string, readonly string[]>>
}

export function sectionsOf(rows: readonly SidebarRow[], pins: Pins): Sections {
  // **置顶的会话从别处摘掉。** 一条会话只出现一次是这套界面的硬约束——
  // 同时出现在两段里的后果是「一个会话同时亮两行、双击改名两个框一起进编辑态」，
  // 上一版的「最近」段就是这么翻的车
  const pinnedIds = new Set(pins.threads)
  const pinnedThreads = pins.threads
    .map((id) => rows.find((r) => r.thread.id === id))
    .filter((r): r is SidebarRow => r !== undefined)
  const rest = rows.filter((r) => !pinnedIds.has(r.thread.id))
  const chats = rest.filter((r) => r.thread.workspaceKind === "chat")
  const inProjects = rest.filter((r) => r.thread.workspaceKind !== "chat")
  const groups = withKnown(
    groupByWorkspace(inProjects).map((g) => ({ ...g, rows: ordered(g.rows, pins.order[g.cwd]) })),
    pins.known ?? [],
  )
  const isPinned = new Set(pins.projects)
  const projects = groups.filter((g) => !isPinned.has(g.cwd))
  return {
    pinnedThreads,
    // 按**用户置顶的先后**排，不按最近活动排：钉住的顺序是他自己定的，
    // 底下再自动重排一次就等于没钉
    pinned: pins.projects.flatMap((cwd) => groups.filter((g) => g.cwd === cwd)),
    projects: orderedGroups(projects, pins.projectOrder),
    chats: [...chats].sort((a, b) => b.thread.updatedAt - a.thread.updatedAt),
  }
}

/**
 * 把「打开过但还没有会话」的项目也摆出来。
 *
 * 空组排在**有会话的那些后面**：手上正在做的事优先，刚放进来还没动的靠后。
 * 已经有会话的项目不会被重复添加（它已经从会话里推出来了）。
 */
function withKnown(groups: readonly Group[], known: readonly string[]): readonly Group[] {
  const seen = new Set(groups.map((g) => g.cwd))
  const empty = known
    .filter((cwd) => !seen.has(cwd))
    .map((cwd) => ({ cwd, label: baseNameOf(cwd), rows: [] as readonly SidebarRow[] }))
  return [...groups, ...empty]
}

/**
 * 项目怎么排。规则和会话那条一模一样（`ordered`），只是键从会话 id 换成路径——
 * **两处共用一套语义**：没拖过按活跃度、拖过一次整段归你排、新的排最前。
 */
export function orderedGroups(groups: readonly Group[], order: readonly string[] | undefined): readonly Group[] {
  if (order === undefined || order.length === 0) return groups
  const rank = new Map(order.map((cwd, i) => [cwd, i]))
  const known = groups.filter((g) => rank.has(g.cwd))
  const fresh = groups.filter((g) => !rank.has(g.cwd))
  return [...fresh, ...known.sort((a, b) => (rank.get(a.cwd) ?? 0) - (rank.get(b.cwd) ?? 0))]
}

/**
 * 一个项目内的会话怎么排。
 *
 * 没拖过就按活跃度（传进来本来就是这个顺序）。**拖过一次，整段就归你排**——
 * 不做「一半手动一半自动」：那种混合排序没人说得清一条新会话该落在哪，
 * 而说不清的排序等于随机。
 *
 * 顺序表里没提到的（拖过之后新建的、或者从别处移进来的）排在**最前**：
 * 它最新，也最可能是你现在要点的。顺序表里有、但会话已经删了的，自然被跳过。
 */
export function ordered(rows: readonly SidebarRow[], order: readonly string[] | undefined): readonly SidebarRow[] {
  if (order === undefined || order.length === 0) return rows
  const rank = new Map(order.map((id, i) => [id, i]))
  const known = rows.filter((r) => rank.has(r.thread.id))
  const fresh = rows.filter((r) => !rank.has(r.thread.id))
  return [...fresh, ...known.sort((a, b) => (rank.get(a.thread.id) ?? 0) - (rank.get(b.thread.id) ?? 0))]
}

/**
 * 把一条会话挪到同一组里的某个位置。**返回整组的新顺序**（要整段落盘，见 `Settings.threadOrder`）。
 *
 * `to` 是「插到这一条前面」；`to` 为 undefined 表示放到末尾。
 * 拖到自己身上、或者拖到自己后面那一条的前面，结果都和原来一样——
 * 这两种是最容易误触的，**必须是无操作而不是抖一下**。
 */
export type DropEdge = "before" | "after"

export function reorder(ids: readonly string[], from: string, to: string | undefined, edge: DropEdge = "before"): readonly string[] {
  if (from === to) return ids
  const without = ids.filter((id) => id !== from)
  if (to === undefined) return [...without, from]
  const at = without.indexOf(to)
  if (at < 0) return ids
  const insert = at + (edge === "after" ? 1 : 0)
  return [...without.slice(0, insert), from, ...without.slice(insert)]
}
