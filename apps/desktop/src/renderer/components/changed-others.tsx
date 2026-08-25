import { relPath } from "../tool.js"
import { splitPath } from "../diff.js"
import type { ReviewFile } from "../../shared/review.js"
import { RevealIcon } from "./icons.js"
import { FileIcon } from "./icons-activity.js"
import { requestFilePreview } from "../file-preview-request.js"

export const CHANGED_PREVIEW = 3

/** 置信度较低的 git 盲区单独成节，不混进“已编辑”的主数字。 */
export function ChangedOthers({
  files,
  total,
  cwd,
  onReveal,
}: {
  files: readonly ReviewFile[]
  total: number
  cwd: string
  onReveal: (path: string) => void
}): React.JSX.Element {
  return (
    <div className="changed__others">
      <p className="changed__note">
        本次对话期间另有 {total} 个文件发生变化，<strong>不是</strong>通过编辑工具上报的——
        可能是引擎跑的命令，也可能是你自己改的
      </p>
      {files.slice(0, CHANGED_PREVIEW).map((file) => {
        const path = file.path
        const shown = splitPath(relPath(path, cwd))
        return (
          <div className="changed__row" key={path}>
            <span className="changed__name changed__name--flat" title={path}>
              <span className="changed__dir">{shown.dir}</span>
              <span className="changed__base">{shown.name}</span>
            </span>
            {file.kind === "delete" ? null : (
              <>
                <button
                  type="button"
                  className="changed__act"
                  aria-label="预览文件"
                  title="在工作台预览"
                  onClick={() => {
                    requestFilePreview(cwd, path)
                  }}
                >
                  <FileIcon size={12} />
                </button>
                <button
                  type="button"
                  className="changed__act"
                  aria-label="在访达中显示"
                  title="在访达中显示"
                  onClick={() => {
                    onReveal(path)
                  }}
                >
                  <RevealIcon size={12} />
                </button>
              </>
            )}
          </div>
        )
      })}
      {total <= CHANGED_PREVIEW ? null : (
        <p className="changed__note">…还有 {total - CHANGED_PREVIEW} 个</p>
      )}
    </div>
  )
}
