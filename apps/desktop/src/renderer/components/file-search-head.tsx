import { useId } from "react"
import { ReloadIcon } from "./reload-icon.js"

export function FileSearchHead({ query, loading, input, onQuery, onEnterResults, onRefresh }: {
  query: string
  loading: boolean
  input: React.RefObject<HTMLInputElement | null>
  onQuery: (query: string) => void
  onEnterResults: () => void
  onRefresh: () => void
}): React.JSX.Element {
  const searchId = useId()
  const searching = query.trim() !== ""
  return (
    <div className="files-search">
      <label className="sr-only" htmlFor={searchId}>搜索工作区文件</label>
      <div className="files-search__field">
        <input id={searchId} ref={input} value={query} placeholder="搜索工作区文件…"
          onChange={(event) => { onQuery(event.currentTarget.value) }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              onEnterResults()
              return
            }
            if (event.key !== "Escape" || !searching) return
            event.stopPropagation()
            onQuery("")
          }} />
        <button type="button" className="workbench__icon" aria-label="立即刷新搜索结果"
          title="立即刷新搜索结果" aria-busy={loading}
          disabled={!searching} onClick={onRefresh}>
          <ReloadIcon />
        </button>
      </div>
      <span className="files-scope">先列最近一轮；此前与分支继承记录分开保留。搜索当前工作区，文件变化会自动更新。</span>
    </div>
  )
}
