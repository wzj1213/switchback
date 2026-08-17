import type { Command, Event, ThreadId } from "@omni/protocol"

/**
 * 带序号的增量。
 *
 * 序号是**本次宿主运行内**的传输层计数，不是事件自身的属性——落盘的事件里没有它，
 * 重启之后从头数。接收端只需要知道「我收到的上一个是几」。
 */
export interface Sealed {
  seq: number
  event: Event
}

/**
 * 全量重建。客户端（重）连接时来一次。
 *
 * `resumeAt` 之后的增量才需要应用——之前的要么已经在 `events` 里，
 * 要么发生在还没订阅的时候。这条规则是防重的关键，而它成立的前提是
 * **发送端在读完历史之后才取 `resumeAt`**（见 `@omni/host` 侧的调用点）。
 */
export interface Replay {
  events: readonly Event[]
  resumeAt: number
}

/**
 * 客户端 → 宿主。
 *
 * **`command` 之外的四种都是传输层自己的事**，不进 `@omni/protocol`：
 * 那一层描述的是会话与事件，不描述「我收到第几号了」。
 */
export type ClientFrame =
  /**
   * 「我准备好了，把世界给我。」`after` 是重连时报的上一个序号——
   * 接得上就只补差量，接不上宿主发全量。
   *
   * **全量必须由客户端来要，不能由宿主猜时机**：连接建立那一刻页面可能还没挂上监听。
   */
  | { type: "hello"; after?: number }
  | { type: "command"; command: Command }
  /** 累积确认：`seq` 及以前的都收到了。宿主据此释放保留缓冲。 */
  | { type: "ack"; seq: number }
  /**
   * 我正在看哪条会话。`null` = 列表页，谁的正文都不看。
   *
   * 两处要用：① 分级 replay（宿主只发这一条的正文，别把所有历史推给手机）；
   * ② 通知抑制（「有人正看着这条」才是真的看见了，而不是「某个窗口在前台」）。
   */
  | { type: "watch"; threadId: ThreadId | null }
  | { type: "ping" }

/** 宿主 → 客户端。 */
export type ServerFrame =
  | { type: "replay"; replay: Replay }
  | { type: "events"; sealed: readonly Sealed[] }
  /**
   * 补不了（缺口比保留缓冲还老，或者序号来自上一次宿主运行）。
   *
   * **绝不返回一个不完整的片段**——补一半比不补危险，因为界面看起来是好的。
   * 客户端收到这条必须重新 `hello`（不带 `after`）。
   */
  | { type: "reset"; reason: string }
  | { type: "pong" }

/**
 * 一条逻辑帧被切开之后的一片。
 *
 * 为什么要切：一次全量重建可以是几 MB，而中间的反向代理、以及某些
 * 移动网络的中间设备对单帧大小有上限——**在最后一跳才失败的传输比不传输糟**。
 */
export interface ChunkFrame {
  type: "chunk"
  /** 这条逻辑帧的编号，用来把片认回同一条。 */
  id: number
  index: number
  count: number
  /** 原始 JSON 的一段。按 UTF-16 码元切，不做 base64（那会白涨三分之一）。 */
  body: string
}

/** 线上真正发出去的东西：要么是一整条帧，要么是它的一片。 */
export type WireFrame = ServerFrame | ChunkFrame
