import { useCallback, useEffect, useRef, useState } from "react"

export interface FileSearchState {
  key: string
  loading: boolean
  paths: readonly string[]
  failed: boolean
}

export type SearchFiles = (
  cwd: string,
  query: string,
  refresh?: boolean,
) => Promise<readonly string[]>

const REFRESH_MS = 15_000

function searchKey(cwd: string, query: string): string {
  return `${cwd}\u0000${query.trim()}`
}

/** 查询或工作区刚变化时，旧结果立刻失效，不能撑过 120ms 防抖继续可点。 */
export function visibleFileSearch(
  state: FileSearchState,
  cwd: string,
  query: string,
): Omit<FileSearchState, "key"> {
  if (state.key === searchKey(cwd, query)) {
    const { loading, paths, failed } = state
    return { loading, paths, failed }
  }
  return { loading: query.trim() !== "", paths: [], failed: false }
}

/** 同一查询重查时保留旧结果；换关键词时先撤掉已经失效的行。 */
export function beginFileSearch(
  state: FileSearchState,
  key: string,
): { state: FileSearchState; refresh: boolean } {
  const refresh = state.key === key
  return {
    refresh,
    state: { key, loading: true, paths: refresh ? state.paths : [], failed: false },
  }
}

function useRefreshPulse(active: boolean, searching: boolean): number {
  const [pulse, setPulse] = useState(0)
  useEffect(() => {
    if (!active || !searching) return undefined
    const refresh = (): void => { setPulse((before) => before + 1) }
    window.addEventListener("focus", refresh)
    const timer = window.setInterval(refresh, REFRESH_MS)
    return () => {
      window.removeEventListener("focus", refresh)
      window.clearInterval(timer)
    }
  }, [active, searching])
  return pulse
}

export function useFileSearch({ cwd, query, stamp, active, search }: {
  cwd: string
  query: string
  stamp: string
  active: boolean
  search: SearchFiles
}): Omit<FileSearchState, "key"> & { retry: () => void } {
  const initial: FileSearchState = { key: "", loading: false, paths: [], failed: false }
  const [state, setState] = useState<FileSearchState>(initial)
  const stateRef = useRef(state)
  const [again, setAgain] = useState(0)
  const seq = useRef(0)
  const clean = query.trim()
  const key = searchKey(cwd, query)
  const pulse = useRefreshPulse(active, clean !== "")
  useEffect(() => {
    seq.current += 1
    const mine = seq.current
    if (clean === "") {
      const next = { key, loading: false, paths: [], failed: false }
      stateRef.current = next
      setState(next)
      return undefined
    }
    if (!active) return undefined
    const started = beginFileSearch(stateRef.current, key)
    stateRef.current = started.state
    setState(started.state)
    const timer = window.setTimeout(() => {
      void search(cwd, clean, started.refresh).then((paths) => {
        if (seq.current !== mine) return
        const next = { key, loading: false, paths, failed: false }
        stateRef.current = next
        setState(next)
      }).catch(() => {
        if (seq.current !== mine) return
        const next = { ...started.state, loading: false, failed: true }
        stateRef.current = next
        setState(next)
      })
    }, 120)
    return () => { window.clearTimeout(timer) }
  }, [active, again, clean, cwd, key, pulse, search, stamp])
  const retry = useCallback(() => { setAgain((before) => before + 1) }, [])
  return { ...visibleFileSearch(state, cwd, query), retry }
}
