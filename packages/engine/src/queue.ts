/**
 * 可推入的异步队列。Claude Agent SDK 的流式输入要一个 `AsyncIterable`，
 * 但我们要在会话存活期间随时追加提示词——标准库没有现成的。
 */
export interface PushQueue<T> extends AsyncIterable<T> {
  push: (value: T) => void
  /** 关闭后迭代器结束；再 push 会被忽略。幂等。 */
  close: () => void
}

interface Waiter<T> {
  resolve: (r: IteratorResult<T>) => void
}

export function createQueue<T>(): PushQueue<T> {
  const buffer: T[] = []
  const waiters: Waiter<T>[] = []
  const state = { closed: false }

  const push = (value: T): void => {
    if (state.closed) return
    const waiter = waiters.shift()
    if (waiter === undefined) buffer.push(value)
    else waiter.resolve({ value, done: false })
  }

  const close = (): void => {
    if (state.closed) return
    state.closed = true
    while (waiters.length > 0) {
      waiters.shift()?.resolve({ value: undefined, done: true })
    }
  }

  const next = async (): Promise<IteratorResult<T>> => {
    const buffered = buffer.shift()
    if (buffered !== undefined) return { value: buffered, done: false }
    if (state.closed) return { value: undefined, done: true }
    return new Promise<IteratorResult<T>>((resolve) => {
      waiters.push({ resolve })
    })
  }

  return {
    push,
    close,
    [Symbol.asyncIterator]: (): AsyncIterator<T> => ({ next }),
  }
}
