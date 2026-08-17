import { createReassembler, type ClientFrame, type ServerFrame } from "@omni/wire"

/**
 * 浏览器这一端的连接。
 *
 * 只做一件事：**把一条会断的网络，变成一条「断了会自己回来、回来时说得清
 * 自己停在哪」的流**。事件怎么变成界面是 `useRemote` 的事，这里一个 `Event`
 * 都不认识。
 *
 * 常量抄的是 codex remote-control 那套实测值（`websocket.rs`）：
 * 心跳 10 秒、退避上限 30 秒。心跳这里放宽到 15 秒——那边是常驻守护进程，
 * 这边是一块随时会被系统冻住的手机屏幕。
 */

const WS_PROTOCOL = "omni.v1"
const PING_MS = 15_000
/** 这么久没收到任何东西就认定这条连接已经死了。手机切后台回来时最常触发。 */
const DEAD_MS = 45_000
const BACKOFF_CAP_MS = 30_000

export type ConnState =
  | { kind: "connecting" }
  | { kind: "open" }
  /** 断了，`inMs` 之后再试。`reason` 写给人看。 */
  | { kind: "retrying"; inMs: number; reason: string }
  /** 令牌不认了（被吊销、或者换了机器）。**不再重试**——重试一万次也还是这个结果。 */
  | { kind: "unauthorized" }
  | { kind: "closed" }

export interface TransportDeps {
  /** 设备令牌。 */
  token: string
  /**
   * 连之前先问一句「这个令牌还认吗」。
   *
   * **必须有这一步**：WebSocket 握手被 401 拒掉时，浏览器只给一个 code 1006，
   * 和「网断了」长得一模一样。分不出来的话，一个被吊销的设备会永远在那里重连，
   * 而界面上写着「正在重连…」——用户永远等不到有人告诉他要重新配对。
   */
  authorize: () => Promise<boolean>
  onFrame: (frame: ServerFrame) => void
  onState: (state: ConnState) => void
  /** 重连成功后要发的第一帧（带上游标）。由调用方给，因为游标是它在管。 */
  hello: () => ClientFrame
}

export interface Transport {
  send: (frame: ClientFrame) => void
  /** 立刻重连（用户点了「重试」，或者页面从后台回到前台）。 */
  poke: () => void
  close: () => void
}

interface State {
  socket: WebSocket | undefined
  attempt: number
  timer: ReturnType<typeof setTimeout> | undefined
  heartbeat: ReturnType<typeof setInterval> | undefined
  lastSeen: number
  stopped: boolean
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, BACKOFF_CAP_MS)
}

function wsUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${scheme}//${window.location.host}/api/stream`
}

export function createTransport(deps: TransportDeps): Transport {
  const state: State = {
    socket: undefined,
    attempt: 0,
    timer: undefined,
    heartbeat: undefined,
    lastSeen: 0,
    stopped: false,
  }
  const reassembler = createReassembler()

  const clearTimers = (): void => {
    if (state.timer !== undefined) clearTimeout(state.timer)
    if (state.heartbeat !== undefined) clearInterval(state.heartbeat)
    state.timer = undefined
    state.heartbeat = undefined
  }

  const retry = (reason: string): void => {
    if (state.stopped) return
    const inMs = backoffMs(state.attempt)
    state.attempt += 1
    deps.onState({ kind: "retrying", inMs, reason })
    state.timer = setTimeout(open, inMs)
  }

  const beat = (): void => {
    if (state.socket?.readyState !== WebSocket.OPEN) return
    // 收不到任何东西超过阈值就主动断。**别等浏览器自己发现**——
    // 手机从后台回来时那条 socket 常常是「看起来开着，实际早就死了」
    if (Date.now() - state.lastSeen > DEAD_MS) {
      state.socket.close(4000, "no traffic")
      return
    }
    state.socket.send(JSON.stringify({ type: "ping" } satisfies ClientFrame))
  }

  const attach = (socket: WebSocket): void => {
    socket.onopen = () => {
      state.attempt = 0
      state.lastSeen = Date.now()
      deps.onState({ kind: "open" })
      socket.send(JSON.stringify(deps.hello()))
      state.heartbeat = setInterval(beat, PING_MS)
    }
    socket.onmessage = (event: MessageEvent<string>) => {
      state.lastSeen = Date.now()
      const seen = reassembler.observe(event.data)
      if (seen.kind === "frame") deps.onFrame(seen.frame)
      // “pending” 是常态（大帧的中间片）；“dropped” 说明这条流已经不可信，
      // 断开重来比带着一个洞继续跑安全
      else if (seen.kind === "dropped") socket.close(4001, seen.reason)
    }
    socket.onclose = (event) => {
      clearTimers()
      state.socket = undefined
      if (!state.stopped) retry(event.reason === "" ? "连接断开" : event.reason)
    }
    socket.onerror = () => {
      // onerror 之后一定会来 onclose，重连逻辑只写在那一处
    }
  }

  const open = (): void => {
    if (state.stopped) return
    clearTimers()
    deps.onState({ kind: "connecting" })
    void deps
      .authorize()
      .then((ok) => {
        if (state.stopped) return
        if (!ok) {
          deps.onState({ kind: "unauthorized" })
          return
        }
        // 令牌走子协议：浏览器的 `WebSocket` 构造器设不了请求头，
        // 而放进查询串会进各级访问日志
        const socket = new WebSocket(wsUrl(), [WS_PROTOCOL, deps.token])
        state.socket = socket
        attach(socket)
      })
      .catch((error: unknown) => {
        retry(error instanceof Error ? error.message : "连不上")
      })
  }

  open()

  return {
    send: (frame) => {
      if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify(frame))
    },
    poke: () => {
      if (state.socket?.readyState === WebSocket.OPEN) return
      state.attempt = 0
      open()
    },
    close: () => {
      state.stopped = true
      clearTimers()
      state.socket?.close(1000, "bye")
      state.socket = undefined
      deps.onState({ kind: "closed" })
    },
  }
}
