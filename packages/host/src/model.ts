import type { Thread } from "@switchback/protocol"

/** 模型设置失败时回到诚实的“引擎默认”，不能继续显示一个没设上的选择。 */
export function withoutModel(thread: Thread): Thread {
  const next = { ...thread }
  delete next.model
  delete next.effort
  return next
}

/** 记录引擎真正回报的强度，并清掉上一模型遗留的档位。 */
export function withModel(
  thread: Thread,
  model: string,
  applied: { effort?: string },
  updatedAt: number,
): Thread {
  const next = withoutModel(thread)
  return {
    ...next,
    model,
    ...(applied.effort === undefined ? {} : { effort: applied.effort }),
    updatedAt,
  }
}
