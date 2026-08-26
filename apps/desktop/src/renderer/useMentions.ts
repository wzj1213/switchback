import { useCallback, useEffect, useRef, useState } from "react"
import { applyMention, mentionAt } from "./mention.js"

export interface Mentions {
  /** 当前候选；是否显示由 open 决定，空数组也可能正在加载或显示失败。 */
  paths: readonly string[]
  active: number
  open: boolean
  loading: boolean
  failed: boolean
  /** 输入或移动光标之后调用，决定要不要弹列表 */
  refresh: (text: string, caret: number) => void
  /** 键盘导航。返回 true 表示这次按键被列表吃掉了，调用方不要再处理。 */
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** 选中一条，返回替换后的文本与光标位置 */
  pick: (path: string, text: string, caret: number) => { text: string; caret: number } | undefined
  close: () => void
  retry: () => void
}

interface SearchState {
  open: boolean
  loading: boolean
  failed: boolean
  paths: readonly string[]
}

const CLOSED_SEARCH: SearchState = { open: false, loading: false, failed: false, paths: [] }

function useMentionSearch(
  cwd: string,
  search: (cwd: string, query: string) => Promise<readonly string[]>,
): SearchState & { run: (query: string) => void; close: () => void; retry: () => void } {
  const [state, setState] = useState<SearchState>(CLOSED_SEARCH)
  const seq = useRef(0)
  const alive = useRef(true)
  const current = useRef<string | undefined>(undefined)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const close = useCallback(() => {
    seq.current += 1
    current.current = undefined
    setState(CLOSED_SEARCH)
  }, [])
  const run = useCallback((query: string) => {
    seq.current += 1
    const mine = seq.current
    current.current = query
    setState({ open: true, loading: true, failed: false, paths: [] })
    void Promise.resolve().then(() => search(cwd, query)).then((paths) => {
      if (alive.current && mine === seq.current)
        setState({ open: true, loading: false, failed: false, paths })
    }).catch(() => {
      if (alive.current && mine === seq.current)
        setState({ open: true, loading: false, failed: true, paths: [] })
    })
  }, [cwd, search])
  const retry = useCallback(() => {
    if (current.current !== undefined) run(current.current)
  }, [run])
  return { ...state, run, close, retry }
}

/**
 * `@` 文件引用的交互。
 *
 * 搜索是异步的，所以每次结果回来都要**核对它是不是最新那次查询的**——
 * 打字比磁盘快，先发的请求后回来是常态，不核对的话列表会闪回旧结果。
 */
export function useMentions(cwd: string, search: (cwd: string, query: string) => Promise<readonly string[]>): Mentions {
  const [active, setActive] = useState(0)
  const found = useMentionSearch(cwd, search)
  const close = useCallback(() => {
    found.close()
    setActive(0)
  }, [found.close])

  const refresh = useCallback(
    (text: string, caret: number) => {
      const mention = mentionAt(text, caret)
      if (mention === undefined) {
        close()
        return
      }
      setActive(0)
      found.run(mention.query)
    },
    [found.run, close],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!found.open) return false
      if (e.key === "Escape") {
        e.preventDefault()
        close()
        return true
      }
      if (found.paths.length === 0) {
        const waits = found.loading && (e.key === "Enter" || e.key === "Tab")
        if (waits) e.preventDefault()
        return waits
      }
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActive((i) => (i + 1) % found.paths.length)
        return true
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setActive((i) => (i - 1 + found.paths.length) % found.paths.length)
        return true
      }
      // Enter 与 Tab 都算「选中」：列表开着的时候 Enter 不该把消息发出去
      return e.key === "Enter" || e.key === "Tab"
    },
    [found.open, found.loading, found.paths, close],
  )

  const pick = useCallback(
    (path: string, text: string, caret: number) => {
      const mention = mentionAt(text, caret)
      if (mention === undefined) return undefined
      close()
      return applyMention(text, mention, path)
    },
    [close],
  )

  return {
    paths: found.paths,
    open: found.open,
    loading: found.loading,
    failed: found.failed,
    retry: found.retry,
    active,
    refresh,
    onKeyDown,
    pick,
    close,
  }
}
