import { createReassembler, type ClientFrame, type ServerFrame } from "@switchback/wire"

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
 *
 * ## 代次（generation）
 *
 * 这个文件里最要紧的一个概念。手机上 `visibilitychange` 和 `online` 常常
 * 一起来，而弱网下 `authorize()` 的那次 fetch 要好几秒——**只靠
 * 「socket 是不是 OPEN」当守卫，就会开出两条并存的连接**。三条后果都真：
 * 分片进同一个重组器拼成坏 JSON；孤儿连接在服务端那侧永远不摘 sink
 *（它的确认位卡在 0，按确认回收整个失效）；先关掉的那条的 `onclose`
 * 会把还活着的那条从状态里抹掉，于是顶上写着「正在重连」而正文还在刷新，
 * 同时 `send()` 悄悄变成空操作——那期间点的每一次「允许」都被丢掉。
 *
 * 所以每次 `open()` 领一个号，socket 的四个 handler 开头都先对号——
 * **过期的那条只许关掉自己，不许碰共享状态**。
 */

const WS_PROTOCOL = "switchback.v1"
const PING_MS = 15_000
/** 这么久没收到任何东西就认定这条连接已经死了。手机切后台回来时最常触发。 */
const DEAD_MS = 45_000
const BACKOFF_CAP_MS = 30_000
/** 问「令牌还认吗」最多等多久。隧道变黑洞时这个 fetch 能挂上几分钟。 */
const AUTH_TIMEOUT_MS = 10_000

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
   * 连之前先问一句「这个令牌还认吗」。**三态**。
   *
   * 为什么要问：WebSocket 握手被 401 拒掉时，浏览器只给一个 code 1006，
   * 和「网断了」长得一模一样。分不出来的话，一个被吊销的设备会永远在那里重连，
   * 而界面上写着「正在重连…」——用户永远等不到有人告诉他要重新配对。
   *
   * 为什么是三态：**「问不出来」不等于「不认」**。隧道那头的反向代理回一个 502，
   * 或者手机压根没网——那时把人踢回配对屏是错的，该做的是接着重试。
   */
  authorize: () => Promise<"ok" | "denied" | "unknown">
  onFrame: (frame: ServerFrame) => void
  onState: (state: ConnState) => void
  /** 重连成功后要发的第一帧（带上游标）。由调用方给，因为游标是它在管。 */
  hello: () => ClientFrame
}

export interface Transport {
  /**
   * 发一帧。**返回有没有真的发出去**——没连上时是 false。
   *
   * 调用方必须看这个返回值：静默丢弃是这条通道上最坏的失败方式，
   * 用户在手机上点了「允许」而什么都没发生，界面上不会有任何东西说这里出过事。
   */
  send: (frame: ClientFrame) => boolean
  /** 立刻重连（用户点了「重试」，或者页面从后台回到前台）。 */
  poke: () => void
  close: () => void
}

interface Live {
  socket: WebSocket
  /** **每条连接一个**。共用一个的话，两条连接的分片会交错，拼出来是坏 JSON。 */
  reassembler: ReturnType<typeof createReassembler>
  heartbeat: ReturnType<typeof setInterval> | undefined
  lastSeen: number
}

interface State {
  live: Live | undefined
  /** 当前代次。每次 `open()` 递增，过期的回调据此认出自己已经不作数了。 */
  gen: number
  attempt: number
  timer: ReturnType<typeof setTimeout> | undefined
  stopped: boolean
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, BACKOFF_CAP_MS)
}

/**
 * 一次心跳。
 *
 * 收不到任何东西超过阈值就主动断——**别等浏览器自己发现**：
 * 手机从后台回来时那条 socket 常常是「看起来开着，实际早就死了」。
 */
function beat(live: Live): void {
  if (live.socket.readyState !== WebSocket.OPEN) return
  if (Date.now() - live.lastSeen > DEAD_MS) {
    live.socket.close(4000, "no traffic")
    return
  }
  live.socket.send(JSON.stringify({ type: "ping" } satisfies ClientFrame))
}

function wsUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${scheme}//${window.location.host}/api/stream`
}

/** 到点还没回就当「问不出来」。**不能一直等**：卡住时连接停在 connecting 且不重试。 */
function withTimeout(work: Promise<"ok" | "denied" | "unknown">): Promise<"ok" | "denied" | "unknown"> {
  return Promise.race([
    work,
    new Promise<"unknown">((resolve) => {
      setTimeout(() => {
        resolve("unknown")
      }, AUTH_TIMEOUT_MS)
    }),
  ])
}

export function createTransport(deps: TransportDeps): Transport {
  const state: State = { live: undefined, gen: 0, attempt: 0, timer: undefined, stopped: false }

  const dropLive = (): void => {
    if (state.live?.heartbeat !== undefined) clearInterval(state.live.heartbeat)
    state.live = undefined
  }

  const retry = (reason: string): void => {
    if (state.stopped) return
    const inMs = backoffMs(state.attempt)
    state.attempt += 1
    deps.onState({ kind: "retrying", inMs, reason })
    if (state.timer !== undefined) clearTimeout(state.timer)
    state.timer = setTimeout(open, inMs)
  }

  const attach = (live: Live, gen: number): void => {
    const stale = (): boolean => gen !== state.gen
    live.socket.onopen = () => {
      if (stale()) {
        live.socket.close(4002, "superseded")
        return
      }
      state.attempt = 0
      live.lastSeen = Date.now()
      deps.onState({ kind: "open" })
      live.socket.send(JSON.stringify(deps.hello()))
      live.heartbeat = setInterval(() => {
        beat(live)
      }, PING_MS)
    }
    live.socket.onmessage = (event: MessageEvent<string>) => {
      if (stale()) return
      live.lastSeen = Date.now()
      const seen = live.reassembler.observe(event.data)
      if (seen.kind === "frame") deps.onFrame(seen.frame)
      // “pending” 是常态（大帧的中间片）；“dropped” 说明这条流已经不可信，
      // 断开重来比带着一个洞继续跑安全
      else if (seen.kind === "dropped") live.socket.close(4001, seen.reason)
    }
    live.socket.onclose = (event) => {
      if (live.heartbeat !== undefined) clearInterval(live.heartbeat)
      // **过期的连接只许关掉自己。** 它的 onclose 不能把还活着的那条从状态里抹掉，
      // 也不能触发重连——那会连锁开出第三条
      if (stale()) return
      state.live = undefined
      if (!state.stopped) retry(event.reason === "" ? "连接断开" : event.reason)
    }
    live.socket.onerror = () => {
      // onerror 之后一定会来 onclose，重连逻辑只写在那一处
    }
  }

  const open = (): void => {
    if (state.stopped) return
    // 已经连上、或者还在握手，都不要再开一条
    const ready = state.live?.socket.readyState
    if (ready === WebSocket.OPEN || ready === WebSocket.CONNECTING) return
    state.gen += 1
    const gen = state.gen
    dropLive()
    deps.onState({ kind: "connecting" })
    void withTimeout(deps.authorize())
      .then((verdict) => {
        if (state.stopped || gen !== state.gen) return
        if (verdict === "denied") {
          deps.onState({ kind: "unauthorized" })
          return
        }
        if (verdict === "unknown") {
          // 问不出来就当网络问题，接着退避重试——**别把人踢回配对屏**
          retry("连不上 Switchback")
          return
        }
        // 令牌走子协议：浏览器的 `WebSocket` 构造器设不了请求头，
        // 而放进查询串会进各级访问日志
        const socket = new WebSocket(wsUrl(), [WS_PROTOCOL, deps.token])
        const live: Live = { socket, reassembler: createReassembler(), heartbeat: undefined, lastSeen: Date.now() }
        state.live = live
        attach(live, gen)
      })
      .catch((error: unknown) => {
        if (gen !== state.gen) return
        retry(error instanceof Error ? error.message : "连不上")
      })
  }

  open()

  return {
    send: (frame) => {
      const socket = state.live?.socket
      if (socket?.readyState !== WebSocket.OPEN) return false
      socket.send(JSON.stringify(frame))
      return true
    },
    poke: () => {
      const ready = state.live?.socket.readyState
      if (ready === WebSocket.OPEN || ready === WebSocket.CONNECTING) return
      state.attempt = 0
      open()
    },
    close: () => {
      state.stopped = true
      state.gen += 1
      if (state.timer !== undefined) clearTimeout(state.timer)
      state.timer = undefined
      state.live?.socket.close(1000, "bye")
      dropLive()
      deps.onState({ kind: "closed" })
    },
  }
}
