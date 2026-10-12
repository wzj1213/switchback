import type { Event, ThreadId } from "@switchback/protocol"
import { received, replayed, reset, resynced, type Replay, type Sealed, type ServerFrame, type Stream } from "@switchback/wire"
import type { Bodies } from "./bodies.js"

/**
 * 远程窗口收到一帧之后做什么（`connection.ts` 的另一半，行数闸门逼着拆的）。
 *
 * 顺序有讲究：**先推影子游标，再交给渲染层**——确认与重连带的游标都从影子里取，
 * 它和渲染层喂的是同一组纯函数、同样的帧，两边算出来是同一个数。
 */

export interface History {
  threadId: ThreadId
  events: readonly Event[]
  trimmed: boolean
}

export type Answer = { events: readonly Sealed[] } | { reset: true }

/** 一组监听。返回退订函数，和 preload 那几个 `on*` 同一个约定。 */
export function hub<T>(): { add: (listener: (value: T) => void) => () => void; emit: (value: T) => void } {
  const listeners = new Set<(value: T) => void>()
  return {
    add: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit: (value) => {
      for (const listener of listeners) listener(value)
    },
  }
}

export interface FrameCtx {
  refs: { shadow: Stream }
  hubs: {
    events: { emit: (sealed: readonly Sealed[]) => void }
    replay: { emit: (replay: Replay) => void }
    history: { emit: (history: History) => void }
    notice: { emit: (text: string) => void }
  }
  bodies: Bodies
  calls: { settle: (frame: Extract<ServerFrame, { type: "result" }>) => void }
  scheduleAck: () => void
  answerResync: (answer: Answer) => boolean
  /** 不带游标再握一次手：要一份新全量。 */
  rehello: () => void
}

/** 一帧进来：先推影子游标（确认与重连都靠它），再交给渲染层。 */
export function handleFrame(frame: ServerFrame, ctx: FrameCtx): void {
  switch (frame.type) {
    case "replay":
      ctx.refs.shadow = replayed({ ...ctx.refs.shadow, lastSeq: undefined }, frame.replay).stream
      ctx.bodies.replayed(frame.replay)
      ctx.hubs.replay.emit(frame.replay)
      // 一份新全量之后，渲染层手上的状态是从零建起来的——还在等的补发已经没有意义
      ctx.answerResync({ events: [] })
      ctx.scheduleAck()
      return
    case "events":
      ctx.refs.shadow = received(ctx.refs.shadow, frame.sealed).stream
      ctx.bodies.saw(frame.sealed)
      ctx.hubs.events.emit(frame.sealed)
      ctx.scheduleAck()
      return
    case "catchup":
      ctx.refs.shadow = resynced(ctx.refs.shadow, frame.sealed).stream
      ctx.bodies.saw(frame.sealed)
      ctx.answerResync({ events: frame.sealed })
      ctx.scheduleAck()
      return
    case "reset":
      ctx.refs.shadow = reset()
      ctx.hubs.notice.emit(frame.reason)
      // 在等补发的那位（渲染层）收到 reset 会自己重载页面、重新要全量；
      // 没人在等的（比如全量太大被宿主拒了）就由这里重新要——不然界面停在旧状态上，什么都不说
      if (!ctx.answerResync({ reset: true })) ctx.rehello()
      return
    case "thread":
      ctx.bodies.loaded(frame.threadId, frame.trimmed === true)
      ctx.hubs.history.emit({ threadId: frame.threadId, events: frame.events, trimmed: frame.trimmed === true })
      return
    case "notice":
      ctx.hubs.notice.emit(frame.returned === undefined ? frame.text : `${frame.text}\n没发出去的那句：${frame.returned.text}`)
      return
    case "result":
      ctx.calls.settle(frame)
      return
    default:
      return
  }
}
