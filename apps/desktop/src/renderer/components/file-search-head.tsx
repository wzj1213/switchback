import { useId } from "react"
import { ReloadIcon } from "./reload-icon.js"
import { useMessages } from "../i18n.js"
import { FILE_SEARCH_HEAD } from "./file-search-head.messages.js"

export function FileSearchHead({ cwd, query, loading, input, onQuery, onEnterResults, onRefresh }: {
  cwd: string
  query: string
  loading: boolean
  input: React.RefObject<HTMLInputElement | null>
  onQuery: (query: string) => void
  onEnterResults: () => void
  onRefresh: () => void
}): React.JSX.Element {
  const searchId = useId()
  const m = useMessages(FILE_SEARCH_HEAD)
  const searching = query.trim() !== ""
  return (
    <div className="files-search">
      <label className="sr-only" htmlFor={searchId}>{m.label}</label>
      <div className="files-search__field">
        <input id={searchId} ref={input} value={query} placeholder={m.placeholder}
          onChange={(event) => { onQuery(event.currentTarget.value) }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              onEnterResults()
              return
            }
            if (event.key !== "Escape" || !searching || event.nativeEvent.isComposing) return
            event.stopPropagation()
            onQuery("")
          }} />
        <button type="button" className="workbench__icon" aria-label={m.refresh}
          data-tip={m.refresh} aria-busy={loading}
          disabled={!searching} onClick={onRefresh}>
          <ReloadIcon />
        </button>
      </div>
      <span className="files-scope">
        <span className="files-scope__root">
          <span>{m.scope}</span>
          <bdi title={cwd}>{cwd}</bdi>
        </span>
        <span>{m.hint}</span>
      </span>
    </div>
  )
}
