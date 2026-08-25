import type { Event } from "@omni/protocol"
import type { Notice, ViewState } from "./state.js"

/** 只有这几档需要打断用户；其余是正常引擎生命周期。 */
const LOUD = new Set(["crashed", "timeout", "degraded"])
const MAX_NOTICES = 20

export function reduceEngineStatus(
  state: ViewState,
  event: Extract<Event, { type: "engine.status" }>,
): ViewState {
  if (!LOUD.has(event.status)) return state
  const seq = state.noticeSeq + 1
  const notice: Notice = {
    id: `n${String(seq)}`,
    at: event.at,
    text: event.detail ?? "引擎报告了一个没有描述的故障",
    kind: event.status === "degraded" ? "degraded" : "crashed",
    threadId: event.threadId === "" ? undefined : event.threadId,
  }
  return { ...state, noticeSeq: seq, notices: [...state.notices, notice].slice(-MAX_NOTICES) }
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
