import { useEffect, useMemo, useRef, useState } from "react"
import type { Item } from "@omni/protocol"
import type { PreviewTarget } from "../workbench.js"
import { sessionFilesOf, type SessionFile } from "../session-files.js"
import { PathRow } from "./file-row.js"
import { FilePreviewView } from "./FilePreviewView.js"

/** 改过的排前面：一屏里最想找的是「这轮动了什么」，读过的是背景。 */
function split(files: readonly SessionFile[]): { edited: readonly SessionFile[]; read: readonly SessionFile[] } {
  return {
    edited: files.filter((file) => file.action !== "读取"),
    read: files.filter((file) => file.action === "读取"),
  }
}

function FileGroup({ title, files, cwd, onPick }: {
  title: string
  files: readonly SessionFile[]
  cwd: string
  onPick: (target: PreviewTarget) => void
}): React.JSX.Element | null {
  if (files.length === 0) return null
  return (
    <section>
      <div className="workbench__section">{title}<span className="workbench__count">{files.length}</span></div>
      {files.map((file) => (
        <PathRow key={file.path} path={file.path} cwd={cwd}
          disabled={file.deleted} onPick={onPick} />
      ))}
    </section>
  )
}

function useFileSearch(
  cwd: string,
  query: string,
  search: (cwd: string, query: string) => Promise<readonly string[]>,
): { loading: boolean; paths: readonly string[] } {
  const [state, setState] = useState<{ loading: boolean; paths: readonly string[] }>({ loading: false, paths: [] })
  const seq = useRef(0)
  useEffect(() => {
    seq.current += 1
    const mine = seq.current
    const clean = query.trim()
    if (clean === "") {
      setState({ loading: false, paths: [] })
      return undefined
    }
    setState((before) => ({ ...before, loading: true }))
    const timer = window.setTimeout(() => {
      void search(cwd, clean).then((paths) => {
        if (seq.current === mine) setState({ loading: false, paths })
      }).catch(() => {
        if (seq.current === mine) setState({ loading: false, paths: [] })
      })
    }, 120)
    return () => { window.clearTimeout(timer) }
  }, [cwd, query, search])
  return state
}

function FileIndex({ cwd, items, onPick, searchFiles }: {
  cwd: string
  items: readonly Item[]
  onPick: (target: PreviewTarget) => void
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
}): React.JSX.Element {
  const [query, setQuery] = useState("")
  const groups = useMemo(() => split(sessionFilesOf(items, cwd)), [items, cwd])
  const found = useFileSearch(cwd, query, searchFiles)
  const searching = query.trim() !== ""
  return (
    <div className="files-index">
      <label className="files-search">
        <span className="sr-only">搜索工作区文件</span>
        <input value={query} placeholder="搜索工作区文件…"
          onChange={(event) => { setQuery(event.currentTarget.value) }} />
      </label>
      <div className="files-index__scroll">
        {searching ? (
          <section>
            <div className="workbench__section">搜索结果</div>
            {found.loading ? <p className="workbench__empty">正在搜索…</p> : null}
            {!found.loading && found.paths.length === 0 ? <p className="workbench__empty">没有找到文件。</p> : null}
            {found.paths.map((path) => <PathRow key={path} path={path} cwd={cwd} onPick={onPick} />)}
          </section>
        ) : (
          <>
            {groups.edited.length + groups.read.length === 0
              ? <p className="workbench__empty">读过或改过的文件会出现在这里。</p>
              : null}
            <FileGroup title="这轮改过" files={groups.edited} cwd={cwd} onPick={onPick} />
            <FileGroup title="读过" files={groups.read} cwd={cwd} onPick={onPick} />
          </>
        )}
      </div>
    </div>
  )
}

export function FilesPage({ threadId, cwd, items, target, onPick, onBack, onReveal, onCopy, searchFiles }: {
  threadId: string
  cwd: string
  items: readonly Item[]
  target: PreviewTarget | undefined
  onPick: (target: PreviewTarget) => void
  onBack: () => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
}): React.JSX.Element {
  return target === undefined ? (
    <FileIndex cwd={cwd} items={items} onPick={onPick} searchFiles={searchFiles} />
  ) : (
    <FilePreviewView threadId={threadId} target={target} onBack={onBack} onReveal={onReveal} onCopy={onCopy} />
  )
}
