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
