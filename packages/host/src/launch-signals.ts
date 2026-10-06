import type { EngineAxis, EngineGoal, Thread, TrustApply } from "@switchback/protocol"

/** 驱动在 `start()` 返回前就可能回报的会话状态。 */
export interface EarlySignals {
  handle?: string
  title?: string
  model?: string
  effort?: string
  engineSeen: boolean
  axes: Map<string, EngineAxis>
  modelId?: string
  trustApply?: TrustApply
  goalSeen: boolean
  goal?: EngineGoal
}

export function earlySignals(): EarlySignals {
  return { engineSeen: false, axes: new Map<string, EngineAxis>(), goalSeen: false }
}

export function captureModel(early: EarlySignals, model?: string, effort?: string): void {
  if (model !== undefined) early.model = model
  if (effort !== undefined) early.effort = effort
}

export function captureTitle(early: EarlySignals, raw: string): void {
  const title = raw.trim()
  if (title !== "") early.title = title
}

export function captureEngine(
  early: EarlySignals,
  patch: { axes?: readonly EngineAxis[]; modelId?: string },
): void {
  early.engineSeen = true
  for (const axis of patch.axes ?? []) early.axes.set(axis.axis, axis)
  if (patch.modelId !== undefined) early.modelId = patch.modelId
}

/** `undefined` 是原生清空快照，必须和“握手期没报目标”分开。 */
export function captureGoal(early: EarlySignals, goal: EngineGoal | undefined): void {
  early.goalSeen = true
  if (goal === undefined) delete early.goal
  else early.goal = goal
}

function modelPatch(early: EarlySignals): Partial<Pick<Thread, "model" | "effort">> {
  return {
    ...(early.model === undefined ? {} : { model: early.model }),
    ...(early.effort === undefined ? {} : { effort: early.effort }),
  }
}

function enginePatch(
  thread: Thread,
  early: EarlySignals,
  at: number,
): Partial<Pick<Thread, "engineState">> {
  if (!early.engineSeen) return {}
  const prev = thread.engineState
  const axes = new Map((prev?.axes ?? []).map((axis) => [axis.axis, axis]))
  for (const axis of early.axes.values()) axes.set(axis.axis, axis)
  const modelId = early.modelId ?? prev?.modelId
  return {
    engineState: {
      axes: [...axes.values()],
      ...(modelId === undefined ? {} : { modelId }),
      at,
    },
  }
}

function changedTitle(thread: Thread, early: EarlySignals): string | undefined {
  if (early.title === undefined || thread.named === true || early.title === thread.title) return undefined
  return early.title
}

/** 握手期回调先静默并入出生快照，避免 `updated` 跑到 `started` 前面。 */
export function applyEarly(thread: Thread, early: EarlySignals, at: number): Thread {
  const title = changedTitle(thread, early)
  const changed = title !== undefined
    || early.model !== undefined
    || early.effort !== undefined
    || early.engineSeen
    || early.trustApply !== undefined
    || early.goalSeen
  if (!changed) return thread
  const next: Thread = {
    ...thread,
    ...(title === undefined ? {} : { title }),
    ...modelPatch(early),
    ...enginePatch(thread, early, at),
    ...(early.trustApply === undefined ? {} : { trustApply: early.trustApply }),
    updatedAt: at,
  }
  if (early.goalSeen) {
    if (early.goal === undefined) delete next.goal
    else next.goal = early.goal
  }
  return next
}
