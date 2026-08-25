export type WorkbenchPage = "activity" | "files"

export interface PreviewTarget {
  cwd: string
  path: string
}

/** 右侧工作台只存“正在看什么”；关闭它不会碰后台任务或文件。 */
export interface WorkbenchState {
  visible: boolean
  page: WorkbenchPage
  laneId?: string
  file?: PreviewTarget
}

export const CLOSED_WORKBENCH: WorkbenchState = { visible: false, page: "activity" }

export function hideWorkbench(state: WorkbenchState): WorkbenchState {
  return state.visible ? { ...state, visible: false } : state
}

/** 从固定入口重开活动页时保住上次看的 lane。 */
export function showActivity(state: WorkbenchState): WorkbenchState {
  return state.visible && state.page === "activity" ? state : { ...state, visible: true, page: "activity" }
}

export function showLane(state: WorkbenchState, laneId: string): WorkbenchState {
  return { ...state, visible: true, page: "activity", laneId }
}

export function showActivityIndex(state: WorkbenchState): WorkbenchState {
  return {
    visible: true,
    page: "activity",
    ...(state.file === undefined ? {} : { file: state.file }),
  }
}

export function showFiles(state: WorkbenchState): WorkbenchState {
  return state.visible && state.page === "files" ? state : { ...state, visible: true, page: "files" }
}

export function showFile(state: WorkbenchState, file: PreviewTarget): WorkbenchState {
  return { ...state, visible: true, page: "files", file }
}

export function showFileIndex(state: WorkbenchState): WorkbenchState {
  return {
    visible: true,
    page: "files",
    ...(state.laneId === undefined ? {} : { laneId: state.laneId }),
  }
}

/** 切会话时只投影当前工作区有效的选择；切回来还能回到原位置。 */
export function scopeWorkbench(
  state: WorkbenchState,
  laneIds: ReadonlySet<string>,
  cwd: string,
): WorkbenchState {
  const laneId = state.laneId !== undefined && laneIds.has(state.laneId) ? state.laneId : undefined
  const file = state.file?.cwd === cwd ? state.file : undefined
  if (laneId === state.laneId && file === state.file) return state
  return {
    ...state,
    ...(laneId === undefined ? { laneId: undefined } : { laneId }),
    ...(file === undefined ? { file: undefined } : { file }),
  }
}
