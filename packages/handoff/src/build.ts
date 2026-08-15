import type { Item, Thread } from "@omni/protocol"

/**
 * 跨引擎接力的交接包。
 *
 * **不传原始上下文。** 各家的 session 格式互不相通，硬翻一遍既做不对也维护不起；
 * 更重要的是，原始上下文里绝大部分是过程噪声（试错、被拒的调用、读了一半的文件），
 * 换一家从头看反而更慢。
 *
 * 交接包传的是**结论**：目标是什么、动过哪些文件、做过哪些决定、还剩什么没做。
 * 这也是人交接工作的方式——不会把自己三天的浏览记录发给同事。
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
  /** 人工裁决过的事——**换一家之后不该重问一遍**。 */
  decisions: readonly { summary: string; allowed: boolean }[]
  /** 还没做完的计划项。 */
  open: readonly string[]
  /** 上一家最后说的话。 */
  last: string | undefined
}

const MAX_ASKS = 8
const MAX_COMMANDS = 12
const MAX_CHANGED = 30

/** 命令去重后保留最近的若干条：跑过二十遍 `pnpm test` 只需要说一次。 */
function commandsOf(items: readonly Item[]): readonly string[] {
  const seen = new Set<string>()
  for (const item of items) {
    if (item.kind !== "tool_call" || item.detail.kind !== "shell") continue
    if (item.status !== "ok") continue
    seen.add(item.detail.command)
  }
  return [...seen].slice(-MAX_COMMANDS)
}

/** 同一个文件被改过多次时合并计数——交接的是「这个文件动了多少」，不是流水账。 */
function changedOf(items: readonly Item[]): readonly { path: string; added: number; removed: number }[] {
  const tally = new Map<string, { path: string; added: number; removed: number }>()
  for (const item of items) {
    if (item.kind !== "tool_call" || item.detail.kind !== "file_edit") continue
    for (const file of item.detail.files) {
      const prev = tally.get(file.path) ?? { path: file.path, added: 0, removed: 0 }
      tally.set(file.path, {
        path: file.path,
        added: prev.added + file.added,
        removed: prev.removed + file.removed,
      })
    }
  }
  return [...tally.values()].slice(0, MAX_CHANGED)
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
  // 用 flatMap 而不是 filter().map()：filter 的类型谓词不会把联合窄下来，
  // 后面就得靠断言，而断言在这种「按 kind 取字段」的地方最容易写错
  const users = items.flatMap((i) => (i.kind === "user_message" ? [i.text] : []))
  const messages = items.flatMap((i) => (i.kind === "agent_message" ? [i.text] : []))
  const decisions = items.flatMap((i) =>
    i.kind === "approval" && i.status !== "pending"
      ? [{ summary: i.summary, allowed: i.status === "allowed" }]
      : [],
  )
  return {
    goal: users[0] ?? thread.title,
    asks: users.slice(1).slice(-MAX_ASKS),
    changed: changedOf(items),
    commands: commandsOf(items),
    decisions,
    open: openOf(items),
    last: messages[messages.length - 1],
  }
}
