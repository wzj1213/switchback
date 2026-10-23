import type { ToolDetail } from "@switchback/protocol"
import { count, defineMessages } from "@switchback/i18n"

type Kind = ToolDetail["kind"]

const DONE_ZH: Readonly<Record<Kind, string>> = {
  shell: "运行了命令",
  file_edit: "编辑了文件",
  file_read: "读取了文件",
  fetch: "请求了网页",
  other: "调用了工具",
}

/** 英文的折叠摘要带个数：「Edited 2 files」比「Edited files」说得准，中文那版本来就不带数。 */
const DONE_EN: Readonly<Record<Kind, (n: number) => string>> = {
  shell: (n) => `Ran ${count(n, "command")}`,
  file_edit: (n) => `Edited ${count(n, "file")}`,
  file_read: (n) => `Read ${count(n, "file")}`,
  fetch: (n) => `Fetched ${count(n, "page")}`,
  other: (n) => `Called ${count(n, "tool")}`,
}

/**
 * 工具调用的说法。
 *
 * `verb` 是**这一步是什么**（图标的读屏名、导出里那一行的动词），`running` 是状态行上的
 * **正在做**，`done` 是折叠摘要里的**做过了**。中文里前两个是同一组词，英文要分开：
 * 「Run pnpm test」当状态读着像命令，「Running pnpm test」当图标名又多了个时态。
 */
export const TOOL = defineMessages(
  {
    verb: { shell: "执行", file_edit: "编辑", file_read: "读取", fetch: "请求", other: "调用" },
    running: { shell: "执行", file_edit: "编辑", file_read: "读取", fetch: "请求", other: "调用" },
    state: { running: "运行中", pending: "等待", failed: "失败", denied: "已拒绝", interrupted: "已中断" },
    waitingTerminal: "等待后台终端",
    files: (n: number) => `${String(n)} 个文件`,
    terminalOutput: "终端输出：",
    terminalInput: (n: number) => `后台终端输入 ${String(n)}：`,
    done: (kind: Kind, _n: number) => DONE_ZH[kind],
  },
  {
    verb: { shell: "Run", file_edit: "Edit", file_read: "Read", fetch: "Fetch", other: "Call" },
    running: { shell: "Running", file_edit: "Editing", file_read: "Reading", fetch: "Fetching", other: "Calling" },
    state: { running: "Running", pending: "Waiting", failed: "Failed", denied: "Denied", interrupted: "Interrupted" },
    waitingTerminal: "Waiting for background terminal",
    files: (n) => count(n, "file"),
    terminalOutput: "Terminal output:",
    terminalInput: (n) => `Background terminal input ${String(n)}:`,
    done: (kind, n) => DONE_EN[kind](n),
  },
)
