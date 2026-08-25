import { useEffect, useState } from "react"
import type { Item, TaskRun, Thread, Turn } from "@omni/protocol"
import { Shimmer } from "./Shimmer.js"
import { elapsed, statusLabel } from "../status.js"
import { compact } from "../usage.js"

/** 计时器只需秒级精度，1s 一跳。 */
const TICK_MS = 1000

/** 多久之后才显示计时器。抄 dsh：**短轮次不需要秒表**，三秒的事摆个计时器只是噪声。 */
const CLOCK_AFTER_MS = 15_000

/**
 * 一轮跑起来之后，对话流**末尾**的那行状态。
 *
 * ## 它必须在对话流里面
 *
 * 上一版把它挪到了滚动区外面、钉在输入框上方——理由写的是「逃生口不该跟着
 * 内容滚走」。那句话本身没错，错在**把两件事绑在了一起**：
 *
 * - 「它在想什么」是**对话内容**，就该长在对话末尾。钉在底部之后，
 *   它离最后一条消息十万八千里，读起来像个和对话无关的状态栏。
 * - 「停下来」是**逃生口**，那个才需要常驻——而它现在在输入区里（`Composer` 的
 *   「停止」），本来就不会滚走。
 *
 * dsh 的 `ChatView` 正是这么分的：`{running && <TurnStatus/>}` 是节点列表的
 * 最后一个孩子，跟着内容滚；另有一个只在「没贴底」时出现的「回到底部」按钮
 * 负责把人送回去。
 */
export function TurnStatus({
  thread,
  turn,
  items,
  tasks,
  thinkingTokens,
}: {
  thread: Thread
  turn: Turn | undefined
  items: readonly Item[]
  /** 此刻在跑的子 agent。**每条都是引擎自己写的一句人话**，omni 不拼。 */
  tasks: readonly TaskRun[]
  /** 当前 thinking block 的近似值；频繁变化，不放进 aria-live 的播报内容。 */
  thinkingTokens: number | undefined
}): React.JSX.Element | null {
  const [now, setNow] = useState(() => Date.now())
  const running = turn !== undefined

  useEffect(() => {
    if (!running) return undefined
    const id = setInterval(() => {
      setNow(Date.now())
    }, TICK_MS)
    return () => {
      clearInterval(id)
    }
  }, [running])

  const label = statusLabel(thread, items)
  if (turn === undefined || label === undefined) return null
  // 计时器只在跑久了才出现：一轮三秒钟的事摆个秒表，读数还没看清就没了
  const showClock = now - turn.startedAt >= CLOCK_AFTER_MS
  return (
    <div className="turnstatus" role="status" aria-live="polite">
      <Shimmer text={label} />
      {thinkingTokens === undefined ? null : (
        <span className="turnstatus__tokens" aria-hidden="true" title="当前思考块的近似值，不是最终用量">
          约 {compact(thinkingTokens)} tokens
        </span>
      )}
      {showClock ? <span className="turnstatus__clock">{elapsed(turn.startedAt, now)}</span> : null}
      {/*
       * 子 agent 各占一行。**这一段只在引擎真报了的时候才存在**——
       * 一个没有子 agent 的轮次不该多出一块空的「任务」区。
       * 每条显示的都是引擎自己写的那句 `description`（实测 claude：「Reading b.txt」），
       * omni 既不翻译也不从工具名拼一句顶替。
       */}
      {tasks.map((task) => (
        <span key={task.id} className="turnstatus__task">
          {task.description}
          {task.lastTool === undefined ? null : <span className="turnstatus__tool">{task.lastTool}</span>}
        </span>
      ))}
    </div>
  )
}
