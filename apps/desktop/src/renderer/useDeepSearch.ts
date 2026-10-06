import { useEffect, useState } from "react"

/**
 * 「那句话在哪条会话里」——搜所有会话的**正文**。
 *
 * ## 和侧栏那份筛选的分工
 *
 * `filter.ts` 搜的是标题、第一条消息、目录，纯内存、逐字即时。
 * 这一份搜的是**中间那些话**，要翻磁盘（`main/search.ts`），所以：
 *
 * - **两条并存，不合并。** 即时那份一个字都不能慢，它是主路径。
 * - 这份**跟在后面出现**，作为「标题里没有，但正文里提过」的补充。
 *
 * ## 三道闸
 *
 * - **两个字符起步**：一个字的查询会命中几乎每条会话，翻一遍盘只为得到一份噪音。
 * - **停手 220ms 才发**：打字过程中每一帧都发一次，等于把磁盘当键盘用。
 * - **上一次的结果先留着**（`stale`），不清空——每敲一个字闪一次白比慢半拍更难受。
 */

export interface DeepHit {
  threadId: string
  count: number
  snippet: string
  at: number
}

export interface DeepSearch {
  hits: readonly DeepHit[]
  /** 预算用完没扫的会话数。**要说出来**，否则「就这些」是句谎话。 */
  skipped: number
  /** 正在翻盘。界面据此说「还在找」而不是「没找到」。 */
  busy: boolean
  /** 查询太短，这一路整个没跑。 */
  idle: boolean
}

const MIN = 2
const WAIT = 220

const EMPTY: DeepSearch = { hits: [], skipped: 0, busy: false, idle: true }

export function useDeepSearch(query: string): DeepSearch {
  const [out, setOut] = useState<DeepSearch>(EMPTY)
  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.switchback
    const trimmed = query.trim()
    if (trimmed.length < MIN || bridge === undefined) {
      setOut(EMPTY)
      return undefined
    }
    let live = true
    setOut((was) => ({ ...was, busy: true, idle: false }))
    const timer = setTimeout(() => {
      void bridge.searchThreads(trimmed).then((got) => {
        if (!live) return
        setOut({ hits: got.hits, skipped: got.skipped, busy: false, idle: false })
      })
    }, WAIT)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])
  return out
}
