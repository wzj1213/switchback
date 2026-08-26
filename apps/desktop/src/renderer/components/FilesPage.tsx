import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Item } from "@omni/protocol"
import type { PreviewTarget } from "../workbench.js"
import { fileTouchOf, sessionFileGroupsOf, type SessionFile } from "../session-files.js"
import { PathRow } from "./file-row.js"
import { FilePreviewView } from "./FilePreviewView.js"

function FileGroup({ title, files, threadId, cwd, onPick }: {
  title: string
  files: readonly SessionFile[]
  threadId: string
  cwd: string
  onPick: (target: PreviewTarget) => void
}): React.JSX.Element | null {
  if (files.length === 0) return null
  return (
    <section>
      <div className="workbench__section">{title}<span className="workbench__count">{files.length}</span></div>
      {files.map((file) => (
        <PathRow key={file.path} path={file.path} cwd={cwd} threadId={threadId}
          disabled={file.deleted} onPick={onPick} />
      ))}
    </section>
  )
}

export interface FileSearchState {
  key: string
  loading: boolean
  paths: readonly string[]
  failed: boolean
}

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

function useFileSearch(
  cwd: string,
  query: string,
  search: (cwd: string, query: string) => Promise<readonly string[]>,
): Omit<FileSearchState, "key"> & { retry: () => void } {
  const [state, setState] = useState<FileSearchState>({ key: "", loading: false, paths: [], failed: false })
  const [again, setAgain] = useState(0)
  const seq = useRef(0)
  const clean = query.trim()
  const key = searchKey(cwd, query)
  useEffect(() => {
    seq.current += 1
    const mine = seq.current
    if (clean === "") {
      setState({ key, loading: false, paths: [], failed: false })
      return undefined
    }
    setState({ key, loading: true, paths: [], failed: false })
    const timer = window.setTimeout(() => {
      void search(cwd, clean).then((paths) => {
        if (seq.current === mine) setState({ key, loading: false, paths, failed: false })
      }).catch(() => {
        if (seq.current === mine) setState({ key, loading: false, paths: [], failed: true })
      })
    }, 120)
    return () => { window.clearTimeout(timer) }
  }, [again, clean, cwd, key, search])
  const retry = useCallback(() => { setAgain((before) => before + 1) }, [])
  return {
    ...visibleFileSearch(state, cwd, query),
    retry,
  }
}

interface FileSearchView extends Omit<FileSearchState, "key"> {
  retry: () => void
}

/** 搜索的三种非结果态；失败与零命中必须是两件不同的事。 */
export function FileSearchStatus({ state }: { state: FileSearchView }): React.JSX.Element | null {
  if (state.loading) return <p className="workbench__empty">正在搜索…</p>
  if (state.failed) {
    return (
      <div className="files-search__failure" role="alert">
        <p>文件搜索失败，请重试。</p>
        <button type="button" onClick={state.retry}>重试</button>
      </div>
    )
  }
  return state.paths.length === 0 ? <p className="workbench__empty">没有找到文件。</p> : null
}

function FileIndex({ threadId, cwd, items, hidden, onPick, searchFiles }: {
  threadId: string
  cwd: string
  items: readonly Item[]
  hidden: boolean
  onPick: (target: PreviewTarget) => void
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
}): React.JSX.Element {
  const [query, setQuery] = useState("")
  const input = useRef<HTMLInputElement>(null)
  const groups = useMemo(() => sessionFileGroupsOf(items, cwd), [items, cwd])
  const found = useFileSearch(cwd, query, searchFiles)
  const searching = query.trim() !== ""
  const recent = groups.recentEdited.length + groups.recentRead.length
  const total = recent + groups.earlier.length + groups.inherited.length
  return (
    <div className="files-index" hidden={hidden} onKeyDown={(event) => {
      if (event.key !== "Escape" || query === "") return
      event.stopPropagation()
      setQuery("")
      input.current?.focus()
    }}>
      <label className="files-search">
        <span className="sr-only">搜索工作区文件</span>
        <input ref={input} value={query} placeholder="搜索工作区文件…"
          onChange={(event) => { setQuery(event.currentTarget.value) }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              const first = event.currentTarget.closest(".files-index")
                ?.querySelector<HTMLButtonElement>(".file-row:not(:disabled)")
              if (first !== undefined && first !== null) {
                event.preventDefault()
                first.focus()
                first.scrollIntoView({ block: "nearest" })
              }
              return
            }
            if (event.key !== "Escape" || query === "") return
            event.stopPropagation()
            setQuery("")
          }} />
        <span className="files-scope">先列最近一轮；此前与分支继承记录分开保留。搜索范围是当前工作区。</span>
      </label>
      <div className="files-index__scroll">
        {searching ? (
          <section>
            <div className="workbench__section">搜索结果</div>
            <FileSearchStatus state={found} />
            {found.paths.map((path) => (
              <PathRow key={path} path={path} cwd={cwd} threadId={threadId} onPick={onPick} />
            ))}
          </section>
        ) : (
          <>
            {total === 0 ? <p className="workbench__empty">本会话还没有读过或改过文件。</p> : null}
            {total > 0 && recent === 0 ? <p className="workbench__empty">最近一轮没有读写文件。</p> : null}
            <FileGroup title="最近一轮改过" files={groups.recentEdited} threadId={threadId} cwd={cwd} onPick={onPick} />
            <FileGroup title="最近一轮读过" files={groups.recentRead} threadId={threadId} cwd={cwd} onPick={onPick} />
            <FileGroup title="此前碰过" files={groups.earlier} threadId={threadId} cwd={cwd} onPick={onPick} />
            <FileGroup title="分支继承" files={groups.inherited} threadId={threadId} cwd={cwd} onPick={onPick} />
          </>
        )}
      </div>
    </div>
  )
}

export function FilesPage({ threadId, cwd, items, stamp, target, onPick, onBack, onReference,
  referenceDisabled, onReveal, onCopy, searchFiles }: {
  threadId: string
  cwd: string
  items: readonly Item[]
  stamp: string
  target: PreviewTarget | undefined
  onPick: (target: PreviewTarget) => void
  onBack: () => void
  onReference?: (target: PreviewTarget) => void
  referenceDisabled?: boolean
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
}): React.JSX.Element {
  const revision = target === undefined ? undefined : fileTouchOf(items, cwd, target.path)
  return (
    <>
      {/* 详情是盖在索引上的一层；保活才能让返回保住查询、结果与滚动位置。 */}
      <FileIndex threadId={threadId} cwd={cwd} items={items} hidden={target !== undefined}
        onPick={onPick} searchFiles={searchFiles} />
      {target === undefined ? null : (
        <FilePreviewView target={target} revision={revision} stamp={stamp}
          onBack={onBack} onReference={onReference} referenceDisabled={referenceDisabled}
          onReveal={onReveal} onCopy={onCopy} />
      )}
    </>
  )
}
