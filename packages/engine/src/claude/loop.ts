import type { query } from "@anthropic-ai/claude-agent-sdk"
import type { Event, ItemId, TurnId } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { assistantItems, turnStatus } from "./translate.js"

/** SDK 消息的结构性最小类型——理由同 translate.ts。 */
interface RawMessage {
  type: string
  subtype?: string
  is_error?: boolean
  uuid?: string
  message?: { content?: unknown }
}

interface LoopState {
  turn: TurnId | undefined
  seq: number
}

function openTurn(state: LoopState, req: StartRequest, at: number): TurnId {
  const existing = state.turn
  if (existing !== undefined) return existing
  state.seq += 1
  const turnId = `${req.threadId}:t${String(state.seq)}`
  state.turn = turnId
  req.emit({
    type: "turn.started",
    at,
    turn: {
      id: turnId,
      threadId: req.threadId,
      engine: "claude",
      status: "running",
      startedAt: at,
    },
  })
  return turnId
}

function makeIdMinter(state: LoopState, turnId: TurnId): () => ItemId {
  return () => {
    state.seq += 1
    return `${turnId}:i${String(state.seq)}`
  }
}

function onAssistant(msg: RawMessage, state: LoopState, req: StartRequest, at: number): void {
  const turnId = openTurn(state, req, at)
  const content = msg.message?.content
  if (!Array.isArray(content)) return
  for (const item of assistantItems(content, { turnId, at, nextId: makeIdMinter(state, turnId) })) {
    req.emit({ type: "item.started", at, item })
  }
}

function onResult(msg: RawMessage, state: LoopState, req: StartRequest, at: number): void {
  const turnId = state.turn
  state.turn = undefined
  if (turnId === undefined) return
  const status = turnStatus(msg.subtype ?? "", msg.is_error === true)
  const event: Event = { type: "turn.completed", at, turnId, status }
  req.emit(event)
}

function dispatch(msg: RawMessage, state: LoopState, req: StartRequest, at: number): void {
  switch (msg.type) {
    case "assistant":
      onAssistant(msg, state, req, at)
      return
    case "result":
      onResult(msg, state, req, at)
      return
    case "system":
      if (msg.subtype === "init") {
        req.emit({ type: "engine.status", at, threadId: req.threadId, status: "ready" })
      }
      return
    default:
      // 其余 30+ 种 SDKMessage 暂不进 transcript，见 README「已知限制」
      return
  }
}

/**
 * 消费 SDK 的消息流并翻译成 omni 事件。
 *
 * **不吞异常**：迭代抛出时发一条 `engine.status: crashed` 再重新抛出，
 * 让 `dispose()` 的等待方看得到失败，而不是静默结束。
 */
export async function runMessageLoop(
  handle: ReturnType<typeof query>,
  req: StartRequest,
): Promise<void> {
  const state: LoopState = { turn: undefined, seq: 0 }
  try {
    for await (const msg of handle) {
      dispatch(msg as RawMessage, state, req, Date.now())
    }
  } catch (error) {
    req.emit({
      type: "engine.status",
      at: Date.now(),
      threadId: req.threadId,
      status: "crashed",
      detail: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  req.emit({ type: "engine.status", at: Date.now(), threadId: req.threadId, status: "exited" })
}
