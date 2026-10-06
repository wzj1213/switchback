import type { Event } from "@switchback/protocol"
import type { FailureNotice, Notice, ViewState } from "./state.js"

/** 只有这几档需要打断用户；其余是正常引擎生命周期。 */
const LOUD = new Set(["crashed", "timeout", "degraded", "unauthenticated"])
const MAX_NOTICES = 20

function kindOf(status: string): FailureNotice["kind"] {
  if (status === "degraded") return "degraded"
  return status === "unauthenticated" ? "auth" : "crashed"
}

/**
 * 「正在重连」只记在旁边，不进横幅；同一条会话报了任何别的状态就收起它
 *（接回来报 `ready`，接不回来报 `crashed`——后者照常弹横幅）。
 */
function reconnecting(state: ViewState, event: Extract<Event, { type: "engine.status" }>): ViewState {
  if (event.threadId === "") return state
  if (event.status === "reconnecting") {
    const entry = { since: state.reconnecting[event.threadId]?.since ?? event.at, ...(event.detail === undefined ? {} : { detail: event.detail }) }
    return { ...state, reconnecting: { ...state.reconnecting, [event.threadId]: entry } }
  }
  if (state.reconnecting[event.threadId] === undefined) return state
  const rest = Object.entries(state.reconnecting).filter(([id]) => id !== event.threadId)
  return { ...state, reconnecting: Object.fromEntries(rest) }
}

/** 和最后一条是同一件事（同类、同会话、同一句话）：合成一条、计数加一，并当作新的一条重新出现。 */
function sameAsLast(notices: readonly Notice[], next: Notice): Notice | undefined {
  const last = notices[notices.length - 1]
  if (last === undefined || last.kind === "notification" || next.kind === "notification") return undefined
  return last.kind === next.kind && last.threadId === next.threadId && last.text === next.text ? last : undefined
}

export function reduceEngineStatus(
  state: ViewState,
  event: Extract<Event, { type: "engine.status" }>,
): ViewState {
  const base = reconnecting(state, event)
  if (!LOUD.has(event.status)) return base
  const seq = base.noticeSeq + 1
  const notice: Notice = {
    id: `n${String(seq)}`,
    at: event.at,
    text: event.detail ?? "引擎报告了一个没有描述的故障",
    kind: kindOf(event.status),
    threadId: event.threadId === "" ? undefined : event.threadId,
    ...(event.engine === undefined ? {} : { engine: event.engine }),
  }
  const repeat = sameAsLast(base.notices, notice)
  const kept = repeat === undefined ? base.notices : base.notices.slice(0, -1)
  const merged: Notice = repeat === undefined ? notice : { ...notice, count: (repeat.count ?? 1) + 1 }
  return { ...base, noticeSeq: seq, notices: [...kept, merged].slice(-MAX_NOTICES) }
}

/** 外发守卫的警报：和故障同一种横幅，抬头不同（见 `FailureNotice.kind`）。 */
export function reduceEgressAlert(state: ViewState, event: Extract<Event, { type: "egress.alert" }>): ViewState {
  const seq = state.noticeSeq + 1
  const notice: Notice = {
    id: `n${String(seq)}`,
    at: event.at,
    text: event.detail,
    kind: "egress",
    threadId: event.threadId === "" ? undefined : event.threadId,
  }
  const repeat = sameAsLast(state.notices, notice)
  const kept = repeat === undefined ? state.notices : state.notices.slice(0, -1)
  const merged: Notice = repeat === undefined ? notice : { ...notice, count: (repeat.count ?? 1) + 1 }
  return { ...state, noticeSeq: seq, notices: [...kept, merged].slice(-MAX_NOTICES) }
}

export function reduceEngineNotification(
  state: ViewState,
  event: Extract<Event, { type: "engine.notification" }>,
): ViewState {
  const seq = state.noticeSeq + 1
  const notice: Notice = {
    id: `n${String(seq)}`, at: event.at, text: event.message, kind: "notification",
    threadId: event.threadId, engine: event.engine, key: event.key, priority: event.priority,
    ...(event.color === undefined ? {} : { color: event.color }),
    ...(event.timeoutMs === undefined ? {} : { timeoutMs: event.timeoutMs }),
  }
  const other = state.notices.filter((item) =>
    item.kind !== "notification" || item.threadId !== event.threadId ||
    item.engine !== event.engine || item.key !== event.key)
  return { ...state, noticeSeq: seq, notices: [...other, notice].slice(-MAX_NOTICES) }
}
