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

/** 「最近」里放几条。太多就和上面的项目树重复了，太少又起不到「回到刚才」的作用。 */
export const RECENT_MAX = 6

/** 项目多到一定程度才折叠。少于这个数时「展开显示」只是白多一行。 */
export const PROJECT_MAX = 6

export interface Sections {
  pinned: readonly Group[]
  projects: readonly Group[]
  /** 跨项目的最近会话，扁平。 */
  recent: readonly ThreadRow[]
}

/**
 * 侧栏分三段。
 *
 * ## 为什么要有「最近」
 *
 * 项目树回答的是「我有哪些项目」，但人打开应用时想的是
 * **「我刚才在干嘛」**——那是一个跨项目的问题，项目树答不了：
 * 上一个会话可能埋在第四个折叠组里。
 *
 * 所以「最近」是扁平的、跨项目的、按最后动过的时间排。
 * 它和上面的项目树**会重复**，这是有意的：两条路通向同一个东西，
 * 因为人有两种不同的找法。
 *
 * ## 置顶为什么单独一段而不是排在最前
 *
 * 排在最前的话，它和普通项目长得一样，用户就看不出「这几个是我钉住的」——
 * 于是也想不起来还能取消置顶。分段本身就是那条说明。
 */
export function sectionsOf(rows: readonly ThreadRow[], pinned: readonly string[]): Sections {
  const groups = groupByWorkspace(rows)
  const isPinned = new Set(pinned)
  return {
    // 按**用户置顶的先后**排，不按最近活动排：钉住的顺序是他自己定的，
    // 底下再自动重排一次就等于没钉
    pinned: pinned.flatMap((cwd) => groups.filter((g) => g.cwd === cwd)),
    projects: groups.filter((g) => !isPinned.has(g.cwd)),
    recent: [...rows]
      .sort((a, b) => b.thread.updatedAt - a.thread.updatedAt)
      .slice(0, RECENT_MAX),
  }
}
