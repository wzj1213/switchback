import type { EngineSegment, Thread } from "@switchback/protocol"

/*
 * 「换到另一家之后这条会话长什么样」。接力（`branch.ts` 的 `switchEngine`）和
 * 把历史会话接回另一家（`revive.ts`）共用这一份，两边对「换家」的定义不能各写一套。
 */

/** 这条会话在 `engine` 那一家最近的一段——切回去要续的就是它。 */
export function latestSegment(thread: Thread, engine: string): EngineSegment | undefined {
  const segments = thread.segments ?? []
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (segment?.engine === engine) return segment
  }
  return undefined
}

/**
 * 换过引擎之后这条会话长什么样。
 *
 * **模型和强度清掉**：它们跟着引擎走，上一家的模型 id 在新的一家那里
 * 通常根本不存在。清单同理——渲染层认「这份是谁报的」（见 store 的 `modelsOf`），
 * 新那家报上来之前，选择器上什么都不摆。
 */
export function switched(
  prev: Thread,
  to: string,
  back: EngineSegment | undefined,
  transition: { at: number; status: Thread["status"] },
): Thread {
  const next: Thread = {
    ...prev,
    engine: to,
    // 临时会话在旧那家**什么都没发生过**，历史里不该留一笔——
    // 点开下拉挑了三次就记三条的话，`/timeline` 会被「我点错了」填满
    engineHistory: prev.provisional === true ? [to] : [...prev.engineHistory, to],
    ...(back === undefined ? { engineHandle: undefined } : { engineHandle: back.handle }),
    ...(back === undefined ? { engineProfile: undefined } : { engineProfile: back.profile }),
    model: undefined,
    effort: undefined,
    status: transition.status,
    updatedAt: transition.at,
  }
  delete next.nextEngine
  // 上一家挂着的问题已经按跳过落定（`gate.settleAll`），新那家背后没有人在等这些答案：
  // 带过来就成了答不掉、关不掉、还挡着回收与防休眠的死卡
  delete next.pendingQuestions
  // 这四份都由当前引擎握手/回调重建。沿用上一家的值会在新状态到达前撒谎，
  // 更糟的是 `rememberEngineState` 会合并轴，最终把两家状态拼成一份不存在的状态。
  delete next.engineState
  delete next.goal
  delete next.trustApply
  delete next.capabilities
  return next
}

/** 换了原生进程（改档重启、回滚）之后的会话：旧进程挂着的问题已经落定，不再带着。 */
export function withoutPending(thread: Thread): Thread {
  const next = { ...thread }
  delete next.pendingQuestions
  return next
}
