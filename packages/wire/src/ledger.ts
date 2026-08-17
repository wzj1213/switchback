import type { Event } from "@omni/protocol"
import type { Sealed } from "./types.js"

/**
 * 事件流的编号与保留。**发送端唯一的一份**——所有客户端看到的是同一条流。
 *
 * ## 在这之前，丢事件是静默的
 *
 * 发出去就不管的推送（`webContents.send`、`socket.send`）有一堆丢事件的时机：
 * 客户端重载、刚连上还没订阅、网断了。而丢事件的后果不是「少显示一条」，
 * 是**状态永久错位**：漏掉一条 `item.started`，后面所有对这条 item 的 delta
 * 全都无处可去；漏掉一条 `turn.completed`，界面就永远停在「进行中」。
 *
 * 最糟的是它不报错。用户看到的是一个安静地显示着错误内容的界面。
 *
 * ## 为什么保留量由「确认到哪」定，而不是由条数定
 *
 * 上一版是一个固定 5000 条的环。它在同机 IPC 上够用，但对着网络就不对了：
 * **一次 `pnpm build` 就能刷满 5000 条**，而手机进一趟隧道要几分钟。
 * 出隧道时缺口已经被挤出缓冲，于是唯一的出路是全量重建——
 * 正好在网最差的时候，把最贵的那件事做一遍。
 *
 * 所以改成：**join 进来的客户端各报各的确认位，所有人都确认过的才丢**。
 * 没 join 的消费者（比如桌面窗口那条同机 IPC）不参与这个下限，照旧靠条数上限兜。
 *
 * 条数上限仍然在，而且**压过确认下限**：一个连着但再也不确认的客户端，
 * 不能把宿主的内存拖垮。它的代价是那个客户端下次要走全量——**这是对的**，
 * 一个掉队到 5000 条以外的客户端，补差量本来也不比重建便宜。
 */

/** 保留缓冲的条数上限。5000 条大约是一次 `pnpm build` 刷出来的量级。 */
const MAX_ENTRIES = 5000

export interface LedgerStats {
  /** 现在留着多少条。 */
  retained: number
  /** 缓冲里最老的那条的序号；空缓冲时 undefined。 */
  oldest: number | undefined
  /** 当前发到第几号。 */
  latest: number
  /** 各客户端确认到哪。 */
  acked: Readonly<Record<string, number>>
}

export interface Ledger {
  /** 给一批事件编号并记进缓冲。 */
  seal: (events: readonly Event[]) => readonly Sealed[]
  /** 一个客户端连上来了。它从这一刻起参与保留下限的计算。 */
  join: (client: string) => void
  /** 它走了。**必须调**，否则一个断开的客户端会永久钉住保留下限。 */
  leave: (client: string) => void
  /** 它确认收到 `seq` 及以前的全部。 */
  ack: (client: string, seq: number) => void
  /**
   * 取 `after` 之后的所有事件。
   *
   * 返回 `undefined` 表示**补不了**（缺口太老，或者对方报的序号根本不在本次运行里），
   * 调用方必须走全量重建。绝不返回一个不完整的片段。
   */
  since: (after: number) => readonly Sealed[] | undefined
  /** 当前发到第几号。 */
  latest: () => number
  stats: () => LedgerStats
}

export function createLedger(maxEntries = MAX_ENTRIES): Ledger {
  const buffer: Sealed[] = []
  const acked = new Map<string, number>()
  const state = { next: 0 }

  /** 所有 join 进来的客户端都确认过的位置。没人 join 时不设下限。 */
  const floor = (): number => {
    if (acked.size === 0) return 0
    let low = Number.POSITIVE_INFINITY
    for (const seq of acked.values()) low = Math.min(low, seq)
    return low
  }

  const trim = (): void => {
    const safe = floor()
    // 先按确认丢：这一段所有人都收到了，留着没有意义
    if (safe > 0) {
      const keep = buffer.findIndex((entry) => entry.seq > safe)
      buffer.splice(0, keep === -1 ? buffer.length : keep)
    }
    // 再按条数丢。**这一步压过确认下限**——不能让一个不确认的客户端拖垮内存
    if (buffer.length > maxEntries) buffer.splice(0, buffer.length - maxEntries)
  }

  return {
    seal: (events) => {
      const sealed = events.map((event) => {
        state.next += 1
        return { seq: state.next, event }
      })
      buffer.push(...sealed)
      trim()
      return sealed
    },
    join: (client) => {
      // 从 0 开始：它还什么都没确认。**不能填 latest**——那等于替它承认收到了
      // 连接之前的全部，而它接下来要走的是全量重建，两者对不上
      acked.set(client, 0)
    },
    leave: (client) => {
      acked.delete(client)
      trim()
    },
    ack: (client, seq) => {
      const prev = acked.get(client)
      if (prev === undefined) return
      // 确认只前进不后退：乱序到达的 ack 不该把下限拉回去
      if (seq <= prev) return
      acked.set(client, Math.min(seq, state.next))
      trim()
    },
    since: (after) => {
      // 对方报的序号比我们发出去的还大：它来自上一次运行（宿主重启过），
      // 或者它自己算错了。无论哪种，本次运行的缓冲都对不上，只能全量
      if (after > state.next) return undefined
      if (after === state.next) return []
      const oldest = buffer[0]?.seq
      // 缓冲空但确实落后了：说明整段都被挤出去了
      if (oldest === undefined) return undefined
      // 缺口的第一条已经被挤出缓冲——补不全，就不补
      if (oldest > after + 1) return undefined
      return buffer.filter((entry) => entry.seq > after)
    },
    latest: () => state.next,
    stats: () => ({
      retained: buffer.length,
      oldest: buffer[0]?.seq,
      latest: state.next,
      acked: Object.fromEntries(acked),
    }),
  }
}
