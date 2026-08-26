import type { PreviewTarget } from "../workbench.js"
import type { SessionFile } from "../session-files.js"
import { PathRow } from "./file-row.js"

export function FileGroup({ title, files, threadId, cwd, tabStopPath, onFocusPath, onPick }: {
  title: string
  files: readonly SessionFile[]
  threadId: string
  cwd: string
  tabStopPath: string | undefined
  onFocusPath: (path: string) => void
  onPick: (target: PreviewTarget) => void
}): React.JSX.Element | null {
  if (files.length === 0) return null
  return (
    <section>
      <div className="workbench__section">
        {title}<span className="workbench__count">{files.length}</span>
      </div>
      {files.map((file) => (
        <PathRow key={file.path} path={file.path} cwd={cwd} threadId={threadId}
          disabled={file.deleted} tabStop={file.path === tabStopPath}
          onFocusPath={onFocusPath} onPick={onPick} />
      ))}
    </section>
  )
}
