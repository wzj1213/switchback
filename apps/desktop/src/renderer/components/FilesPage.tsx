import { useEffect, useId, useMemo, useRef, useState } from "react"
import type { Item } from "@omni/protocol"
import type { PreviewTarget } from "../workbench.js"
import { fileTouchOf, sessionFileGroupsOf } from "../session-files.js"
import { useFileSearch, type FileSearchState, type SearchFiles } from "../use-file-search.js"
import { FileGroup } from "./file-group.js"
import { focusFile, focusFirstFile, PathRow } from "./file-row.js"
import { FilePreviewView } from "./FilePreviewView.js"
import { ReloadIcon } from "./reload-icon.js"

interface FileSearchView extends Omit<FileSearchState, "key"> {
  retry: () => void
}

/** 搜索的三种非结果态；失败与零命中必须是两件不同的事。 */
export function FileSearchStatus({ state }: { state: FileSearchView }): React.JSX.Element | null {
  if (state.loading && state.paths.length > 0) {
    return <span className="sr-only" role="status">正在更新搜索结果…</span>
  }
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

function FileIndex({ threadId, cwd, items, stamp, active, hidden, onPick, searchFiles }: {
  threadId: string
  cwd: string
  items: readonly Item[]
  stamp: string
  active: boolean
  hidden: boolean
  onPick: (target: PreviewTarget) => void
  searchFiles: SearchFiles
}): React.JSX.Element {
  const [query, setQuery] = useState("")
  const searchId = useId()
  const input = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const enterResults = useRef(false)
  const returnPath = useRef<string | undefined>(undefined)
  const groups = useMemo(() => sessionFileGroupsOf(items, cwd), [items, cwd])
  const found = useFileSearch({ cwd, query, stamp, active, search: searchFiles })
  const searching = query.trim() !== ""
  const recent = groups.recentEdited.length + groups.recentRead.length
  const total = recent + groups.earlier.length + groups.inherited.length
  useEffect(() => {
    if (!enterResults.current || found.loading || found.paths.length === 0) return
    enterResults.current = false
    if (document.activeElement === input.current) focusFirstFile(root.current)
  }, [found.loading, found.paths])
  useEffect(() => {
    if (hidden || returnPath.current === undefined) return
    const path = returnPath.current
    returnPath.current = undefined
    if (!focusFile(root.current, path)) input.current?.focus()
  }, [hidden])
  const pick = (target: PreviewTarget): void => {
    returnPath.current = target.path
    onPick(target)
  }
  return (
    <div ref={root} className="files-index" hidden={hidden} onKeyDown={(event) => {
      if (event.key !== "Escape" || query === "") return
      event.stopPropagation()
      enterResults.current = false
      setQuery("")
      input.current?.focus()
    }}>
      <div className="files-search">
        <label className="sr-only" htmlFor={searchId}>搜索工作区文件</label>
        <div className="files-search__field">
          <input id={searchId} ref={input} value={query} placeholder="搜索工作区文件…"
            onChange={(event) => {
              enterResults.current = false
              setQuery(event.currentTarget.value)
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                enterResults.current = !focusFirstFile(root.current)
                return
              }
              if (event.key !== "Escape" || query === "") return
              event.stopPropagation()
              enterResults.current = false
              setQuery("")
            }} />
          <button type="button" className="workbench__icon" aria-label="立即刷新搜索结果"
            title="立即刷新搜索结果" aria-busy={found.loading}
            disabled={!searching} onClick={found.retry}>
            <ReloadIcon />
          </button>
        </div>
        <span className="files-scope">先列最近一轮；此前与分支继承记录分开保留。搜索当前工作区，文件变化会自动更新。</span>
      </div>
      <div className="files-index__scroll">
        {searching ? (
          <section>
            <div className="workbench__section">搜索结果</div>
            <FileSearchStatus state={found} />
            {found.paths.map((path) => (
              <PathRow key={path} path={path} cwd={cwd} threadId={threadId} onPick={pick} />
            ))}
          </section>
        ) : (
          <>
            {total === 0 ? <p className="workbench__empty">本会话还没有读过或改过文件。</p> : null}
            {total > 0 && recent === 0 ? <p className="workbench__empty">最近一轮没有读写文件。</p> : null}
            <FileGroup title="最近一轮改过" files={groups.recentEdited} threadId={threadId} cwd={cwd} onPick={pick} />
            <FileGroup title="最近一轮读过" files={groups.recentRead} threadId={threadId} cwd={cwd} onPick={pick} />
            <FileGroup title="此前碰过" files={groups.earlier} threadId={threadId} cwd={cwd} onPick={pick} />
            <FileGroup title="分支继承" files={groups.inherited} threadId={threadId} cwd={cwd} onPick={pick} />
          </>
        )}
      </div>
    </div>
  )
}

export function FilesPage({ threadId, cwd, items, stamp, active, target, onPick, onBack, onReference,
  referenceDisabled, onReveal, onCopy, searchFiles }: {
  threadId: string
  cwd: string
  items: readonly Item[]
  stamp: string
  active?: boolean
  target: PreviewTarget | undefined
  onPick: (target: PreviewTarget) => void
  onBack: () => void
  onReference?: (target: PreviewTarget) => void
  referenceDisabled?: boolean
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  searchFiles: SearchFiles
}): React.JSX.Element {
  const revision = target === undefined ? undefined : fileTouchOf(items, cwd, target.path)
  return (
    <>
      {/* 详情是盖在索引上的一层；保活才能让返回保住查询、结果与滚动位置。 */}
      <FileIndex threadId={threadId} cwd={cwd} items={items} stamp={stamp}
        active={active !== false && target === undefined} hidden={target !== undefined}
        onPick={onPick} searchFiles={searchFiles} />
      {target === undefined ? null : (
        <FilePreviewView target={target} revision={revision} stamp={stamp}
          active={active !== false}
          onBack={onBack} onReference={onReference} referenceDisabled={referenceDisabled}
          onReveal={onReveal} onCopy={onCopy} />
      )}
    </>
  )
}
