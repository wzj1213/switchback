import type { ContextSnapshot } from "./usage.js"

interface ContextHandle {
  getContextUsage: () => Promise<{ totalTokens: number; maxTokens: number }>
}

interface PendingRead {
  epoch: number
  promise: Promise<ContextSnapshot | undefined>
}

const valid = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0

function snapshotOf(raw: { totalTokens: number; maxTokens: number }): ContextSnapshot | undefined {
  return valid(raw.totalTokens) && valid(raw.maxTokens)
    ? { totalTokens: raw.totalTokens, maxTokens: raw.maxTokens }
    : undefined
}

/** 等待控制请求，但旁路用量不得把轮次收工一起卡住。 */
function within(
  promise: Promise<ContextSnapshot | undefined>,
  timeoutMs: number,
  fallback: () => ContextSnapshot | undefined,
): Promise<ContextSnapshot | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback()), timeoutMs)
    void promise.then((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

/** 去重当前上下文控制请求，并挡住换模型前的迟到快照。 */
export class ContextProbe {
  private snapshot: ContextSnapshot | undefined
  private pending: PendingRead | undefined
  private epoch = 0

  constructor(private readonly timeoutMs = 800) {}

  current(): ContextSnapshot | undefined {
    return this.snapshot
  }

  invalidate(): void {
    this.epoch += 1
    this.snapshot = undefined
    this.pending = undefined
  }

  read(handle: ContextHandle | undefined): Promise<ContextSnapshot | undefined> {
    if (handle === undefined) return Promise.resolve(this.snapshot)
    const epoch = this.epoch
    const pending = this.pending?.epoch === epoch ? this.pending.promise : this.start(handle, epoch)
    return within(pending, this.timeoutMs, () => this.snapshot)
  }

  private start(handle: ContextHandle, epoch: number): Promise<ContextSnapshot | undefined> {
    const request = handle.getContextUsage().then((raw) => {
      if (this.epoch !== epoch) return undefined
      this.snapshot = snapshotOf(raw) ?? this.snapshot
      return this.snapshot
    }).catch(() => (this.epoch === epoch ? this.snapshot : undefined)).finally(() => {
      if (this.pending?.promise === request) this.pending = undefined
    })
    this.pending = { epoch, promise: request }
    return request
  }
}
