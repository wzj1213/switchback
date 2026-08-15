import type { ToolDetail } from "@omni/protocol"

/** 工具形态 → 动词。运行态状态行与工具阶梯共用，两处措辞必须一致。 */
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
    case "file_edit":
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
