import type { Command, Event, ThreadId } from "@switchback/protocol"

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
 * **发送端在读完历史之后才取 `resumeAt`**（见 `@switchback/host` 侧的调用点）。
 */
export interface Replay {
  events: readonly Event[]
  resumeAt: number
  /**
   * 这份基线属于宿主的**哪一次运行**。
   *
   * ## 为什么非有不可
   *
   * 序号是「本次运行内」的计数，重启从头数。没有这个字段的话，
   * 一个停在 50 号的客户端在宿主重启之后重连，会拿到新一轮的 51 号往后——
   * 而那些和它手上的 1..50 根本不是同一串事件。它会**安静地**把两轮的
   * 状态拼在一起：新一轮前 50 条里的 `item.started` 全都不在，
   * 后面所有对那些 item 的 delta 无处可去，界面就那么错着。
   *
   * 「对方报的号比我发过的还大」那条判据只挡住一半——宿主重启后只要
   * 已经发出的事件超过旧游标（一次流式回答就够），它就不成立了。
   */
  epoch: string
  /**
   * 这份全量里**带了正文**的会话。缺省 = 全都带（同机 IPC 那条路）。
   *
   * 客户端用不着它——它拿到什么就归约什么。**这是给宿主自己看的**：
   * 会话侧照着它记「这条不用再补」，否则你打开的第一条（最近那条，
   * 正文百分之百已经在全量里）会立刻触发一次多余的磁盘读 + 一份整段历史的帧，
   * 而那正是分级 replay 要省掉的东西。
   */
  bodies?: readonly ThreadId[]
  /**
   * 这些会话的正文**被裁掉了开头**，只带了尾巴。
   *
   * 客户端要拿它画一条「更早的内容没有加载」。少了这个字段，
   * 一条三小时的会话在手机上看起来就是「从中间开始的」——
   * 而界面上没有任何东西说上面还有，**用户会以为记录丢了**。
   */
  trimmed?: readonly ThreadId[]
}

/**
 * 客户端 → 宿主。
 *
 * **`command` 之外的四种都是传输层自己的事**，不进 `@switchback/protocol`：
 * 那一层描述的是会话与事件，不描述「我收到第几号了」。
 */
export type ClientFrame =
  /**
   * 「我准备好了，把世界给我。」`after` 是重连时报的上一个序号——
   * 接得上就只补差量，接不上宿主发全量。
   *
   * **全量必须由客户端来要，不能由宿主猜时机**：连接建立那一刻页面可能还没挂上监听。
   *
   * `epoch` 是上一份全量里带回来的运行代号。**它和 `after` 必须成对出现**：
   * 只报序号不报代号，宿主没法判断这个游标是不是上一次运行留下的。
   */
  | { type: "hello"; after?: number; epoch?: string }
  | { type: "command"; command: Command }
  /** 累积确认：`seq` 及以前的都收到了。宿主据此释放保留缓冲。 */
  | { type: "ack"; seq: number }
  /**
   * 「我这儿从 `after` 之后断了一截，补给我。」
   *
   * 和 `hello` 分开是因为**语义不同**：`hello` 是「我刚连上，给我基线」，
   * 而这条是「我一直连着，但发现序号跳了」。混用会让宿主在每次补洞时
   * 重新 `join` 一遍账本，把那个客户端的确认位打回 0。
   */
  | { type: "resync"; after: number; epoch: string }
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
   * 补发回来的那一段。**必须和常态增量分开**。
   *
   * 接收端在等补发时是 `catching` 状态，而 `received()` 在那个状态下只攒不应用
   *（它假设自己收到的是又一批可能带缺口的活事件）。补发的回包如果也走
   * `received`，就永远解不开 catching——界面从缺口那一刻起静默冻住，
   * 事件照收、什么都不显示、一行错误都没有。
   */
  | { type: "catchup"; sealed: readonly Sealed[] }
  /**
   * 一条会话的正文，**单独补的**。
   *
   * 全量重建为了不在蜂窝网上传几 MB，只带最近那几条会话的正文，
   * 其余只发头（见 `apps/desktop/src/main/scope.ts`）。客户端真的打开
   * 一条没带正文的会话时，宿主用这条把它的历史补上。
   *
   * **不走序号**：它是历史，不是「刚刚发生的一件事」。接收端按 item id
   * 过滤掉自己已经有的那些——否则一条正在流的消息会被这份旧快照盖回去。
   */
  | { type: "thread"; threadId: ThreadId; events: readonly Event[]; trimmed?: boolean }
  /**
   * 补不了（缺口比保留缓冲还老，或者序号来自上一次宿主运行）。
   *
   * **绝不返回一个不完整的片段**——补一半比不补危险，因为界面看起来是好的。
   * 客户端收到这条必须重新 `hello`（不带 `after`）。
   */
  | { type: "reset"; reason: string }
  /**
   * 一句要让人看见的话：命令被拒了、被钳了、或者别的「你以为做了其实没做」。
   *
   * **静默丢弃是这条通道上最坏的失败方式**——用户在手机上点了「允许」，
   * 工具被拒，而界面上没有任何东西说这里出过事。
   */
  | { type: "notice"; text: string }
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
