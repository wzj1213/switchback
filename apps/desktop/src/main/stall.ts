/**
 * 主进程事件循环卡顿的留痕。
 *
 * Kimi 的服务端 20 秒收不到客户端任何消息就以 1001 断开；omni 回 pong 的代码是对的，
 * 那么真因为心跳断了，要么是对面卡住，要么是**主进程自己卡住、没去读**。后者只有主进程知道：
 * 每隔一小段看一次单调钟，实际走过的比约定的多出一大截，就记一笔。
 *
 * 用单调钟（调用方传 `performance.now`）而不是墙钟：合盖睡眠不算卡顿，
 * 否则每次开盖都会记一条「卡了一小时」。
 */
export interface StallWatchDeps {
  now: () => number
  report: (lateMs: number) => void
  everyMs?: number
  thresholdMs?: number
}

export function watchStalls(deps: StallWatchDeps): () => void {
  const every = deps.everyMs ?? 500
  const threshold = deps.thresholdMs ?? 2000
  const last = { at: deps.now() }
  const timer = setInterval(() => {
    const now = deps.now()
    const late = now - last.at - every
    last.at = now
    if (late >= threshold) deps.report(late)
  }, every)
  timer.unref()
  return () => clearInterval(timer)
}
