import { randomUUID } from "node:crypto"
import type { Event, Thread, ThreadId } from "@omni/protocol"
import { createLedger, type Ledger } from "@omni/wire"
import { coalesce } from "@omni/store"
import { createBatcher } from "./batch.js"
import type { Attention } from "./attention.js"
import type { Awake } from "./awake.js"
import type { Sinks } from "./sink.js"
import type { Logger } from "./log.js"

/**
 * 事件出口：合帧 → 编号 → 广播给**每一个客户端** → 顺带记日志。
 *
 * 合帧的理由见 `batch.ts`，编号与保留的理由见 `@omni/wire`；
 * 记日志只挑 `engine.status`，因为那是唯一**用户看不见却必须留痕**的一类——
 * 其余事件在界面上都有对应的呈现。
 *
 * 「客户端」不再等于「窗口」（见 `sink.ts`）：桌面窗口和浏览器端拿的是
 * **同一份编号、同一条流**，所以「我收到第几号」在哪一端说的都是同一件事。
 */
export interface OutletDeps {
  sinks: Sinks
  attention: Attention
  /**
   * 有活在跑的时候别让机器空闲待机。**远程的全部前提是这台机器还醒着。**
   *
   * 判据不是计数器而是「现在还有没有活着的活」——见 `awake.ts`。
   */
  awake: Awake
  /** 现在有哪些会话活着。**传函数不传值**：outlet 比 host 先建。 */
  live: () => readonly Thread[]
  log: Logger
  seen: { thread: ThreadId | undefined }
}

export function createOutlet(deps: OutletDeps): { emit: (event: Event) => void; ledger: Ledger } {
  // **每次运行换一个代号。** 序号是「本次运行内」的计数，而远程客户端
  // 活得比宿主久——它停在 50 号，宿主重启之后新一轮的 51 号和它手上那 50 条
  // 根本不是同一串事件。代号让「补得上吗」这个判断第一步就问对问题
  const ledger = createLedger(randomUUID())
  const batcher = createBatcher((events) => {
    // 每条出去的事件顺带过一遍「要不要叫人」。放在发出去的同一处，
    // 免得将来多一条出口就漏一处。
    // **用的是合并前那份**：叫人和挡休眠认的是「发生了什么」，不是「发了几帧」
    for (const event of events) deps.attention.note(event)
    // 同一处顺带重算一次「现在还有没有活在跑」——**每次都重算，不记计数器**：
    // 漏一条 `turn.completed` 的代价从「永远不睡」降成「这一帧算错了」
    deps.awake.sync(deps.live())
    // **相邻的同 id delta 合成一条再编号。**
    //
    // 省的不是模型吐字那一路（按 token 出，一个 16ms 窗口里往往就一条，合不动），
    // 而是**命令输出**：`rpc.ts` 的 feed 把一次 stdout chunk 按行在同一个 tick 里
    // 全派发，于是 `pnpm build` 的输出是几百条同 id delta 落进同一批——
    // `MAX_BATCH` 那个 500 正是为它存在的。
    //
    // 真正的收益也不在字节上，在**账本的保留窗口**：一次构建就能刷满 5000 条，
    // 而那正是 `@omni/wire` 自己写下的失败模式——出隧道时缺口已经被自己的
    // 构建日志挤出缓冲，只能在信号最差的时候做最贵的那件事（全量重建）。
    // 合并之后同样 5000 条覆盖的墙钟时间长一到两个数量级。
    //
    // 安全性来自 `coalesce` 自己那段论证：只合挨着的同 id delta，
    // 字符串拼接满足结合律，语义和逐条应用完全等价。
    //
    // **编号在合帧之后**：合帧只改变什么时候发，编号定的是发了什么。
    // 反过来（先编号再攒）在批被丢弃时会留下号码空洞，看起来像丢事件
    const sealed = ledger.seal(coalesce(events))
    for (const sink of deps.sinks.list()) sink.send({ channel: "omni:events", sealed })
  })
  return {
    emit: (event) => {
      if (event.type === "thread.started") deps.seen.thread = event.thread.id
      // detail 里可能带 stderr，长度约束在 log.ts 那一层
      if (event.type === "engine.status" && event.status !== "ready") {
        const level = event.status === "crashed" ? "error" : "info"
        deps.log.write(level, "engine", `${event.status} ${event.detail ?? ""}`)
      }
      batcher.push(event)
    },
    ledger,
  }
}
