import type { Event, Item, Thread } from "@switchback/protocol"

/**
 * 「从这里重来」时，**当前这条原生会话**在目标那一轮之前有几轮、之后要丢几轮。
 *
 * 原生分叉是从这条原生会话的末尾往前数着砍的（codex 的 `lastTurnId`、Claude 的 `resumeSessionAt`），
 * 而接力过的会话里，别家跑的轮次根本不在这条原生会话里。上一版把转录区里所有轮次都算上：
 * 换家后的第一轮上重来，必然报「源会话没有那么多轮」；A→B→A 之后在 B 那一轮上重来，
 * 会把 A 自己的上下文多砍一截——界面上看得见，引擎却不记得，而且没有任何报错。
 *
 * 每一轮是谁跑的看 `turn.started`；是哪条原生会话按分段起点对上（分段从那一家开口的那一轮
 * 开始算，见 `segment.ts`）。认不出的（journal 里没有它的 `turn.started`）照旧算在当前这条上——
 * 那是改动前的口径；只把**确知**属于别家、别的原生会话的轮次剔出去。
 */
export function nativeTurns(
  events: readonly Event[],
  thread: Thread,
  all: readonly Item[],
  keep: readonly Item[],
): { before: number; after: number } {
  const owners = new Map<string, string | undefined>()
  for (const event of events) {
    if (event.type !== "turn.started") continue
    const { id, engine, startedAt } = event.turn
    owners.set(id, engine === thread.engine ? handleAt(thread, engine, startedAt) : `engine:${engine}`)
  }
  const mine = (turnId: string): boolean => {
    const owner = owners.get(turnId)
    return owner === undefined || owner === thread.engineHandle
  }
  const kept = new Set(keep.map((item) => item.turnId))
  const turns = [...new Set(all.map((item) => item.turnId))]
  return {
    before: turns.filter((id) => kept.has(id) && mine(id)).length,
    after: turns.filter((id) => !kept.has(id) && mine(id)).length,
  }
}

/** 同一家里最后一个不晚于它开始的分段；比这家第一段还早的（抄过来的历史、旧记录）归第一段。 */
function handleAt(thread: Thread, engine: string, at: number): string | undefined {
  const own = (thread.segments ?? []).filter((segment) => segment.engine === engine)
  return (own.findLast((segment) => segment.startedAt <= at) ?? own[0])?.handle
}
