import type { ErrorItem, Item } from "@switchback/protocol"

/**
 * 可恢复报错（`fatal: false`）在转录区里的三种样子。
 *
 * - `live`：这一轮还在跑，而它是这一轮最新的动静——引擎此刻正在重试，原因照常摆出来。
 * - `past`：后面已经有了别的动静，或者这一轮已经收工。它只剩「当时出过这么一下」的意义，
 *   收成一行淡字，原因折进「详情」。
 * - `absorbed`：同一轮后面跟着一条终态报错。它们说的是同一件事的前半段（重连 5/5 → 放弃），
 *   分开摆就是同一句话灰一遍、红一遍——并进那张卡里。
 *
 * **只看位置，不看措辞**：哪条是重试、哪条是别的可恢复报错，Switchback 分不清也不去猜。
 */
export type SoftState = "live" | "past" | "absorbed"

export interface ErrorPlan {
  soft: ReadonlyMap<string, SoftState>
  /** 每张终态报错卡并进来的那几条可恢复报错，按出现顺序。 */
  prior: ReadonlyMap<string, readonly ErrorItem[]>
}

const isError = (item: Item): item is ErrorItem => item.kind === "error"

/** 每一轮最新一条动静的时刻。codex 的重试条原地更新、`at` 跟着变，所以不能只看数组位置。 */
function newestAt(items: readonly Item[]): Map<string, number> {
  const newest = new Map<string, number>()
  for (const item of items) newest.set(item.turnId, Math.max(newest.get(item.turnId) ?? 0, item.at))
  return newest
}

export function planErrors(items: readonly Item[], runningTurnId: string | undefined): ErrorPlan {
  const soft = new Map<string, SoftState>()
  const prior = new Map<string, readonly ErrorItem[]>()
  const pending = new Map<string, ErrorItem[]>()
  for (const item of items) {
    if (!isError(item)) continue
    const waiting = pending.get(item.turnId) ?? []
    if (!item.fatal) {
      pending.set(item.turnId, [...waiting, item])
      continue
    }
    if (waiting.length === 0) continue
    prior.set(item.id, waiting)
    for (const one of waiting) soft.set(one.id, "absorbed")
    pending.set(item.turnId, [])
  }
  const newest = newestAt(items)
  for (const [turnId, waiting] of pending) {
    for (const one of waiting) {
      const live = turnId === runningTurnId && one.at >= (newest.get(turnId) ?? 0)
      soft.set(one.id, live ? "live" : "past")
    }
  }
  return { soft, prior }
}

/** 「再试一次」要重发的那一句：最后一轮是失败收场，而那一轮是你自己发的一句话。 */
export interface RetryTarget {
  /** 挂按钮的那张终态报错卡。 */
  errorId: string
  text: string
  attachments?: readonly string[]
}

/** 这一轮你自己说的那句话。接力带过来的、定时触发的都不算——重发它们没有意义。 */
function mineIn(turn: readonly Item[]): { text: string; attachments: readonly string[] } | undefined {
  const asked = turn.find((item) => item.kind === "user_message")
  if (asked?.kind !== "user_message" || asked.origin !== undefined) return undefined
  const attachments = asked.attachments ?? []
  return asked.text.trim() === "" && attachments.length === 0 ? undefined : { text: asked.text, attachments }
}

export function retryTarget(items: readonly Item[]): RetryTarget | undefined {
  const turnId = items[items.length - 1]?.turnId
  if (turnId === undefined) return undefined
  const turn = items.filter((item) => item.turnId === turnId)
  const failed = turn.filter(isError).filter((item) => item.fatal).at(-1)
  const mine = mineIn(turn)
  if (failed === undefined || mine === undefined) return undefined
  return { errorId: failed.id, text: mine.text, ...(mine.attachments.length === 0 ? {} : { attachments: mine.attachments }) }
}
