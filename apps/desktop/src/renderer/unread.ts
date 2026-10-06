import type { ThreadStatus } from "@switchback/protocol"

/**
 * 「它在你没看的时候跑完了」。
 *
 * ## 为什么非有不可
 *
 * 这个应用的用法就是交代一件事然后切走。切回来的时候，侧栏里跑完的那条
 * 和上周那条**长得一模一样**：一颗灰点、一句「3 分钟前」。
 * 系统通知只在窗口不在前台时弹（见 `main/attention.ts`），而最常见的情形恰恰是
 * **窗口就在前台、你看的是另一条会话**——那时候一点痕迹都没有，
 * 那条注释里管这个叫「一个已知的洞」。这里补的就是它。
 *
 * ## 判据只有一条：跑着 → 空闲，而你当时没在看
 *
 * - **失败不算**：那一行已经写着红色的「失败」，再叠一层「有新东西」是重复。
 * - **启动中 → 空闲不算**：引擎起好了而已，什么都没发生。
 * - **你正看着的那条永远不算**：它就在你眼前跑完的。这一条也顺手把
 *   「自己按停」挡掉了——停止键只在当前会话上（和 `attention.ts` 的
 *   「自己按停的不出声」同一个理由）。
 *
 * 状态取自 `Thread.status`，那是宿主的判定（见 `host/ctx.ts` 的 `setStatus`）。
 * **不另立一套判据**：Switchback 里「它在不在跑」只能有一个答案。
 */
export interface UnreadStep {
  /** 上一帧每条会话的状态。第一帧是空的，所以冷启动不会凭空点亮一片。 */
  was: ReadonlyMap<string, ThreadStatus>
  /** 这一帧的会话。**只认这份里的 id**——删掉的会话顺带被扫出未读集合。 */
  now: readonly { id: string; status: ThreadStatus }[]
  /** 现在看着的是哪一条。 */
  selected: string | undefined
  /** 上一帧的未读集合。 */
  unread: ReadonlySet<string>
}

export interface UnreadNext {
  /**
   * 新的未读集合。**没变化时返回传进来的那一个**——调用方拿它当 state，
   * 每帧换一个新引用就是一个 setState 死循环。
   */
  unread: ReadonlySet<string>
  was: ReadonlyMap<string, ThreadStatus>
}

/** 这一帧算不算「刚跑完」。审批也算跑着——它是停下来等人，不是没事干。 */
function justFinished(before: ThreadStatus | undefined, status: ThreadStatus): boolean {
  return status === "idle" && (before === "running" || before === "waiting_approval")
}

export function stepUnread(step: UnreadStep): UnreadNext {
  const next = new Set<string>()
  for (const row of step.now) {
    // 打开就算看过。放在最前面：正在看的那条无论怎么变都不该点亮
    if (row.id === step.selected) continue
    if (justFinished(step.was.get(row.id), row.status) || step.unread.has(row.id)) next.add(row.id)
  }
  const same = next.size === step.unread.size && [...next].every((id) => step.unread.has(id))
  return {
    unread: same ? step.unread : next,
    was: new Map(step.now.map((row) => [row.id, row.status])),
  }
}
