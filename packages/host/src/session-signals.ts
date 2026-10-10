import type { StartRequest } from "@switchback/engine"
import type { ThreadId } from "@switchback/protocol"
import { isCurrent, type Ctx, type Live } from "./ctx.js"
import {
  rememberEngineState,
  rememberGoal,
  rememberHandle,
  rememberModel,
  rememberTitle,
  rememberTrustApply,
} from "./engine-state.js"
import { captureEngine, captureGoal, captureModel, captureTitle, type EarlySignals } from "./launch-signals.js"
import { beginNativeTurn } from "./native-turn.js"
import { exited } from "./live.js"

interface Installing {
  installing: boolean
  early: EarlySignals
}

type SignalCallbacks = Pick<
  StartRequest,
  "onHandle" | "onTitle" | "onModel" | "onEngineState" | "onGoal" | "onTrustApply" | "onNativeTurn" | "onExit"
>

function canCapture(ctx: Ctx, id: ThreadId, lease: Installing): boolean {
  return lease.installing && !ctx.closed && !ctx.removed.has(id)
}

/** 引擎同步回调：登记后直接落 Thread，握手期则先并入唯一出生快照。 */
export function signalCallbacks(ctx: Ctx, live: Live, id: ThreadId, lease: Installing): SignalCallbacks {
  return {
    onHandle: (handle) => {
      if (isCurrent(ctx, live)) rememberHandle(ctx, id, handle)
      else if (canCapture(ctx, id, lease)) lease.early.handle = handle
    },
    onTitle: (title) => {
      if (isCurrent(ctx, live)) rememberTitle(ctx, id, title)
      else if (canCapture(ctx, id, lease)) captureTitle(lease.early, title)
    },
    onModel: (model, effort) => {
      if (isCurrent(ctx, live)) rememberModel(ctx, id, model, effort)
      else if (canCapture(ctx, id, lease)) captureModel(lease.early, model, effort)
    },
    onEngineState: (patch) => {
      if (isCurrent(ctx, live)) rememberEngineState(ctx, id, patch)
      else if (canCapture(ctx, id, lease)) captureEngine(lease.early, patch)
    },
    onGoal: (goal) => {
      if (isCurrent(ctx, live)) rememberGoal(ctx, id, goal)
      else if (canCapture(ctx, id, lease)) captureGoal(lease.early, goal)
    },
    onTrustApply: (result) => {
      if (isCurrent(ctx, live)) rememberTrustApply(ctx, id, result)
      else if (canCapture(ctx, id, lease)) lease.early.trustApply = result
    },
    onNativeTurn: (turn) => beginNativeTurn(ctx, live, turn),
    // 进程或流没了：摘成历史会话，下一句话接回时重新拉起（见 `live.ts` 的 `exited`）
    onExit: (detail) => {
      void exited(ctx, live, detail)
    },
  }
}
