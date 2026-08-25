import type { Event, Item, ToolCallItem, TurnId } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { createDenialState } from "./denials.js"
import { onAssistant, onToolResults, makeIdMinter, type MessageRef } from "./messages.js"
import { createPlanState } from "./plan.js"
import { createRetractionState } from "./retraction.js"
import { createStream, onStreamEvent } from "./stream.js"
import { taskIdForParent } from "./task-links.js"
import type { TaskState } from "./tasks.js"
import { createThinkingState } from "./thinking.js"
import type { RawLoopMessage } from "./loop-wire.js"

interface SidechainRef extends MessageRef {
  laneId: string
  originItemId: string
}

/** 显式挂在 TurnRef 上，不用模块级缓存；同一原生会话里的后台任务可以跨主 result 存活。 */
export interface SidechainState {
  refs: Map<string, SidechainRef>
  serial: number
}

export function createSidechainState(): SidechainState {
  return { refs: new Map(), serial: 0 }
}

function createRef(state: SidechainState, parent: string, laneId: string, turnId: TurnId): SidechainRef {
  state.serial += 1
  return {
    current: turnId,
    seq: 0,
    namespace: `s${String(state.serial)}`,
    laneId,
    originItemId: parent,
    tools: new Map(),
    notices: new Map(),
    plan: createPlanState(),
    thinking: createThinkingState(),
    retractions: createRetractionState(),
    denials: createDenialState(),
    stream: createStream(),
  }
}

function tagItem(item: Item, ref: SidechainRef): Item {
  if (item.kind === "approval" || item.kind === "error") return item
  return { ...item, lane: { id: ref.laneId, originItemId: ref.originItemId } }
}

function childRequest(req: StartRequest, ref: SidechainRef): StartRequest {
  return {
    ...req,
    emit: (event: Event) => {
      if (event.type !== "item.started" && event.type !== "item.updated") {
        req.emit(event)
        return
      }
      req.emit({ ...event, item: tagItem(event.item, ref) })
    },
  }
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined

/** task 生命周期先建立 tool_use → lane 的原生对应，之后 sidechain 帧才能诚实归档。 */
export function syncSidechainTask(
  state: SidechainState,
  tasks: TaskState,
  msg: RawLoopMessage,
  frame: { turnId: TurnId | undefined; req: StartRequest; at: number },
): void {
  const { turnId, req, at } = frame
  const taskId = text(msg.task_id)
  const parent = text(msg.tool_use_id)
  if (taskId !== undefined && parent !== undefined && turnId !== undefined && !tasks.hidden.has(taskId)) {
    const linked = taskIdForParent(tasks.links, parent)
    if (linked === taskId && !state.refs.has(parent)) {
      state.refs.set(parent, createRef(state, parent, taskId, turnId))
    }
  }
  if (taskId === undefined) return
  const lane = tasks.lanes.get(taskId)
  if (lane?.status === "done" || lane?.status === "failed") {
    settleLane(state, taskId, lane.status, { req, at })
  }
}

/** 没有 task_started/tool_use_id 对应就不猜 lane；这种帧继续保持不可见。 */
export function onSidechainMessage(
  state: SidechainState,
  msg: RawLoopMessage,
  req: StartRequest,
  at: number,
): void {
  const parent = text(msg.parent_tool_use_id)
  const ref = parent === undefined ? undefined : state.refs.get(parent)
  const turnId = ref?.current
  if (ref === undefined || turnId === undefined) return
  const child = childRequest(req, ref)
  if (msg.type === "assistant") onAssistant(msg, ref, child, at)
  else if (msg.type === "user") onToolResults(msg, ref, child, at)
  else if (msg.type === "stream_event") {
    onStreamEvent(ref.stream, msg.event, {
      turnId,
      at,
      nextId: makeIdMinter(ref, turnId),
      emit: child.emit,
    })
  }
}

function unsettled(item: ToolCallItem, done: boolean): ToolCallItem {
  return done
    ? { ...item, status: "failed", error: "Claude 在子任务结束前没有报告这次工具调用的结果。" }
    : { ...item, status: "failed" }
}

function settleRef(ref: SidechainRef, done: boolean, req: StartRequest, at: number): void {
  const child = childRequest(req, ref)
  for (const [nativeId, item] of ref.tools) {
    const ended = unsettled(item, done)
    ref.denials.settled.set(nativeId, ended)
    child.emit({ type: "item.updated", at, item: ended })
  }
  ref.tools.clear()
}

function settleLane(
  state: SidechainState,
  laneId: string,
  status: "done" | "failed",
  frame: { req: StartRequest; at: number },
): void {
  for (const ref of state.refs.values()) {
    if (ref.laneId === laneId) settleRef(ref, status === "done", frame.req, frame.at)
  }
}

/** 进程整条消息流离开时，不能把侧栏里的 shell 永久留在 running。 */
export function settleSidechains(state: SidechainState, req: StartRequest, at: number): void {
  for (const ref of state.refs.values()) settleRef(ref, false, req, at)
}
