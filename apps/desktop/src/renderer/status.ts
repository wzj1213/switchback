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

/**
 * 一段时长的人话说法。给分界线用。
 *
 * 和 `elapsed` 分开：那个是**跑着的时候**的计时器，越短越好（`13s`），
 * 一秒一跳、要等宽数字防抖；这个是**跑完之后**的总结，是给人读的一句话
 * （`2 分 11 秒`），不会再变，所以可以从容一点。
 */
export function spent(ms: number): string {
  const total = Math.floor(ms / 1000)
  if (total < 60) return `${String(total)} 秒`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return seconds === 0 ? `${String(minutes)} 分` : `${String(minutes)} 分 ${String(seconds)} 秒`
}

/** 经过的秒数，向下取整。计时器只显示秒，不显示毫秒——抖动没有信息量。 */
export function elapsed(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes === 0 ? `${String(seconds)}s` : `${String(minutes)}m ${String(seconds)}s`
}
