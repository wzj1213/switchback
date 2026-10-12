import type { CallResult, ClientFrame } from "@switchback/wire"

/**
 * 客户端这一侧的 `call` → `result`（远程模式，见 `docs/远程模式方案.md` §3）。
 *
 * 只做三件事：**编号、等回话、到点了结**。线上怎么发由 `send` 给，计时器由调用方给——
 * 这样「断线时在途的怎么办」这类最容易写错的分支能用假时钟穷举。
 *
 * ## 没连上时：排着，不立刻失败
 *
 * 界面一打开就要问设置、问分支，而那一刻 WebSocket 多半还在握手。立刻失败的话，
 * 每次打开页面都是一屏「读不出来」。所以没连上的先排着，连上就发；**等待也算在超时里**——
 * 一直连不上的话它们照样会按时失败，而不是永远挂着。
 *
 * ## 断线时：已经发出去的一律失败，不重发
 *
 * 回话不会再来了（宿主那头的连接已经没了）。**也不重发**：调用里有提交、暂存这种写，
 * 重发一次就可能提交两次，而客户端分不出上一次到底做没做完。让人看见「没做完」再点一次，
 * 比替他悄悄多做一次安全。
 */

/** 一条调用最多等多久（含排队）。扫一遍活动要读几十 MB journal，给宽一点。 */
const DEFAULT_TIMEOUT_MS = 45_000

export interface CallsDeps {
  /** 发一帧。没连上返回 false。 */
  send: (frame: ClientFrame) => boolean
  setTimer: (run: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

export interface Calls {
  /** 调一条宿主通道，等它的回话。被拒、出错、超时都以 `Error` 了结，消息就是给人看的那句话。 */
  call: (method: string, arg?: unknown, timeoutMs?: number) => Promise<unknown>
  /** 连上了：把排着的发出去。 */
  opened: () => void
  /** 收到一条回话。 */
  settle: (frame: CallResult) => void
  /** 断了：已经发出去的全部失败，排着的接着排。 */
  dropped: (reason: string) => void
  /** 不会再连了（令牌被吊销、页面要走）：全部失败。 */
  close: (reason: string) => void
  /** 还没了结的条数。给界面判「是不是还在忙」，也给测试。 */
  size: () => number
}

interface Pending {
  frame: Extract<ClientFrame, { type: "call" }>
  sent: boolean
  timer: unknown
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export function createCalls(deps: CallsDeps): Calls {
  const state = { next: 0, pending: new Map<number, Pending>() }

  const finish = (id: number): Pending | undefined => {
    const one = state.pending.get(id)
    if (one === undefined) return undefined
    state.pending.delete(id)
    deps.clearTimer(one.timer)
    return one
  }

  const failWhere = (pick: (one: Pending) => boolean, reason: string): void => {
    for (const [id, one] of [...state.pending]) {
      if (!pick(one)) continue
      finish(id)
      one.reject(new Error(reason))
    }
  }

  const call = (method: string, arg?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> =>
    new Promise((resolve, reject) => {
      state.next += 1
      const id = state.next
      const frame: Pending["frame"] = { type: "call", id, method, ...(arg === undefined ? {} : { arg }) }
      const timer = deps.setTimer(() => {
        if (finish(id) === undefined) return
        reject(new Error(`等了 ${String(Math.round(timeoutMs / 1000))} 秒，那台机器没有回音`))
      }, timeoutMs)
      const one: Pending = { frame, sent: false, timer, resolve, reject }
      state.pending.set(id, one)
      one.sent = deps.send(frame)
    })

  return {
    call,
    opened: () => {
      for (const one of state.pending.values()) {
        if (!one.sent) one.sent = deps.send(one.frame)
      }
    },
    settle: (frame) => {
      const one = finish(frame.id)
      if (one === undefined) return
      if (frame.ok) one.resolve(frame.value)
      else one.reject(new Error(frame.reason))
    },
    dropped: (reason) => {
      failWhere((one) => one.sent, `连接断了（${reason}），这一下没有做完`)
    },
    close: (reason) => {
      failWhere(() => true, reason)
    },
    size: () => state.pending.size,
  }
}
