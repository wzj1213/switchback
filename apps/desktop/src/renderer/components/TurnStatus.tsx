import { useEffect, useState } from "react"
import type { Item, TaskRun, Thread, Turn } from "@omni/protocol"
import { Shimmer } from "./Shimmer.js"
import { elapsed, statusLabel } from "../status.js"
import { compact } from "../usage.js"

/** 多久之后才显示计时器。抄 dsh：**短轮次不需要秒表**，三秒的事摆个计时器只是噪声。 */
const CLOCK_AFTER_MS = 15_000
const TICK_MS = 1000

/**
 * 实时连接断了多久才说出来。多数断开一秒内就自己接上了——
 * 以前每次都弹一条横幅，一天几十次，人很快就学会了无视所有横幅，包括真出事的那条。
 */
export const RECONNECT_AFTER_MS = 3000

/** store 里记的「正在重连」：从什么时候开始、驱动怎么说的。 */
export interface Reconnecting {
  since: number
  detail?: string
}

/** 到了 `at` 这一刻才变成 true；之前不做任何重绘。 */
function useReached(at: number | undefined): boolean {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (at === undefined || Date.now() >= at) return undefined
    const timer = setTimeout(() => { setNow(Date.now()) }, at - Date.now() + 20)
    return () => { clearTimeout(timer) }
  }, [at])
  return at !== undefined && Math.max(now, Date.now()) >= at
}

/** 先睡到秒表真的会出现；出现后再对齐到整秒。前 15 秒不做无效重绘。 */
export function nextClockDelay(now: number, startedAt: number): number {
  const untilVisible = startedAt + CLOCK_AFTER_MS - now
  return untilVisible > 0 ? untilVisible + 20 : TICK_MS - (now % TICK_MS) + 20
}

function useTurnClock(startedAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt === undefined) return undefined
    let timer: ReturnType<typeof setTimeout>
    const schedule = (): void => {
      timer = setTimeout(
        () => {
          setNow(Date.now())
          schedule()
        },
        nextClockDelay(Date.now(), startedAt),
      )
    }
    schedule()
    return () => {
      clearTimeout(timer)
    }
  }, [startedAt])
  return now
}

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
  reconnecting,
}: {
  thread: Thread
  turn: Turn | undefined
  items: readonly Item[]
  /** 此刻在跑的子 agent。**每条都是引擎自己写的一句人话**，omni 不拼。 */
  tasks: readonly TaskRun[]
  /** 当前 thinking block 的近似值；频繁变化，不放进 aria-live 的播报内容。 */
  thinkingTokens: number | undefined
  /** 实时连接正断着、在自己接回来。断了超过 `RECONNECT_AFTER_MS` 才说。 */
  reconnecting?: Reconnecting | undefined
}): React.JSX.Element | null {
  const now = useTurnClock(turn?.startedAt)
  const linkDown = useReached(reconnecting === undefined ? undefined : reconnecting.since + RECONNECT_AFTER_MS)

  const label = statusLabel(thread, items)
  if (turn === undefined || label === undefined) return null
  // 计时器只在跑久了才出现：一轮三秒钟的事摆个秒表，读数还没看清就没了
  const showClock = now - turn.startedAt >= CLOCK_AFTER_MS
  return (
    <div className="turnstatus" role="status" aria-live="polite">
      <Shimmer text={label} />
      {thinkingTokens === undefined ? null : (
        <span
          className="turnstatus__tokens"
          aria-hidden="true"
          title="当前思考块的近似值，不是最终用量"
        >
          约 {compact(thinkingTokens)} tokens
        </span>
      )}
      {showClock ? <span className="turnstatus__clock">{elapsed(turn.startedAt, now)}</span> : null}
      {/* 连接断了**不是故障**：人什么都不用做，所以只在这一行里安静地说一句，接上就消失。
          真接不回来时驱动会另报一次崩溃，那才弹横幅 */}
      {linkDown ? (
        <span className="turnstatus__link" title={reconnecting?.detail}>
          连接断了，正在接回…
        </span>
      ) : null}
      {/*
       * 子 agent 各占一行。**这一段只在引擎真报了的时候才存在**——
       * 一个没有子 agent 的轮次不该多出一块空的「任务」区。
       * 每条显示的都是引擎自己写的那句 `description`（实测 claude：「Reading b.txt」），
       * omni 既不翻译也不从工具名拼一句顶替。
       */}
      {tasks.map((task) => (
        <span key={task.id} className="turnstatus__task">
          {task.description}
          {task.lastTool === undefined ? null : (
            <span className="turnstatus__tool">{task.lastTool}</span>
          )}
        </span>
      ))}
    </div>
  )
}
