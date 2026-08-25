import { useEffect, useMemo, useRef, useState } from "react"
import type { Item } from "@omni/protocol"
import type { PreviewTarget } from "../workbench.js"
import { sessionFilesOf } from "../session-files.js"
import { relPath } from "../tool.js"
import { FileIcon } from "./icons-activity.js"
import { FilePreviewView } from "./FilePreviewView.js"

function PathRow({ path, cwd, meta, disabled, onPick }: {
  path: string
  cwd: string
  meta?: string
  disabled?: boolean
  onPick: (target: PreviewTarget) => void
}): React.JSX.Element {
  return (
    <button type="button" className="file-row" disabled={disabled}
      title={disabled ? `${path}\n文件已删除` : path} onClick={() => { onPick({ cwd, path }) }}>
      <span className="file-row__icon"><FileIcon size={13} /></span>
      <span className="file-row__path">{relPath(path, cwd)}</span>
      {meta === undefined ? null : <span className="file-row__meta">{meta}</span>}
    </button>
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
  const touched = useMemo(() => sessionFilesOf(items, cwd), [items, cwd])
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
          <section>
            <div className="workbench__section">本次任务触达</div>
            {touched.length === 0 ? <p className="workbench__empty">读过或改过的文件会出现在这里。</p> : null}
            {touched.map((file) => (
              <PathRow key={file.path} path={file.path} cwd={cwd} meta={file.action}
                disabled={file.deleted} onPick={onPick} />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

export function FilesPage({ cwd, items, target, onPick, onBack, onReveal, onCopy, searchFiles }: {
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
    <FilePreviewView target={target} onBack={onBack} onReveal={onReveal} onCopy={onCopy} />
  )
}
