import type { ChangedFile } from "./changes.js"

export interface ChangeSource {
  baseline: boolean
  failed: boolean
  noRepo: boolean
}

/** 低置信度路径必须说出原因，不能混在真实净 diff 里。 */
export function changeNote(state: ChangeSource, files: readonly ChangedFile[]): string | undefined {
  if (state.noRepo) return "工作区不是 Git 仓库，以下采用引擎最后一次上报"
  if (state.failed) {
    return files.length === 0
      ? "读取 Git 差异失败，当前无法确认本次对话是否留下文件改动"
      : "读取 Git 差异失败，以下暂用引擎最后一次上报"
  }
  if (!state.baseline) {
    return "这条会话没有开场基线；以下只说明上报路径当前相对 HEAD 仍有改动，不能归因到本次对话"
  }
  const ignored = files.filter((file) => file.unverified === true).length
  if (ignored === 0) return undefined
  return `${String(ignored)} 个文件被 Git 忽略，无法核实开场与当前内容，保留引擎最后一次上报`
}
