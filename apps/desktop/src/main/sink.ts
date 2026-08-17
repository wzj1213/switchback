import type { BrowserWindow } from "electron"
import type { ThreadId } from "@omni/protocol"
import type { Replay, Sealed } from "@omni/wire"

/**
 * 一个能收事件的客户端。
 *
 * ## 为什么窗口和远程连接必须是同一类东西
 *
 * 在这之前，事件出口写死成「遍历所有 `BrowserWindow` 调 `webContents.send`」。
 * 那等于把「客户端」这个概念和 Electron 的窗口绑死了，于是浏览器端只能是
 * **另一套并行的推送路径**——而两套推送路径必然分岔：一条修了漏发，另一条没修。
 *
 * 抽出这一层之后，桌面窗口和手机是**对等的两个客户端**，而不是
 * 「主界面 + 一个远程视图」。这也是 codex 的手机端能看见你在本机 TUI 里
 * 跑的那条会话的原因：两边连的是同一个常驻服务，不是两个各自为政的界面。
 */
export interface Sink {
  /** 稳定的身份。账本按它记「确认到哪」，日志按它认人。 */
  id: string
  send: (message: SinkMessage) => void
  /** 还连着吗。断了的 sink 会在下一次广播时被跳过。 */
  alive: () => boolean
  /**
   * 它正在看哪条会话。`undefined` = 不知道（窗口就答不出来）。
   *
   * 两处要用：分级 replay 与通知抑制。**「不知道」和「没在看」必须分得开**——
   * 前者只能保守处理（照常发、照常响），后者才能真的省掉。
   */
  watching?: () => ThreadId | undefined
}

/**
 * 一条要送到客户端的消息。
 *
 * **两条通道各管一段**：`omni:events` 是带序号的增量（常态），
 * `omni:replay` 是不带序号的全量 + `resumeAt`（（重）连接时一次性重建）。
 * 判别式而不是 `(channel, payload: unknown)`：后者让每个 sink 自己去猜
 * payload 是什么，而猜错不会在编译期报错。
 */
export type SinkMessage =
  | { channel: "omni:events"; sealed: readonly Sealed[] }
  | { channel: "omni:replay"; replay: Replay }

export interface Sinks {
  /** 现在活着的全部客户端：窗口是现算的，远程的是注册进来的。 */
  list: () => readonly Sink[]
  /** 注册一个远程客户端，返回摘除函数。**必须调**，否则账本的保留下限会被它钉住。 */
  add: (sink: Sink) => () => void
}

/** 把一扇窗包成 sink。窗口没有 `watching`——主进程不知道渲染层选中的是谁。 */
export function windowSink(win: BrowserWindow): Sink {
  return {
    id: `win-${String(win.id)}`,
    send: (message) => {
      if (win.isDestroyed()) return
      if (message.channel === "omni:events") win.webContents.send(message.channel, message.sealed)
      else win.webContents.send(message.channel, message.replay)
    },
    alive: () => !win.isDestroyed(),
  }
}

/**
 * 窗口 + 远程连接的合集。
 *
 * 窗口**每次现算**而不是注册：它们的生老病死归 Electron 管，注册一份影子表
 * 只会在某次没摘干净时留下一个指向已销毁窗口的引用。
 */
export function createSinks(windows: () => readonly BrowserWindow[]): Sinks {
  const remotes = new Set<Sink>()
  return {
    list: () => [...windows().filter((w) => !w.isDestroyed()).map(windowSink), ...remotes].filter((s) => s.alive()),
    add: (sink) => {
      remotes.add(sink)
      return () => {
        remotes.delete(sink)
      }
    },
  }
}
