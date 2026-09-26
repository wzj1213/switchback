import type { Item, Thread } from "@omni/protocol"
import { runningToolLabel } from "./tool.js"
import { headingOf } from "./reasoning.js"

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
    if (item === undefined) continue
    // **正在往外写的那段回答**：上一版越过它去找前面的推理，于是模型明明在写答案和代码，
    // 状态行还挂着「正在思考」。写完了的回答不算——那之后它在干别的（想下一步、调工具）
    if (item.kind === "agent_message") {
      if (!item.complete) return "正在回答"
      continue
    }
    // **最后一条推理里模型自己给这一段起的小标题**，比「正在思考」有信息量得多。
    // 放在工具之前判断是因为它就在工具的上一条——模型先说「我要去看看 X」，
    // 再去调工具；调用一结束又接着说下一段
    if (item.kind === "reasoning") {
      const heading = headingOf(item.text)
      if (heading !== undefined) return heading
      break
    }
    if (item.kind !== "tool_call") continue
    if (item.status !== "running" && item.status !== "pending") break
    return runningToolLabel(item)
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

/**
 * 「多久以前」。侧栏会话行右边那一列。
 *
 * ## 为什么侧栏需要它
 *
 * 会话标题彼此都长得差不多（「omni」「接着上面…」「修一下那个 bug」），
 * 一列排下来**唯一能把它们区分开的是新旧**——而这件事 `Thread.updatedAt`
 * 一直握在手里，从来没显示过。那一格今天是空的。
 *
 * ## 为什么这几档
 *
 * 越近越要精确，越远越不需要：十分钟前和十二分钟前是两回事，
 * 三十天前和三十二天前不是。所以一小时内报分钟、一天内报小时，
 * 再往前只报天，超过一周直接报日期——那时你找的是「哪一天那条」。
 *
 * 「昨天」单独一档：它比「1 天前」好读，而且这是人回忆时真正用的词。
 */
export function sinceOf(at: number, now: number): string {
  const ms = now - at
  // 时钟回拨、或者引擎报了一个未来的时间戳：不显示负数，当成刚刚
  if (ms < MINUTE) return "现在"
  if (ms < HOUR) return `${String(Math.floor(ms / MINUTE))} 分钟前`
  if (ms < DAY) return `${String(Math.floor(ms / HOUR))} 小时前`
  if (ms < DAY * 2) return "昨天"
  if (ms < DAY * 7) return `${String(Math.floor(ms / DAY))} 天前`
  const day = new Date(at)
  return `${String(day.getMonth() + 1)} 月 ${String(day.getDate())} 日`
}

const MINUTE = 60_000
const HOUR = MINUTE * 60
const DAY = HOUR * 24

/** 经过的秒数，向下取整。计时器只显示秒，不显示毫秒——抖动没有信息量。 */
export function elapsed(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes === 0 ? `${String(seconds)}s` : `${String(minutes)}m ${String(seconds)}s`
}
