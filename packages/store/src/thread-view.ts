import type { Thread } from "@switchback/protocol"

/**
 * 没换家、原来那家又没留下句柄：宿主接不回来（规矩在 `@switchback/host` 的 `revive.ts`）。
 *
 * 例外：记录里有别家的分段、却没有这一家的——它是换过来还没开口就停了（Claude 要等开轮之后
 * 才报句柄），没有上下文可冒充，宿主会新起一条，不拦。这里只看得到分段；
 * 它其实跑过轮次的少见情形由宿主拒绝。
 *
 * 桌面端的输入框和手机端的「接回来」都按这一条判，两端不分岔。
 */
export function cannotRevive(thread: Thread): boolean {
  const to = thread.nextEngine ?? thread.engine
  if (thread.detached !== true || to !== thread.engine || thread.engineHandle !== undefined) return false
  const segments = thread.segments ?? []
  return segments.length === 0 || segments.some((segment) => segment.engine === to)
}

/**
 * 侧栏、列表上给这条会话画什么状态。
 *
 * 主轮之外的权限请求（`Thread.pendingApprovals`）不改会话状态——`waiting_approval` 在界面上
 * 等于「这一轮还在跑」，而那时并没有轮次——可列表上它确实在等你，照「待批」画，人才看得见。
 * 正在跑的照旧画「在跑」：那时转录区里有动静，点进去自然看到上方那张卡。
 */
export function displayStatus(thread: Thread): Thread["status"] {
  if ((thread.pendingApprovals?.length ?? 0) === 0 || thread.status === "running") return thread.status
  return "waiting_approval"
}
