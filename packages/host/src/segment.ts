import { emit, isCurrent, type Ctx, type Live } from "./ctx.js"

interface SegmentRef {
  engine: string
  profile?: string
  handle: string
}

/**
 * 先把续跑所需的身份同步落下；`logPath` 只是之后补充的展示信息，不能反过来
 * 卡住 handle。否则 A → B → A 切得比一次磁盘/RPC 查询快，就会把 A 当成新会话。
 */
function rememberSegment(ctx: Ctx, entry: Live, since: number | undefined): SegmentRef | undefined {
  const handle = entry.thread.engineHandle
  if (handle === undefined || !isCurrent(ctx, entry)) return undefined
  const engine = entry.thread.engine
  const profile = entry.thread.engineProfile
  const had = entry.thread.segments ?? []
  /**
   * **只和「最后一段」比，不和全部比。**
   *
   * 上一版是 `had.some(...)`：只要这条会话在任何时候跑过这家引擎，就不再记第二段。
   * 于是 A → B → A 在记录上只有两段，第三段（切回 A）**一点痕迹都没有**——
   * 而那恰好是最需要痕迹的一刻：转录区要在那儿画一条「切换至 A」，
   * 左缘导航要知道后面这几问归谁跑，「中途换过引擎」也要数对次数。
   *
   * 换成和最后一段比之后：同一家连着跑多少轮仍然只记一段（`recordSegment`
   * 每轮都调用，第二轮起 last 就等于自己），而换出去再换回来会各记一段。
   * 句柄照旧是同一个（切回去续的就是那条原生 session，见 `branch.ts`
   * 的 `latestSegment`），所以「续跑身份」这件事一点没变，变的只是**时间线更全**。
   */
  const last = had[had.length - 1]
  if (last?.engine === engine && last.profile === profile && last.handle === handle) {
    return { engine, ...(profile === undefined ? {} : { profile }), handle }
  }
  if (since === undefined) return undefined
  const at = ctx.deps.now()
  entry.thread = {
    ...entry.thread,
    segments: [...had, { engine, ...(profile === undefined ? {} : { profile }), handle, startedAt: since }],
    updatedAt: at,
  }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
  return { engine, ...(profile === undefined ? {} : { profile }), handle }
}

/**
 * 当前段先出现，原始记录路径异步查到后只补这一项。
 *
 * `since` 是这一段从哪一刻算起——**这一家开口的那一轮开始的时刻**，不是记下它的这一刻：
 * 分段要等引擎收下那句才记，可界面按时间把转录内容对到「谁跑的」，晚一点就会把换家后的
 * 第一句算到前一家头上。不给 `since` 时只补已经记下的那一段，不新记：引擎还没收下过
 * 这一家的任何一句时，时间线上不该出现它，交接说明也就还没「附过」（见 `handoff-note.ts`）。
 */
export async function recordSegment(ctx: Ctx, entry: Live, since?: number): Promise<void> {
  const ref = rememberSegment(ctx, entry, since)
  if (ref === undefined) return
  const path = await entry.session.logPath?.().catch(() => undefined)
  if (path === undefined) return
  const live = ctx.live.get(entry.thread.id)
  const had = live?.thread.segments ?? []
  // **补最后那一段**：同一家可能出现好几段（切出去又切回来），
  // 而这次异步查到的路径属于此刻正在跑的那一段，不是三十轮之前的同名段
  const mine = had.findLast(
    (seg) => seg.engine === ref.engine && seg.profile === ref.profile && seg.handle === ref.handle,
  )
  if (live === undefined || mine === undefined || mine.logPath === path) return
  const at = ctx.deps.now()
  live.thread = {
    ...live.thread,
    segments: had.map((seg) => (seg === mine ? { ...seg, logPath: path } : seg)),
    updatedAt: at,
  }
  emit(ctx, { type: "thread.updated", at, thread: live.thread })
}
