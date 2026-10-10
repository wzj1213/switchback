import type { Event, NoticeLevel, TurnId, TurnStatus } from "@switchback/protocol"
import type { KimiPayload, KimiSnapshot } from "./wire.js"
import { kimiNativePartId } from "./native-part.js"

export type KimiOperation = "prompt" | "compact"

export interface CompactionUpdate {
  message: string
  level: NoticeLevel
  finish?: TurnStatus
}

function belongs(operation: KimiOperation, trigger: KimiPayload["trigger"]): boolean {
  return (operation === "compact" && trigger === "manual") ||
    (operation === "prompt" && trigger === "auto")
}

function resultMessage(payload: KimiPayload): string {
  const result = payload.result
  const count = result?.compactedCount
  const before = result?.tokensBefore
  const after = result?.tokensAfter
  if (count === undefined || before === undefined || after === undefined) return "上下文已压缩。"
  return `上下文已压缩：${String(count)} 条消息，${String(before)} → ${String(after)} tokens。`
}

/** 事件只给事实；是否结束宿主轮次取决于这是手动操作还是模型轮内自动压缩。 */
export function compactionUpdate(
  operation: KimiOperation,
  payload: KimiPayload,
): CompactionUpdate | undefined {
  if (payload.type === "compaction.started") {
    return belongs(operation, payload.trigger)
      ? { message: "正在压缩上下文…", level: "info" }
      : undefined
  }
  if (payload.type === "compaction.completed") {
    if (payload.trigger !== undefined && !belongs(operation, payload.trigger)) return undefined
    return {
      message: resultMessage(payload),
      level: "info",
      ...(operation === "compact" ? { finish: "completed" as const } : {}),
    }
  }
  if (payload.type === "compaction.blocked") {
    return {
      message: "Compaction is blocked by the current turn; retry when the turn is idle.",
      level: "notice",
    }
  }
  if (payload.type !== "compaction.cancelled") return undefined
  return {
    message: "上下文压缩已取消。",
    level: "notice",
    ...(operation === "compact" ? { finish: "interrupted" as const } : {}),
  }
}

/**
 * 手动压缩时断过线：压缩的起止只走实时帧，断线那段补不回来。Kimi 的 `busy` 把「正在压缩」
 * 算在里面，所以请求已被接下、快照又说空闲，就是压缩已经结束了——结束成什么样它没留下，照实说。
 * 后台任务也算 `busy`：那时分不清，接着等实时帧（见 README「已知限制」）。
 */
export function compactionAfterGap(accepted: boolean, snapshot: KimiSnapshot): CompactionUpdate | undefined {
  if (!accepted || snapshot.session.busy || snapshot.in_flight_turn !== null) return undefined
  return {
    message: "压缩期间连接断过，没收到 Kimi 报的结果；它现在已经空闲，上下文用量以它报的为准。",
    level: "notice",
    finish: "completed",
  }
}

export function compactionEvent(
  turnId: TurnId,
  state: { started: boolean; part: number },
  update: CompactionUpdate,
  at: number,
): Event {
  return {
    type: state.started ? "item.updated" : "item.started",
    at,
    item: {
      id: kimiNativePartId("kimi-compaction", turnId, state.part),
      turnId,
      at,
      kind: "notice",
      message: update.message,
      level: update.level,
    },
  }
}
