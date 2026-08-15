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
