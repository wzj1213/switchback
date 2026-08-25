/** Claude 的 sidechain 用启动工具 id 标父级，而活动生命周期用 task id；这里保留原生对应。 */
export interface TaskLinks {
  parents: Map<string, string>
}

export function createTaskLinks(): TaskLinks {
  return { parents: new Map() }
}

export function rememberTaskParent(links: TaskLinks, taskId: string, raw: unknown): void {
  if (typeof raw !== "object" || raw === null) return
  const parent = (raw as { tool_use_id?: unknown }).tool_use_id
  if (typeof parent === "string" && parent !== "") links.parents.set(parent, taskId)
}

export function taskIdForParent(links: TaskLinks, parent: string): string | undefined {
  return links.parents.get(parent)
}
