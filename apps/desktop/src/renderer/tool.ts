import type { Item, ToolDetail } from "@omni/protocol"

/**
 * 工具形态 → 动词。
 *
 * **工具阶梯已经改成图标呈现，那里这张表降级为 `aria-label`**；
 * 但运行态状态行（`status.ts`）与 Markdown 导出（`export.ts`）仍然取字面文本，
 * 所以这张表**不能删**，措辞也要和图标表达的意思保持一致。
 */
export const VERB: Readonly<Record<ToolDetail["kind"], string>> = {
  shell: "执行",
  file_edit: "编辑",
  file_read: "读取",
  fetch: "请求",
  other: "调用",
}

export function target(detail: ToolDetail): string {
  switch (detail.kind) {
    case "shell":
      return detail.command
    // 一次 apply_patch 可以改好几个文件。只报第一个的话，界面会写着
    // 「编辑 index.js」而实际上 math.js 也被改了——**说了假话**。
    case "file_edit":
      return detail.files.length > 1 ? `${String(detail.files.length)} 个文件` : detail.path
    case "file_read":
      return detail.path
    case "fetch":
      return detail.url
    case "other":
      return detail.name
  }
}

const MAX_BRIEF = 48

/**
 * 剥掉 shell 包壳。
 *
 * codex 把每条命令都包成 `/bin/zsh -lc '真正的命令'`。工具阶梯上要显示原样
 * （你得看得见到底执行了什么），但状态行只有一行字——那 16 个字符的壳会把
 * 真正有信息量的部分挤出截断线外。
 */
const SHELL_WRAP = /^\S*(?:sh|bash|zsh)\s+-l?c\s+(['"])([\s\S]*)\1$/

function unwrap(command: string): string {
  return SHELL_WRAP.exec(command.trim())?.[2] ?? command
}

/**
 * 状态行用的短形态。命令剥壳并只取第一行、路径只取文件名——状态行是一行字，
 * 塞一条 120 字符的完整命令进去，等于什么都没说。
 */
export function brief(detail: ToolDetail): string {
  const full = target(detail)
  const short =
    detail.kind === "file_edit" || detail.kind === "file_read"
      ? (full.split("/").pop() ?? full)
      : (unwrap(full).split("\n")[0] ?? full)
  return short.length > MAX_BRIEF ? `${short.slice(0, MAX_BRIEF)}…` : short
}

/**
 * 做完之后怎么说这件事。
 *
 * 和 `VERB` 分开：那个是**正在做**（「执行」「编辑」），配在单行上；
 * 这个是**做过了**（「运行了命令」「编辑了文件」），配在折叠摘要上。
 * codex 的折叠行用的就是这套过去式措辞。
 */
export const DONE_VERB: Readonly<Record<ToolDetail["kind"], string>> = {
  shell: "运行了命令",
  file_edit: "编辑了文件",
  file_read: "读取了文件",
  fetch: "请求了网页",
  other: "调用了工具",
}

/**
 * 一串工具调用折成一句话。
 *
 * **按首次出现去重**：连着读了五个文件不该写五遍「读取了文件」，
 * 但顺序要保留——它就是它做事的顺序。
 */
export function summarize(kinds: readonly ToolDetail["kind"][]): string {
  const seen: ToolDetail["kind"][] = []
  for (const kind of kinds) {
    if (!seen.includes(kind)) seen.push(kind)
  }
  return seen.map((k) => DONE_VERB[k]).join(" · ")
}

export interface Changes {
  files: number
  added: number
  removed: number
}

/**
 * 这一整个会话改了多少东西。
 *
 * codex 在输入框上方挂一枚「1 个文件已更改 +43 −5」——**它回答的是
 * 「我可以走了吗」**：agent 跑了十分钟，你要提交之前想知道它动了多少。
 * 这件事在 transcript 里是散的（分布在十几条编辑行上），得有人加起来。
 *
 * **同一个文件改三次算一个文件**，增删行数累加：用户关心的是「有几个文件
 * 要看」，不是「发生过几次编辑」。
 */
export function changesOf(items: readonly Item[]): Changes {
  const files = new Map<string, { added: number; removed: number }>()
  for (const item of items) {
    if (item.kind !== "tool_call" || item.detail.kind !== "file_edit") continue
    if (item.status !== "ok") continue
    for (const file of item.detail.files) {
      const prev = files.get(file.path) ?? { added: 0, removed: 0 }
      files.set(file.path, { added: prev.added + file.added, removed: prev.removed + file.removed })
    }
  }
  let added = 0
  let removed = 0
  for (const tally of files.values()) {
    added += tally.added
    removed += tally.removed
  }
  return { files: files.size, added, removed }
}
