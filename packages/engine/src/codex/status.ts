import type { EngineStatus, Event, ThreadId } from "@switchback/protocol"

/** 会话级引擎状态的唯一组帧处；空详情不写进事件。 */
export function emitCodexStatus(
  emit: (event: Event) => void,
  threadId: ThreadId,
  status: EngineStatus,
  detail?: string,
): void {
  emit({
    type: "engine.status",
    at: Date.now(),
    threadId,
    status,
    ...(detail === undefined || detail === "" ? {} : { detail }),
  })
}
