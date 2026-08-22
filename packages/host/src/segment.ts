import { emit, isCurrent, type Ctx, type Live } from "./ctx.js"

interface SegmentRef {
  engine: string
  handle: string
}

/**
 * 先把续跑所需的身份同步落下；`logPath` 只是之后补充的展示信息，不能反过来
 * 卡住 handle。否则 A → B → A 切得比一次磁盘/RPC 查询快，就会把 A 当成新会话。
 */
function rememberSegment(ctx: Ctx, entry: Live): SegmentRef | undefined {
  const handle = entry.thread.engineHandle
  if (handle === undefined || !isCurrent(ctx, entry)) return undefined
  const engine = entry.thread.engine
  const had = entry.thread.segments ?? []
  if (had.some((seg) => seg.engine === engine && seg.handle === handle)) {
    return { engine, handle }
  }
  const at = ctx.deps.now()
  entry.thread = {
    ...entry.thread,
    segments: [...had, { engine, handle, startedAt: at }],
    updatedAt: at,
  }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
  return { engine, handle }
}

/** 当前段先出现，原始记录路径异步查到后只补这一项。 */
export async function recordSegment(ctx: Ctx, entry: Live): Promise<void> {
  const ref = rememberSegment(ctx, entry)
  if (ref === undefined) return
  const path = await entry.session.logPath?.().catch(() => undefined)
  if (path === undefined) return
  const live = ctx.live.get(entry.thread.id)
  const had = live?.thread.segments ?? []
  const mine = had.find((seg) => seg.engine === ref.engine && seg.handle === ref.handle)
  if (live === undefined || mine === undefined || mine.logPath === path) return
  const at = ctx.deps.now()
  live.thread = {
    ...live.thread,
    segments: had.map((seg) => (seg === mine ? { ...seg, logPath: path } : seg)),
    updatedAt: at,
  }
  emit(ctx, { type: "thread.updated", at, thread: live.thread })
}
