import { useEffect, useMemo, useRef, useState } from "react"
import type { Item } from "@switchback/protocol"
import type { PreviewTarget } from "../workbench.js"
import { fileTouchOf, sessionFileGroupsOf } from "../session-files.js"
import { useFileSearch, type FileSearchState, type SearchFiles } from "../use-file-search.js"
import { FileGroup } from "./file-group.js"
import { focusFile, focusFirstFile, PathRow } from "./file-row.js"
import { FilePreviewView } from "./FilePreviewView.js"
import { FileSearchHead } from "./file-search-head.js"
import type { PreviewNavigation } from "./file-preview-navigation.js"
import { useMessages } from "../i18n.js"
import { FILES_PAGE } from "./FilesPage.messages.js"

interface FileSearchView extends Omit<FileSearchState, "key"> {
  retry: () => void
}

/** 搜索的三种非结果态；失败与零命中必须是两件不同的事。 */
export function FileSearchStatus({ state }: { state: FileSearchView }): React.JSX.Element | null {
  const m = useMessages(FILES_PAGE)
  if (state.loading && state.paths.length > 0) {
    return <span className="sr-only" role="status">{m.updating}</span>
  }
  if (state.loading) return <p className="workbench__empty">{m.searching}</p>
  if (state.failed) {
    return (
      <div className="files-search__failure" role="alert">
        <p>{m.failed}</p>
        <button type="button" onClick={state.retry}>{m.retry}</button>
      </div>
    )
  }
  return state.paths.length === 0 ? <p className="workbench__empty">{m.none}</p> : null
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
  const m = useMessages(FILES_PAGE)
  const [query, setQuery] = useState("")
  const input = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const enterResults = useRef(false)
  const returnPath = useRef<string | undefined>(undefined)
  const [preferredTabStop, setPreferredTabStop] = useState<string | undefined>(undefined)
  const groups = useMemo(() => sessionFileGroupsOf(items, cwd), [items, cwd])
  const found = useFileSearch({ cwd, query, stamp, active, search: searchFiles })
  const searching = query.trim() !== ""
  const recent = groups.recentEdited.length + groups.recentRead.length
  const total = recent + groups.earlier.length + groups.inherited.length
  const availablePaths = searching
    ? found.paths
    : [groups.recentEdited, groups.recentRead, groups.earlier, groups.inherited]
      .flat().filter((file) => !file.deleted).map((file) => file.path)
  const tabStopPath = preferredTabStop !== undefined && availablePaths.includes(preferredTabStop)
    ? preferredTabStop
    : availablePaths[0]
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
      if (event.key !== "Escape" || query === "" || event.nativeEvent.isComposing) return
      event.stopPropagation()
      enterResults.current = false
      setQuery("")
      input.current?.focus()
    }}>
      <FileSearchHead cwd={cwd} query={query} loading={found.loading} input={input}
        onQuery={(text) => { enterResults.current = false; setQuery(text) }}
        onEnterResults={() => { enterResults.current = !focusFirstFile(root.current) }}
        onRefresh={found.retry} />
      <div className="files-index__scroll">
        {searching ? (
          <section>
            <div className="workbench__section">{m.results}</div>
            <FileSearchStatus state={found} />
            {found.paths.map((path) => (
              <PathRow key={path} path={path} cwd={cwd} threadId={threadId}
                tabStop={path === tabStopPath} onFocusPath={setPreferredTabStop} onPick={pick} />
            ))}
          </section>
        ) : (
          <>
            {total === 0 ? <p className="workbench__empty">{m.untouched}</p> : null}
            {total > 0 && recent === 0 ? <p className="workbench__empty">{m.quietTurn}</p> : null}
            <FileGroup title={m.recentEdited} files={groups.recentEdited} threadId={threadId} cwd={cwd}
              tabStopPath={tabStopPath} onFocusPath={setPreferredTabStop} onPick={pick} />
            <FileGroup title={m.recentRead} files={groups.recentRead} threadId={threadId} cwd={cwd}
              tabStopPath={tabStopPath} onFocusPath={setPreferredTabStop} onPick={pick} />
            <FileGroup title={m.earlier} files={groups.earlier} threadId={threadId} cwd={cwd}
              tabStopPath={tabStopPath} onFocusPath={setPreferredTabStop} onPick={pick} />
            <FileGroup title={m.inherited} files={groups.inherited} threadId={threadId} cwd={cwd}
              tabStopPath={tabStopPath} onFocusPath={setPreferredTabStop} onPick={pick} />
          </>
        )}
      </div>
    </div>
  )
}

export function FilesPage({ threadId, cwd, items, stamp, active, target, onPick, onBack, onReference,
  navigation, onReveal, onCopy, searchFiles }: {
  threadId: string
  cwd: string
  items: readonly Item[]
  stamp: string
  active?: boolean
  target: PreviewTarget | undefined
  onPick: (target: PreviewTarget) => void
  onBack: () => void
  onReference?: (target: PreviewTarget) => void
  navigation?: PreviewNavigation | undefined
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
          active={active !== false} navigation={navigation}
          onBack={onBack} onReference={onReference}
          onReveal={onReveal} onCopy={onCopy} />
      )}
    </>
  )
}
