import type { ToolCallItem, ToolDetail } from "@switchback/protocol"
import { fileReference } from "./file-references.js"

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

const TOOL_STATE: Partial<Record<ToolCallItem["status"], string>> = {
  running: "运行中",
  pending: "等待",
  failed: "失败",
  denied: "已拒绝",
  interrupted: "已中断",
}

/** 后台轮询比泛化的「运行中」更具体；其余状态沿用统一中文标签。 */
export function toolStatusText(item: ToolCallItem): string | undefined {
  if (
    item.status === "running" &&
    item.detail.kind === "shell" &&
    item.detail.terminal?.waiting === true
  ) {
    return "等待后台终端"
  }
  return TOOL_STATE[item.status]
}

/**
 * 路径落到工作区里就写相对的。
 *
 * 引擎报上来的都是绝对路径，照原样贴出来是这样：
 *
 *     /private/tmp/claude-501/-Users-you-learn-agent-learn/c313d…/demo/README.md
 *
 * ——一行里 90% 是每一条都一样的前缀，真正在说事的 `README.md` 反倒被截断了。
 *
 * **落在工作区外的路径保留绝对形式**，而且这是有意的：那正是「它伸到项目外面去了」
 * 的时刻，一个突然变长的绝对路径本身就是提醒。缩短它等于把这个信号抹平。
 */
export function relPath(path: string, cwd: string): string {
  const reference = fileReference(cwd, path)
  // `cwd` 本身不显示成点；外部路径也保留原样，让越界仍然醒目。
  return reference.outside || reference.path === "." ? path : reference.path
}

export function target(detail: ToolDetail, cwd?: string): string {
  switch (detail.kind) {
    case "shell":
      return detail.command
    // 一次 apply_patch 可以改好几个文件。只报第一个的话，界面会写着
    // 「编辑 index.js」而实际上 math.js 也被改了——**说了假话**。
    case "file_edit":
      return detail.files.length > 1
        ? `${String(detail.files.length)} 个文件`
        : shorten(detail.path, cwd)
    case "file_read":
      return shorten(detail.path, cwd)
    case "fetch":
      return detail.url
    case "other":
      return detail.name
  }
}

function shorten(path: string, cwd: string | undefined): string {
  return cwd === undefined ? path : relPath(path, cwd)
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

/** 运行横幅与工具行共用同一事实判断，避免一处说等待、另一处仍说执行。 */
export function runningToolLabel(item: ToolCallItem): string {
  const verb = toolStatusText(item) === "等待后台终端" ? "等待后台终端" : VERB[item.detail.kind]
  return `${verb} ${brief(item.detail)}`
}

/** 后台输入与 stdout 分区展示，不能把模型写入终端的内容冒充成进程输出。 */
export function shellTranscript(
  detail: Extract<ToolDetail, { kind: "shell" }>,
): string | undefined {
  const inputs = detail.terminal?.inputs ?? []
  if (inputs.length === 0) return detail.output
  const sections = inputs.map((input, index) => `后台终端输入 ${String(index + 1)}：\n${input}`)
  if (detail.output !== undefined && detail.output !== "")
    sections.unshift(`终端输出：\n${detail.output}`)
  return sections.join("\n\n")
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
