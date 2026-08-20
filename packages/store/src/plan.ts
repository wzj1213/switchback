import type { Item, PlanItem, PlanStep } from "@omni/protocol"

/** 计划进度只保留数据，不在 store 里拼任何一端的展示文案。 */
export interface StepProgress {
  /** 一基序号；尚未开始时缺席。 */
  index?: number
  /** 不含已放弃步骤。 */
  total: number
  done: number
  complete: boolean
}

/** 最后一份计划会覆盖此前计划；空计划也是一次明确的清空。 */
export function latestPlan(items: readonly Item[]): PlanItem | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === "plan") return item
  }
  return undefined
}

/**
 * 跨轮沿用最后一份仍有未完成项的计划。
 *
 * 不能倒着找“任意一份未完成计划”：后一份空计划或全完成计划是在明确替换前一份。
 */
export function openPlan(items: readonly Item[]): PlanItem | undefined {
  const plan = latestPlan(items)
  if (plan === undefined) return undefined
  return plan.steps.some((step) => step.status === "pending" || step.status === "in_progress")
    ? plan
    : undefined
}

/** dropped 不进分母；没有 active 时按已经完成的数量推到下一步。 */
export function stepProgressOf(steps: readonly PlanStep[]): StepProgress {
  const kept = steps.filter((step) => step.status !== "dropped")
  const total = kept.length
  const done = kept.filter((step) => step.status === "done").length
  const active = kept.findIndex((step) => step.status === "in_progress")
  if (total === 0) return { total, done, complete: true }
  if (active >= 0) return { index: active + 1, total, done, complete: false }
  if (done === total) return { index: total, total, done, complete: true }
  if (done === 0) return { total, done, complete: false }
  return { index: Math.min(done + 1, total), total, done, complete: false }
}

/**
 * 长计划优先露出正在做与马上要做的；仍有余量时保留最近一条已完成项作上下文。
 * 返回原对象并保持原顺序，渲染层可以安全地按引用/文本展示。
 */
export function visibleSteps(steps: readonly PlanStep[], max: number): readonly PlanStep[] {
  if (max <= 0) return []
  if (steps.length <= max) return steps
  const active = steps.flatMap((step, index) => (step.status === "in_progress" ? [index] : []))
  const pending = steps.flatMap((step, index) => (step.status === "pending" ? [index] : []))
  const done = steps.flatMap((step, index) => (step.status === "done" ? [index] : []))
  const picked = new Set(active.slice(0, max))
  const lastDone = done[done.length - 1]
  if (lastDone !== undefined && picked.size < max) picked.add(lastDone)
  for (const index of pending) {
    if (picked.size >= max) break
    picked.add(index)
  }
  for (const index of [...done].reverse()) {
    if (picked.size >= max) break
    picked.add(index)
  }
  for (let index = 0; index < steps.length && picked.size < max; index += 1) picked.add(index)
  return steps.filter((_step, index) => picked.has(index))
}
