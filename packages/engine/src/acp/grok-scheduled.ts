import type { ForeignTurn } from "./caps.js"
import { grokExtPayload } from "./grok-ext.js"

const DIRECT = "x.ai/scheduled_task_inject_prompt"
const WRAPPED = "_x.ai/scheduled_task_inject_prompt"

/**
 * Grok 到点后把前台循环交给当前 ACP driver；宿主必须以 `scheduler-fired-` promptId 回送。
 * 只发送事件给出的任务原文。首方 pager 另加的 system-reminder 不属于引擎协议输出，Switchback 不复制。
 */
export function grokScheduledTurn(method: string, params: unknown): ForeignTurn | undefined {
  const payload = method === WRAPPED || method === DIRECT ? grokExtPayload(method, params, DIRECT) : undefined
  const taskId = payload?.["taskId"]
  const prompt = payload?.["prompt"]
  const schedule = payload?.["humanSchedule"]
  if (
    typeof taskId !== "string" ||
    taskId === "" ||
    typeof prompt !== "string" ||
    prompt === "" ||
    typeof schedule !== "string" ||
    schedule === ""
  )
    return undefined
  return {
    key: `grok-scheduled:${taskId}`,
    prompt,
    origin: {
      kind: "scheduled",
      taskId,
      schedule,
      // 1.0.5 的 scheduler_create 明确拒绝 one-shot；每个 Fired 通知只代表一次触发。
      recurring: true,
      coalescedCount: 1,
      stale: false,
    },
    promptMeta: (turnId) => ({ promptId: `scheduler-fired-${turnId}` }),
  }
}
