import type { Event } from "@omni/protocol"

/**
 * 事件流的序号与补发。
 *
 * ## 在这之前，丢事件是**静默**的
 *
 * `webContents.send` 是发出去就不管了：渲染层重载、窗口刚开还没订阅、
 * 页面崩了自动恢复——每一种情况下，那段时间的事件都直接消失。
 * 而丢事件的后果不是「少显示一条」，是**状态永久错位**：漏掉一条
 * `item.started`，后面所有对这条 item 的 delta 全都无处可去；漏掉一条
 * `turn.completed`，界面就永远停在「进行中」。
 *
 * 最糟的是它不报错。用户看到的是一个安静地显示着错误内容的界面。
 *
 * ## 两条通道，各管一段
 *
 * | 通道 | 内容 | 用途 |
 * | --- | --- | --- |
 * | `omni:events` | **带序号**的增量 | 常态。渲染层靠序号连续性发现自己漏了 |
 * | `omni:replay` | 不带序号的全量 + `resumeAt` | 窗口（重）加载时的一次性重建 |
 *
 * 序号是**本次主进程运行内**的传输层计数，不是事件自身的属性——
 * 落盘的事件里没有它，重启之后从头数。渲染层只需要知道「我收到的上一个是几」。
 *
 * ## 为什么全量那条不带序号
 *
 * 全量来自磁盘上的 journal，那些事件当初的序号属于上一次运行，没有意义。
 * 所以全量走另一条通道，末尾附一个 `resumeAt`：**读完 journal 之后**才取的
 * 当前序号。渲染层据此丢掉 `seq <= resumeAt` 的增量——它们要么已经在全量里，
 * 要么是它还没订阅时发生的。这个先后顺序是防重的关键，反过来就会重复应用。
 */

export interface Sealed {
  seq: number
  event: Event
}

/**
 * 补发缓冲能回溯多远。
 *
 * 5000 条大约是一次 `pnpm build` 刷出来的量级。超过这个的缺口，
 * 与其发一半不如老实说「补不了」，让渲染层走全量重建——
 * **补一半比不补更危险**，因为界面看起来是好的。
 */
const RING = 5000

export interface Sequencer {
  /** 给一批事件编号并记进缓冲。 */
  seal: (events: readonly Event[]) => readonly Sealed[]
  /**
   * 取 `after` 之后的所有事件。
   *
   * 返回 `undefined` 表示**补不了**（缺口太老，或者对方报的序号根本不在本次运行里），
   * 调用方必须走全量重建。绝不返回一个不完整的片段。
   */
  since: (after: number) => readonly Sealed[] | undefined
  /** 当前发到第几号。 */
  latest: () => number
}

export function createSequencer(ring = RING): Sequencer {
  const buffer: Sealed[] = []
  const state = { next: 0 }

  return {
    seal: (events) => {
      const sealed = events.map((event) => {
        state.next += 1
        return { seq: state.next, event }
      })
      buffer.push(...sealed)
      if (buffer.length > ring) buffer.splice(0, buffer.length - ring)
      return sealed
    },
    since: (after) => {
      // 对方报的序号比我们发出去的还大：它来自上一次主进程运行（应用重启过），
      // 或者它自己算错了。无论哪种，本次运行的缓冲都对不上，只能全量
      if (after > state.next) return undefined
      if (after === state.next) return []
      const oldest = buffer[0]?.seq
      // 缓冲空但确实落后了：说明整段都被挤出去了
      if (oldest === undefined) return undefined
      // 缺口的第一条已经被挤出缓冲——补不全，就不补
      if (oldest > after + 1) return undefined
      return buffer.filter((s) => s.seq > after)
    },
    latest: () => state.next,
  }
}
