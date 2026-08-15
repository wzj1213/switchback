import type { Item, Thread } from "@omni/protocol"
import { VERB, brief } from "./tool.js"

/**
 * 运行态说什么。
 *
 * **不要只写「加载中」。** 一个转圈只告诉人「还没好」，
 * 而这里能说得出「在跑哪条命令」——同样一秒钟的等待，知道它在干什么就不焦虑。
 * codex 的界面把每个加载态都起了名字（正在加载项目…、正在加载差异…），
 * 这条是同一个道理。
 */
export function statusLabel(thread: Thread, items: readonly Item[]): string | undefined {
  if (thread.status === "waiting_approval") return "等待批准"
  if (thread.status !== "running") return undefined
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (item?.kind !== "tool_call") continue
    if (item.status !== "running" && item.status !== "pending") break
    return `${VERB[item.detail.kind]} ${brief(item.detail)}`
  }
  return "正在思考"
}

/** 经过的秒数，向下取整。计时器只显示秒，不显示毫秒——抖动没有信息量。 */
export function elapsed(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes === 0 ? `${String(seconds)}s` : `${String(minutes)}m ${String(seconds)}s`
}
