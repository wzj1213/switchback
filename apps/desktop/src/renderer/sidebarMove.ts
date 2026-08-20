import type { Sections } from "./sidebar.js"

export type MoveDirection = -1 | 1

export function shifted(
  ids: readonly string[],
  id: string,
  direction: MoveDirection,
): readonly string[] {
  const from = ids.indexOf(id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= ids.length) return ids
  const next = [...ids]
  ;[next[from], next[to]] = [next[to] ?? "", next[from] ?? ""]
  return next
}

export function canShift(ids: readonly string[], id: string, direction: MoveDirection): boolean {
  const at = ids.indexOf(id)
  return at >= 0 && at + direction >= 0 && at + direction < ids.length
}

export interface SidebarMoveActions {
  canMoveThread: (id: string, direction: MoveDirection) => boolean
  moveThread: (id: string, direction: MoveDirection) => void
  canMoveProject: (cwd: string, direction: MoveDirection) => boolean
  moveProject: (cwd: string, direction: MoveDirection) => void
}

export function sidebarMoves(o: {
  sections: Sections
  onThreads: (ids: readonly string[]) => void
  onGroupThreads: (cwd: string, ids: readonly string[]) => void
  onPinnedProjects: (ids: readonly string[]) => void
  onProjects: (ids: readonly string[]) => void
}): SidebarMoveActions {
  const threadIds = o.sections.pinnedThreads.map((row) => row.thread.id)
  const groups = [...o.sections.pinned, ...o.sections.projects]
  const groupOf = (id: string) =>
    groups.find((group) => group.rows.some((row) => row.thread.id === id))
  const projectIds = (cwd: string) =>
    (o.sections.pinned.some((group) => group.cwd === cwd)
      ? o.sections.pinned
      : o.sections.projects
    ).map((group) => group.cwd)
  const threadOrder = (id: string): readonly string[] | undefined => {
    if (threadIds.includes(id)) return threadIds
    return groupOf(id)?.rows.map((row) => row.thread.id)
  }
  return {
    canMoveThread: (id, direction) => canShift(threadOrder(id) ?? [], id, direction),
    moveThread: (id, direction) => {
      if (threadIds.includes(id)) {
        o.onThreads(shifted(threadIds, id, direction))
        return
      }
      const group = groupOf(id)
      if (group !== undefined)
        o.onGroupThreads(
          group.cwd,
          shifted(
            group.rows.map((row) => row.thread.id),
            id,
            direction,
          ),
        )
    },
    canMoveProject: (cwd, direction) => canShift(projectIds(cwd), cwd, direction),
    moveProject: (cwd, direction) => {
      const next = shifted(projectIds(cwd), cwd, direction)
      if (o.sections.pinned.some((group) => group.cwd === cwd)) o.onPinnedProjects(next)
      else o.onProjects(next)
    },
  }
}
