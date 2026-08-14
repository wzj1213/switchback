import type { query } from "@anthropic-ai/claude-agent-sdk"
import type { Event, ItemId, TurnId } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { assistantItems, turnStatus } from "./translate.js"

/** SDK 消息的结构性最小类型——理由同 translate.ts。 */
interface RawMessage {
  type: string
  subtype?: string
  is_error?: boolean
  message?: { content?: unknown }
}

/**
 * 当前轮次。宿主在 `prompt()` 时写入，引擎在收到 result 时清空。
 * 用可变引用而不是参数，是因为消息循环跑在会话整个生命周期上，
 * 而轮次会在这期间反复开合。
 */
export interface TurnRef {
  current: TurnId | undefined
  /** item id 序号，跨轮递增，保证同一会话内不重复 */
  seq: number
}

function makeIdMinter(ref: TurnRef, turnId: TurnId): () => ItemId {
  return () => {
    ref.seq += 1
    return `${turnId}:i${String(ref.seq)}`
  }
}

function onAssistant(msg: RawMessage, ref: TurnRef, req: StartRequest, at: number): void {
  const turnId = ref.current
  // 宿主总是先开轮次再 prompt；没有轮次说明这条消息不属于任何一次请求，丢掉
  if (turnId === undefined) return
  const content = msg.message?.content
  if (!Array.isArray(content)) return
  for (const item of assistantItems(content, { turnId, at, nextId: makeIdMinter(ref, turnId) })) {
    req.emit({ type: "item.started", at, item })
  }
}

function onResult(msg: RawMessage, ref: TurnRef, req: StartRequest, at: number): void {
  const turnId = ref.current
  ref.current = undefined
  if (turnId === undefined) return
  req.emit({
    type: "turn.completed",
    at,
    turnId,
    status: turnStatus(msg.subtype ?? "", msg.is_error === true),
  })
}

function dispatch(msg: RawMessage, ref: TurnRef, req: StartRequest, at: number): void {
  switch (msg.type) {
    case "assistant":
      onAssistant(msg, ref, req, at)
      return
    case "result":
      onResult(msg, ref, req, at)
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
  ref: TurnRef,
): Promise<void> {
  try {
    for await (const msg of handle) {
      dispatch(msg as RawMessage, ref, req, Date.now())
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const crashed: Event = {
      type: "engine.status",
      at: Date.now(),
      threadId: req.threadId,
      status: "crashed",
      detail,
    }
    req.emit(crashed)
    throw error
  }
  req.emit({ type: "engine.status", at: Date.now(), threadId: req.threadId, status: "exited" })
}
