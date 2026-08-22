import type { Item, Thread } from "@omni/protocol"
import { canonicalPath } from "./path.js"

/**
 * 一次会话的确定性运行摘要。类型名 `Handoff` 为兼容既有调用保留；
 * 当前用于分叉对比，不会被渲染或发送给任何引擎。
 *
 * **不传原始上下文。** 各家的 session 格式互不相通，硬翻一遍既做不对也维护不起；
 * 更重要的是，原始上下文里绝大部分是过程噪声（试错、被拒的调用、读了一半的文件），
 * 换一家从头看反而更慢。
 *
 * 摘要只压缩已有事件，不能冒充 Git 净差异；文件数字只保留编辑工具最后一次成功上报。
 */
export interface Handoff {
  /** 第一条用户消息。整件事的由来。 */
  goal: string
  /** 后续用户消息：中途追加的要求与纠正。 */
  asks: readonly string[]
  /** 动过的文件与增删行数。 */
  changed: readonly { path: string; added: number; removed: number }[]
  /** 成功跑过的命令，去重。 */
  commands: readonly string[]
  /** 人工裁决过的事。 */
  decisions: readonly { summary: string; allowed: boolean }[]
  /** 还没做完的计划项。 */
  open: readonly string[]
  /** 上一家最后说的话。 */
  last: string | undefined
}

const MAX_ASKS = 8
const MAX_COMMANDS = 12

/** 命令去重后保留最近的若干条：跑过二十遍 `pnpm test` 只需要说一次。 */
function commandsOf(items: readonly Item[]): readonly string[] {
  const seen = new Set<string>()
  for (const item of items) {
    if (item.inherited === true || item.kind !== "tool_call" || item.detail.kind !== "shell") continue
    if (item.status !== "ok") continue
    seen.add(item.detail.command)
  }
  return [...seen].slice(-MAX_COMMANDS)
}

/** 非 Git 降级只留最后一次成功上报；累加多轮数字会制造一份不存在的“净改动”。 */
function changedOf(items: readonly Item[], cwd: string): readonly { path: string; added: number; removed: number }[] {
  const latest = new Map<string, { path: string; added: number; removed: number }>()
  for (const item of items) {
    if (item.inherited === true || item.kind !== "tool_call" || item.detail.kind !== "file_edit") continue
    if (item.status !== "ok") continue
    for (const file of item.detail.files) {
      const path = canonicalPath(file.path, cwd)
      if (path !== "") latest.set(path, { path, added: file.added, removed: file.removed })
    }
  }
  return [...latest.values()]
}

/**
 * 只取**最后一份**计划里没做完的项。
 *
 * 计划是会被整份替换的：取全部历史计划的并集，会把早就删掉的条目重新翻出来，
 * 让接手的一家去做一件已经被否决的事。
 */
function openOf(items: readonly Item[]): readonly string[] {
  const plans = items.flatMap((i) => (i.kind === "plan" ? [i.steps] : []))
  const last = plans[plans.length - 1]
  if (last === undefined) return []
  return last.filter((s) => s.status !== "done" && s.status !== "dropped").map((s) => s.text)
}

export function buildHandoff(thread: Thread, items: readonly Item[]): Handoff {
  // 原生分叉会把共同前缀抄进子会话供人阅读；运行摘要只描述这一边后来做的事。
  // 只在文件/命令处排除会让旧计划、旧审批和旧结论继续冒充子分支产物。
  const own = items.filter((item) => item.inherited !== true)
  // 用 flatMap 而不是 filter().map()：filter 的类型谓词不会把联合窄下来，
  // 后面就得靠断言，而断言在这种「按 kind 取字段」的地方最容易写错
  const users = own.flatMap((i) => (i.kind === "user_message" ? [i.text] : []))
  const messages = own.flatMap((i) => (i.kind === "agent_message" ? [i.text] : []))
  const decisions = own.flatMap((i) =>
    i.kind === "approval" && i.status !== "pending"
      ? [{ summary: i.summary, allowed: i.status === "allowed" }]
      : [],
  )
  return {
    goal: users[0] ?? thread.title,
    asks: users.slice(1).slice(-MAX_ASKS),
    changed: changedOf(own, thread.cwd),
    commands: commandsOf(own),
    decisions,
    open: openOf(own),
    last: messages[messages.length - 1],
  }
}
