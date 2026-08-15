import type { Event } from "@omni/protocol"

/** 合帧窗口。16ms ≈ 一帧，人感知不到，但能把一秒内的上千条压成 60 批。 */
const WINDOW_MS = 16

/**
 * 批次上限。攒到这么多就立刻发，不等窗口。
 *
 * 没有这条的话，一个疯狂刷屏的命令会在 16ms 里攒出几万条事件，
 * 一次性过 IPC 反而更卡——**合帧是为了少发几次，不是为了攒大包**。
 */
const MAX_BATCH = 500

export interface Batcher {
  push: (event: Event) => void
  /** 立刻发出攒着的。窗口关闭前必须调，否则最后一批会丢。 */
  flush: () => void
}

/**
 * 事件合帧。
 *
 * codex 的命令输出是**一行一条通知**：一次 `pnpm build` 能刷出上万条。
 * 逐条过 IPC 意味着上万次跨进程序列化 + 上万次 React 重渲染，
 * 而归约器每次都要复制一遍整条 item 列表——这是个真实的性能悬崖，
 * 不是理论上的。
 *
 * **顺序绝不能乱、一条都不能丢**：合帧只改变「什么时候发」，不改变发什么。
 */
export function createBatcher(send: (events: readonly Event[]) => void): Batcher {
  const state: { queue: Event[]; timer: NodeJS.Timeout | undefined } = {
    queue: [],
    timer: undefined,
  }

  const flush = (): void => {
    if (state.timer !== undefined) {
      clearTimeout(state.timer)
      state.timer = undefined
    }
    if (state.queue.length === 0) return
    const batch = state.queue
    // 先换掉队列再发：`send` 里若又推事件进来，不会掺进这一批
    state.queue = []
    send(batch)
  }

  const push = (event: Event): void => {
    state.queue.push(event)
    if (state.queue.length >= MAX_BATCH) {
      flush()
      return
    }
    state.timer ??= setTimeout(flush, WINDOW_MS)
  }

  return { push, flush }
}
