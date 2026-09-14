import { canonicalPath } from "../shared/paths.js"
import type { PreviewTarget } from "./workbench.js"

export interface PreviewHistory {
  back: readonly PreviewTarget[]
  forward: readonly PreviewTarget[]
}

const EMPTY: PreviewHistory = { back: [], forward: [] }
const LIMIT = 30

function samePlace(a: PreviewTarget, b: PreviewTarget): boolean {
  return canonicalPath(a.path, a.cwd) === canonicalPath(b.path, b.cwd)
    && a.line === b.line && a.column === b.column && a.fragment === b.fragment
}

/** 只记录当前任务的阅读路径；重定位同一处不堆叠重复记录。 */
export function visitPreview(history: PreviewHistory | undefined, current: PreviewTarget | undefined,
  next: PreviewTarget): PreviewHistory {
  if (current === undefined || current.threadId !== next.threadId || current.cwd !== next.cwd) return EMPTY
  const trail = history ?? EMPTY
  if (samePlace(current, next)) return trail
  return { back: [...trail.back, current].slice(-LIMIT), forward: [] }
}

export function adjacentPreview(history: PreviewHistory | undefined, direction: -1 | 1): PreviewTarget | undefined {
  return (direction === -1 ? history?.back : history?.forward)?.at(-1)
}

export function stepPreview(history: PreviewHistory | undefined, current: PreviewTarget | undefined,
  direction: -1 | 1): { history: PreviewHistory; file: PreviewTarget } | undefined {
  const next = adjacentPreview(history, direction)
  if (history === undefined || current === undefined || next === undefined) return undefined
  if (next.threadId !== current.threadId || next.cwd !== current.cwd) return undefined
  const moved = direction === -1
    ? { back: history.back.slice(0, -1), forward: [...history.forward, current].slice(-LIMIT) }
    : { back: [...history.back, current].slice(-LIMIT), forward: history.forward.slice(0, -1) }
  return { history: moved, file: { ...next, at: (current.at ?? 0) + 1 } }
}
