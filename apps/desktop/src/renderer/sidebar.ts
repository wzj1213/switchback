import type { ThreadRow } from "@omni/store"

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

export interface Group {
  /** 工作区绝对路径。折叠状态按它记。 */
  cwd: string
  /** 组标题：目录名。 */
  label: string
  rows: readonly ThreadRow[]
}

/** 目录名。根目录退化成 `/`，不要显示成空字符串。 */
export function baseNameOf(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? "/"
}

/**
 * 一行显示什么。
 *
 * **第一句话优先**，没有才回落到标题。一个刚建好还没说话的会话
 * 显示「新会话」——比显示一个和组标题重复的目录名有用。
 */
export function rowLabelOf(row: ThreadRow): string {
  // **人亲自起的名字最大。** 不加这一条的话改名会「没反应」——
  // 下面那句 preview 永远赢，而 preview 是自动的
  if (row.thread.named === true) return row.thread.title
  const preview = row.preview?.trim()
  if (preview !== undefined && preview !== "") return preview
  // 标题和组标题一样时说明它就是目录名，重复一遍没有意义
  return row.thread.title === baseNameOf(row.thread.cwd) ? "新会话" : row.thread.title
}

/**
 * 按工作区分组，**保持传入的顺序**。
 *
 * 组的先后由「组里最新的那个会话」决定，而 `rows` 本来就是最新在前——
 * 所以按首次出现的顺序收集即可，不用再排一次。再排一次的风险是
 * 和侧栏「最近的在上面」这条规则打架，而那条规则刚修好过一次。
 */
export function groupByWorkspace(rows: readonly ThreadRow[]): readonly Group[] {
  const groups = new Map<string, Group>()
  for (const row of rows) {
    const cwd = row.thread.cwd
    const existing = groups.get(cwd)
    if (existing === undefined) {
      groups.set(cwd, { cwd, label: baseNameOf(cwd), rows: [row] })
      continue
    }
    groups.set(cwd, { ...existing, rows: [...existing.rows, row] })
  }
  return [...groups.values()]
}

/** 项目多到一定程度才折叠。少于这个数时「展开显示」只是白多一行。 */
export const PROJECT_MAX = 6

export interface Sections {
  pinned: readonly Group[]
  projects: readonly Group[]
  /** 不属于任何项目的对话，扁平，最近动过的在前。 */
  chats: readonly ThreadRow[]
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
export function sectionsOf(rows: readonly ThreadRow[], pinned: readonly string[]): Sections {
  const chats = rows.filter((r) => r.thread.workspaceKind === "chat")
  const inProjects = rows.filter((r) => r.thread.workspaceKind !== "chat")
  const groups = groupByWorkspace(inProjects)
  const isPinned = new Set(pinned)
  return {
    // 按**用户置顶的先后**排，不按最近活动排：钉住的顺序是他自己定的，
    // 底下再自动重排一次就等于没钉
    pinned: pinned.flatMap((cwd) => groups.filter((g) => g.cwd === cwd)),
    projects: groups.filter((g) => !isPinned.has(g.cwd)),
    chats: [...chats].sort((a, b) => b.thread.updatedAt - a.thread.updatedAt),
  }
}
